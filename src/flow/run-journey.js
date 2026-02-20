import fs from "node:fs";
import path from "node:path";

import { chromium } from "playwright";

import { logProgress, warnProgress } from "../utils/logger.js";
import { nowIsoSafe, sleep } from "../utils/time.js";
import { normalizeTrailingSlash } from "../utils/url.js";
import {
  autoScrollIfEnabled,
  bindResponseFallback,
  computeStepMetrics,
  createCdpTracker,
  settle,
} from "./collect-metrics.js";

function buildReportSchema() {
  return {
    step_index: "Index of the step (0 = start).",
    step_name: "Human-readable step name (url or provided name).",
    page_url: "Current page URL after the step finishes.",
    mode: "Measurement mode (per_step or cumulative).",
    decompressed_kb: "Estimated decompressed payload size in kB for this step.",
    compressed_kb: "Estimated compressed payload size in kB for this step.",
    request_count: "Number of network requests counted within the step window (start to end).",
    window_duration_ms: "Duration of the step window in milliseconds.",
    perf_decoded_coverage_pct: "Percent of requests with decodedBodySize available from ResourceTiming.",
    decompressed_method: "Method used to estimate decompressed size.",
    compressed_method: "Method used to estimate compressed size.",
    scroll_to_end: "Whether auto-scroll to end is enabled for this run.",
    link_match: "How a link href matched the target (absolute, relative, or none).",
    navigation_fallback: "Fallback navigation method when no link matched.",
    action: "Action taken for this step (click or location).",
  };
}

export async function runJourney({ cfg, cfgPath }) {
  const runId = `${(cfg.name || "journey").slice(0, 40)}__${nowIsoSafe()}`.replace(/\s+/g, "_");
  const outDir = path.join(path.dirname(cfgPath), `reports-${nowIsoSafe()}`);
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await context.newPage();

  const client = await context.newCDPSession(page);
  await client.send("Network.enable");

  let currentStepIndex = 0;
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
        warnProgress(`Action failed: ${actionItem.action || "unknown"} (${err?.message || err})`);
      }
    }

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

    await settle(page, cfg);
    await sleep(1000);
    await autoScrollIfEnabled(page, cfg);
    await settle(page, cfg);
    const urlAfter = page.url();
    if (!urlChanged && urlAfter !== urlBefore) {
      urlChanged = true;
    }

    const windowStartMs = urlChanged ? Math.max(0, actionStartMs - 300) : actionStartMs;
    windowStartTimes.set(idx, windowStartMs);
    windowEndTimes.set(idx, Date.now());
    step.pageUrl = page.url();
  }

  logProgress(`Start at ${cfg.startUrl}`);
  const startActionMs = Date.now();
  await page.goto(cfg.startUrl, { waitUntil: "domcontentloaded" });
  await settle(page, cfg);
  await sleep(1000);
  await autoScrollIfEnabled(page, cfg);
  await settle(page, cfg);
  windowStartTimes.set(0, startActionMs);
  windowEndTimes.set(0, Date.now());
  const startPageUrl = page.url();

  const baselineStepIndex = 0;
  const results = [];

  currentStepIndex = 0;
  results.push({
    name: cfg.steps?.[0]?.name || "Start",
    page_url: startPageUrl,
    ...(await computeStepMetrics({
      cfg,
      step: cfg.steps?.[0],
      stepIndex: 0,
      baselineStepIndex,
      cdpReq,
      decompressedFallbackByRequestId,
      windowStartTimes,
      windowEndTimes,
      page,
    }))
  });
  logProgress("Step 0 completed");

  const steps = cfg.steps || [];
  for (let i = 1; i < steps.length; i++) {
    await doStep(steps[i], i);
    const metrics = await computeStepMetrics({
      cfg,
      step: steps[i],
      stepIndex: i,
      baselineStepIndex,
      cdpReq,
      decompressedFallbackByRequestId,
      windowStartTimes,
      windowEndTimes,
      page,
    });
    results.push({ name: steps[i].name || `Step ${i}`, page_url: steps[i].pageUrl || "", ...metrics });
    const action = metrics?.notes?.action || "";
    const linkMatch = metrics?.notes?.linkMatch || "";
    const target = steps[i]?.absoluteUrl || steps[i]?.url || "";
    const matchSuffix = linkMatch ? ` match=${linkMatch}` : "";
    const actionSuffix = action ? ` action=${action}` : "";
    const targetSuffix = target ? ` target=${target}` : "";
    logProgress(`Step ${i} completed${actionSuffix}${targetSuffix}${matchSuffix}`);
  }

  logProgress(`Journey completed (${results.length} steps)`);

  const reportSchema = buildReportSchema();
  const report = {
    runId,
    name: cfg.name || "journey",
    startUrl: cfg.startUrl,
    mode: cfg.mode || "per_step",
    settle: cfg.settle || {},
    scroll: cfg.scroll || {},
    generatedAt: new Date().toISOString(),
    reportSchema,
    results,
  };

  await browser.close();

  return {
    report,
    reportSchema,
    outDir,
    runId,
  };
}
