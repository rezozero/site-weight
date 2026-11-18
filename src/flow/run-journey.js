import path from "node:path";

import { chromium } from "playwright";

import { logProgress, warnProgress } from "../utils/logger.js";
import { computeEcoindex, computeJourneyEcoindex } from "../utils/ecoindex.js";
import { createRunFolder } from "../utils/run-folder.js";
import { sleep } from "../utils/time.js";
import { normalizeTrailingSlash } from "../utils/url.js";
import { DEFAULT_VIEWPORT } from "../utils/viewport.js";
import {
  autoScrollIfEnabled,
  bindResponseFallback,
  computeStepMetrics,
  countDomNodes,
  createCdpTracker,
  raiseResourceTimingBuffer,
  settle,
} from "./collect-metrics.js";

// In "cumulative" mode, the transferred size and the request count of a step
// (and the EcoIndex computed from them) cover the journey from its start.
function createModeAccumulator(mode) {
  let compressedKb = 0;
  let requestCount = 0;
  return (metrics) => {
    compressedKb = Math.round((compressedKb + metrics.compressed_kb) * 10) / 10;
    requestCount += metrics.request_count;
    // The step's own values, whatever the mode: the journey EcoIndex uses them.
    const stepMetrics = {
      ...metrics,
      step_compressed_kb: metrics.compressed_kb,
      step_request_count: metrics.request_count,
    };
    if (mode !== "cumulative") return stepMetrics;
    return { ...stepMetrics, compressed_kb: compressedKb, request_count: requestCount };
  };
}

const DEFAULT_STEP_TIMEOUT_MS = 120000;

class StepTimeoutError extends Error {}

// Rejects when `promise` takes longer than `ms`. The late promise keeps
// running until the browser closes; Promise.race keeps its rejection handled.
function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new StepTimeoutError(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Pause between the two settle passes of a step, before scrolling: covers late
// requests that start after the network went idle (hydration, lazy widgets).
const DEFAULT_SETTLE_PAUSE_MS = 1000;

// `outRoot`, `viewport` and `headed` come from the CLI; `viewport` overrides the journey's.
// Each run gets its own folder in `outRoot`, `<journey-folder>/reports/` by default.
export async function runJourney({ cfg, cfgPath, outRoot, viewport, headed = false }) {
  const stepTimeoutMs = Number(cfg.stepTimeoutMs ?? DEFAULT_STEP_TIMEOUT_MS);
  if (!Number.isFinite(stepTimeoutMs) || stepTimeoutMs <= 0) {
    throw new Error("Invalid config: stepTimeoutMs must be a positive number of milliseconds.");
  }

  const browser = await chromium.launch({ headless: !headed });
  try {
    return await runJourneyInBrowser({
      cfg,
      browser,
      stepTimeoutMs,
      outRoot: outRoot ?? path.join(path.dirname(cfgPath), "reports"),
      viewport: viewport ?? cfg.viewport ?? DEFAULT_VIEWPORT,
    });
  } finally {
    // Also on failure: a leftover headless Chromium keeps running otherwise.
    await browser.close();
  }
}

async function runJourneyInBrowser({ cfg, browser, stepTimeoutMs, outRoot, viewport }) {
  const startedAt = new Date();

  logProgress(`Viewport ${viewport.width}x${viewport.height}`);
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
  await raiseResourceTimingBuffer(context);
  const page = await context.newPage();

  const settlePauseMs = cfg.settle?.pauseMs ?? DEFAULT_SETTLE_PAUSE_MS;

  const client = await context.newCDPSession(page);
  await client.send("Network.enable");

  let currentStepIndex = 0;
  let journeyStopped = false;
  const windowStartTimes = new Map();
  const windowEndTimes = new Map();
  const { cdpReq, decompressedFallbackByRequestId } = createCdpTracker(client, () => currentStepIndex);
  bindResponseFallback(page, decompressedFallbackByRequestId, cdpReq, () => currentStepIndex);

  async function executeAction(stepAction, step) {
    if (stepAction.action === "goto") {
      await page.goto(stepAction.url, { waitUntil: "domcontentloaded" });
      return { action: "goto", linkMatch: "", navigationFallback: "", navigationTarget: stepAction.url || "" };
    }

    if (stepAction.action === "linkOrLocation") {
      const absoluteTarget = normalizeTrailingSlash(stepAction.absoluteUrl);
      const relativeTarget = normalizeTrailingSlash(stepAction.relativeUrl);
      const linkMatch = await page.evaluate(
        ({ absoluteTarget, relativeTarget }) => {
          const normalize = (value) => {
            if (typeof value !== "string") return value;
            if (value === "/") return value;
            return value.endsWith("/") ? value.slice(0, -1) : value;
          };

          const links = Array.from(document.querySelectorAll("a[href]"));
          const absMatch = links.find((link) => normalize(link.href) === absoluteTarget);
          if (absMatch) {
            return { match: "absolute", href: absMatch.getAttribute("href") };
          }

          const relMatch = links.find((link) => normalize(link.getAttribute("href")) === relativeTarget);
          if (relMatch) {
            return { match: "relative", href: relMatch.getAttribute("href") };
          }

          return { match: "none", href: null };
        },
        { absoluteTarget, relativeTarget }
      );

      if (linkMatch.match !== "none" && linkMatch.href) {
        const locator = page.locator(`a[href=\"${linkMatch.href}\"]`).first();
        try {
          await locator.scrollIntoViewIfNeeded();
          await locator.click({ timeout: 10000 });
        } catch {
          try {
            await locator.click({ force: true, timeout: 10000 });
          } catch {
            const currentUrl = page.url();
            warnProgress(
              `Click failed for ${stepAction.absoluteUrl} (current page: ${currentUrl}). Using window.location.href.`
            );
            await page.evaluate((target) => {
              window.location.href = target;
            }, stepAction.absoluteUrl);
            return {
              action: "location",
              linkMatch: "none",
              navigationFallback: "window.location.href",
              navigationTarget: stepAction.absoluteUrl || "",
            };
          }
        }

        return {
          action: "click",
          linkMatch: linkMatch.match,
          navigationFallback: "",
          navigationTarget: stepAction.absoluteUrl || "",
        };
      }

      const currentUrl = page.url();
      warnProgress(
        `No matching link for ${stepAction.absoluteUrl} (current page: ${currentUrl}). Using window.location.href.`
      );
      await page.evaluate((target) => {
        window.location.href = target;
      }, stepAction.absoluteUrl);
      return {
        action: "location",
        linkMatch: "none",
        navigationFallback: "window.location.href",
        navigationTarget: stepAction.absoluteUrl || "",
      };
    }

    if (stepAction.action === "click") {
      await page.waitForSelector(stepAction.selector, { state: "visible", timeout: 15000 });
      await page.click(stepAction.selector);
      return { action: "click", linkMatch: "", navigationFallback: "", navigationTarget: "" };
    }

    if (stepAction.action === "waitForSelector") {
      await page.waitForSelector(stepAction.selector, { state: stepAction.state || "visible", timeout: 15000 });
      return { action: "waitForSelector", linkMatch: "", navigationFallback: "", navigationTarget: "" };
    }

    if (stepAction.action === "noop") {
      return { action: "noop", linkMatch: "", navigationFallback: "", navigationTarget: "" };
    }

    throw new Error(`Unknown step.action: ${stepAction.action}`);
  }

  // Lets the step's late requests land, scrolls if enabled, then lets the
  // requests triggered by the scroll land too.
  async function settleStep() {
    await settle(page, cfg);
    await sleep(settlePauseMs);
    await autoScrollIfEnabled(page, cfg);
    await settle(page, cfg);
  }

  // Closes the step window, then measures what the step loaded. The caller
  // adds the result to the report: a step that timed out never gets there.
  async function measureStep({ step, stepIndex, name, windowStartMs }) {
    windowStartTimes.set(stepIndex, windowStartMs);
    windowEndTimes.set(stepIndex, Date.now());
    const pageUrl = page.url();
    const domNodes = await countDomNodes(page);
    const metrics = applyMode(await computeStepMetrics({
      cfg,
      step,
      stepIndex,
      cdpReq,
      decompressedFallbackByRequestId,
      windowStartTimes,
      windowEndTimes,
      page,
    }));
    const ecoindex = computeEcoindex({
      domNodes,
      sizeKb: metrics.compressed_kb,
      requests: metrics.request_count,
    });
    return {
      name,
      page_url: pageUrl,
      dom_nodes: domNodes,
      ecoindex_score: ecoindex.score,
      ecoindex_grade: ecoindex.grade,
      error: step?.error || "",
      ...metrics,
    };
  }

  async function doStep(step, idx) {
    currentStepIndex = idx;
    const startTarget = step?.absoluteUrl || step?.url || "";
    const startAction = step?.actions?.length ? "actions" : step?.action || "";
    const startName = step?.name || `Step ${idx}`;
    const startTargetSuffix = startTarget ? ` target=${startTarget}` : "";
    logProgress(`Step ${idx} starting action=${startAction}${startTargetSuffix} name=${startName}`);
    const actionStartMs = Date.now();

    const actions = Array.isArray(step.actions) && step.actions.length > 0 ? step.actions : [step];
    const actionNames = [];
    const actionErrors = [];
    const linkMatches = [];
    const navigationFallbacks = [];
    let navigationTarget = "";
    const urlBefore = page.url();

    for (const actionItem of actions) {
      try {
        const result = await executeAction(actionItem, step);
        if (result.action) actionNames.push(result.action);
        if (result.linkMatch) linkMatches.push(result.linkMatch);
        if (result.navigationFallback) navigationFallbacks.push(result.navigationFallback);
        if (result.navigationTarget) navigationTarget = result.navigationTarget;
      } catch (err) {
        // A timed-out step keeps running until the browser closes: stay quiet.
        if (journeyStopped) return;
        const actionError = `${actionItem.action || "unknown"}: ${err?.message || err}`;
        actionErrors.push(actionError.split("\n")[0]);
        warnProgress(`Action failed: ${actionError}`);
      }
    }

    step.error = actionErrors.join(" | ");

    step.actionTaken = actionNames.join(">") || "";
    step.linkMatch = linkMatches.join(">") || "";
    step.navigationFallback = navigationFallbacks.join(">") || "";

    let urlChanged = false;
    if (navigationTarget) {
      await page.waitForURL(navigationTarget, { timeout: 5000 })
        .then(() => {
          urlChanged = true;
        })
        .catch(() => {});
    }

    await settleStep();
    const urlAfter = page.url();
    if (!urlChanged && urlAfter !== urlBefore) {
      urlChanged = true;
    }

    const windowStartMs = urlChanged ? Math.max(0, actionStartMs - 300) : actionStartMs;
    return measureStep({ step, stepIndex: idx, name: startName, windowStartMs });
  }

  const steps = cfg.steps || [];
  const results = [];
  const applyMode = createModeAccumulator(cfg.mode || "per_step");

  // Step 0 is the landing on startUrl: its own actions are never run.
  logProgress(`Start at ${cfg.startUrl}`);
  const startActionMs = Date.now();
  await withTimeout(
    (async () => {
      await page.goto(cfg.startUrl, { waitUntil: "domcontentloaded" });
      await settleStep();
    })(),
    stepTimeoutMs,
    `Step 0 timed out after ${stepTimeoutMs} ms (${cfg.startUrl})`
  );
  results.push(await measureStep({
    step: steps[0],
    stepIndex: 0,
    name: steps[0]?.name || "Start",
    windowStartMs: startActionMs,
  }));
  logProgress("Step 0 completed");

  let incomplete = false;
  for (let i = 1; i < steps.length; i++) {
    let result;
    try {
      result = await withTimeout(doStep(steps[i], i), stepTimeoutMs, `Step ${i} timed out after ${stepTimeoutMs} ms`);
    } catch (err) {
      if (!(err instanceof StepTimeoutError)) throw err;
      // The page state is unknown: stop here and report the steps measured so far.
      warnProgress(`${err.message}. Remaining steps are skipped.`);
      results.push({
        stepIndex: i,
        name: steps[i].name || `Step ${i}`,
        page_url: page.url(),
        timedOut: true,
        error: err.message,
      });
      incomplete = true;
      journeyStopped = true;
      break;
    }
    results.push(result);
    const { notes } = result;
    const target = steps[i]?.absoluteUrl || steps[i]?.url || "";
    const matchSuffix = notes.linkMatch ? ` match=${notes.linkMatch}` : "";
    const actionSuffix = notes.action ? ` action=${notes.action}` : "";
    const targetSuffix = target ? ` target=${target}` : "";
    logProgress(`Step ${i} completed${actionSuffix}${targetSuffix}${matchSuffix}`);
  }

  logProgress(`Journey ${incomplete ? "stopped" : "completed"} (${results.length} steps)`);

  // Created only now: a run that fails before this point leaves no empty folder.
  const { outDir, runId } = createRunFolder(outRoot, cfg.name, startedAt);

  const requestDetails = {
    runId,
    generatedAt: new Date().toISOString(),
    viewport: { width: viewport.width, height: viewport.height },
    steps: [],
  };
  const report = {
    runId,
    name: cfg.name || "journey",
    startUrl: cfg.startUrl,
    mode: cfg.mode || "per_step",
    settle: cfg.settle || {},
    scroll: cfg.scroll || {},
    generatedAt: new Date().toISOString(),
    results,
    journeyEcoindex: computeJourneyEcoindex(results),
  };

  for (let i = 0; i < results.length; i += 1) {
    const result = results[i];
    const windowStartMs = windowStartTimes.get(result.stepIndex) ?? null;
    const windowEndMs = windowEndTimes.get(result.stepIndex) ?? null;
    const windowDurationMs =
      typeof windowStartMs === "number" && typeof windowEndMs === "number"
        ? Math.max(0, Math.round(windowEndMs - windowStartMs))
        : 0;

    const requests = [];
    for (const rec of cdpReq.values()) {
      if (rec.stepIndex !== result.stepIndex) continue;
      if (typeof windowStartMs === "number" && rec.requestStartMs < windowStartMs) continue;
      if (typeof windowEndMs === "number" && rec.requestStartMs > windowEndMs) continue;

      requests.push({
        request_id: rec.requestId,
        url: rec.url,
        method: rec.method || "",
        type: rec.type || "",
        status: rec.status ?? null,
        encoded_bytes: rec.encodedBytes ?? 0,
        request_start_ms: rec.requestStartMs ?? null,
        from_disk_cache: rec.fromDiskCache ?? false,
        from_service_worker: rec.fromServiceWorker ?? false,
        mime_type: rec.mimeType || "",
      });
    }

    requestDetails.steps.push({
      step_index: result.stepIndex,
      step_name: result.name,
      page_url: result.page_url || "",
      window_start_ms: windowStartMs,
      window_end_ms: windowEndMs,
      window_duration_ms: windowDurationMs,
      error: result.error || "",
      requests,
    });
  }

  return {
    report,
    outDir,
    runId,
    requestDetails,
    incomplete,
  };
}
