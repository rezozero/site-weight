import { warnProgress } from "../utils/logger.js";
import { sleep } from "../utils/time.js";

// kB of 1000 bytes, the unit of the EcoIndex size quantiles (EcoIndex_python
// and GreenIT-Analysis both divide the transferred bytes by 1000).
const KB = 1000;

function toKb(bytes) {
  return Math.round((bytes / KB) * 10) / 10;
}

function urlIsCounted(url) {
  if (!url) return false;
  return !(
    url.startsWith("data:") ||
    url.startsWith("about:") ||
    url.startsWith("blob:") ||
    url.startsWith("ws:") ||
    url.startsWith("wss:")
  );
}

export function createCdpTracker(client, getCurrentStepIndex) {
  const cdpReq = new Map();
  const decompressedFallbackByRequestId = new Map();

  client.on("Network.requestWillBeSent", (evt) => {
    const url = evt?.request?.url;
    if (!urlIsCounted(url)) return;
    const requestStartMs = typeof evt?.wallTime === "number" ? evt.wallTime * 1000 : Date.now();
    cdpReq.set(evt.requestId, {
      requestId: evt.requestId,
      url,
      method: evt.request?.method,
      type: null,
      encodedBytes: 0,
      stepIndex: getCurrentStepIndex(),
      requestStartMs,
    });
  });

  client.on("Network.responseReceived", (evt) => {
    const rec = cdpReq.get(evt.requestId);
    if (!rec) return;
    rec.type = evt.type || rec.type;
    rec.status = evt.response?.status;
    rec.mimeType = evt.response?.mimeType;
    rec.fromDiskCache = !!evt.response?.fromDiskCache;
    rec.fromServiceWorker = !!evt.response?.fromServiceWorker;
  });

  client.on("Network.loadingFinished", (evt) => {
    const rec = cdpReq.get(evt.requestId);
    if (!rec) return;
    // Every byte received for the request, response headers included.
    rec.encodedBytes += Number(evt.encodedDataLength || 0);
  });

  return {
    cdpReq,
    decompressedFallbackByRequestId,
  };
}

export function bindResponseFallback(page, decompressedFallbackByRequestId, cdpReq, getCurrentStepIndex) {
  page.on("response", async (resp) => {
    const url = resp.url();
    if (!urlIsCounted(url)) return;
    try {
      const buf = await resp.body();
      const bytes = buf?.byteLength ?? 0;

      let bestId = null;
      for (const [rid, rec] of cdpReq) {
        if (rec.url === url && rec.stepIndex === getCurrentStepIndex()) bestId = rid;
      }
      if (bestId) decompressedFallbackByRequestId.set(bestId, bytes);
    } catch {
      // ignore
    }
  });
}

// EcoIndex_python DOM count (scraper/scrap.py, get_nodes_count): every element
// of the page, those of open shadow roots included (Playwright CSS locators
// pierce them), minus the descendants of <svg> elements. Iframe contents are
// not counted.
export async function countDomNodes(page) {
  const nodes = await page.locator("*").count();
  const svgDescendants = await page.locator("xpath=//*[local-name()='svg']//*").count();
  return Math.max(0, nodes - svgDescendants);
}

// ResourceTiming keeps 250 entries by default and drops the rest: raise the
// limit on every new document, before the page starts loading resources.
export async function raiseResourceTimingBuffer(context) {
  await context.addInitScript(() => {
    performance.setResourceTimingBufferSize(10000);
  });
}

// Returns the navigation and resource entries of the current document, with
// `startMs` as an epoch timestamp so they can be matched to a step window.
export async function perfSizes(page) {
  return await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0];
    const res = performance.getEntriesByType("resource");
    const entries = [];
    if (nav) entries.push(nav);
    for (const e of res) entries.push(e);
    return entries.map((e) => ({
      name: e.name,
      entryType: e.entryType,
      initiatorType: e.initiatorType || "navigation",
      startMs: performance.timeOrigin + e.startTime,
      transferSize: e.transferSize || 0,
      encodedBodySize: e.encodedBodySize || 0,
      decodedBodySize: e.decodedBodySize || 0,
    }));
  });
}

// Requests of one step: the cumulative mode adds up these per-step slices in
// run-journey.js, so the slice itself never depends on the mode. A request
// belongs to the step that was current when it started: run-journey.js moves
// to the next step as soon as a step window closes, so a request started
// between two steps counts in the next one.
export function snapshotFromCdp(cdpReq, stepIndex, windowEndTimes) {
  const list = [];
  const windowEndMs = windowEndTimes?.get(stepIndex);
  for (const rec of cdpReq.values()) {
    if (!urlIsCounted(rec.url)) continue;
    if (rec.stepIndex !== stepIndex) continue;
    if (typeof windowEndMs === "number" && rec.requestStartMs > windowEndMs) continue;
    list.push(rec);
  }
  return list;
}

export async function computeStepMetrics({
  cfg,
  step,
  stepIndex,
  cdpReq,
  decompressedFallbackByRequestId,
  windowStartTimes,
  windowEndTimes,
  page,
}) {
  const mode = cfg.mode || "per_step";
  const windowStartMs = windowStartTimes.get(stepIndex);
  const windowEndMs = windowEndTimes?.get(stepIndex);
  const windowDurationMs =
    typeof windowStartMs === "number" && typeof windowEndMs === "number"
      ? Math.max(0, Math.round(windowEndMs - windowStartMs))
      : 0;

  const cdpSlice = snapshotFromCdp(cdpReq, stepIndex, windowEndTimes);
  const compressedBytes = cdpSlice.reduce((acc, r) => acc + (r.encodedBytes || 0), 0);
  const requestCount = cdpSlice.length;

  // The document keeps the entries of earlier steps (SPA navigation): only
  // count the ones that started after the previous step window closed, like
  // the CDP slice. The first step has no previous window: its own start applies.
  const previousWindowEndMs = windowEndTimes.get(stepIndex - 1);
  const perf = await perfSizes(page);
  let decodedFromPerf = 0;
  let decodedPerfCounted = 0;
  for (const e of perf) {
    if (typeof previousWindowEndMs === "number") {
      if (e.startMs <= previousWindowEndMs) continue;
    } else if (typeof windowStartMs === "number" && e.startMs < windowStartMs) {
      continue;
    }
    if (typeof windowEndMs === "number" && e.startMs > windowEndMs) continue;
    if (e.decodedBodySize > 0) {
      decodedFromPerf += e.decodedBodySize;
      decodedPerfCounted++;
    }
  }

  let decodedFallback = 0;
  let decodedFallbackCounted = 0;
  for (const r of cdpSlice) {
    const fb = decompressedFallbackByRequestId.get(r.requestId);
    if (typeof fb === "number" && fb > 0) {
      decodedFallback += fb;
      decodedFallbackCounted++;
    }
  }

  const perfCoverage = requestCount > 0 ? decodedPerfCounted / requestCount : 0;
  const decompressedBytes = perfCoverage >= 0.3 ? decodedFromPerf : decodedFallback;

  return {
    stepIndex,
    mode,
    compressed_kb: toKb(compressedBytes),
    step_decompressed_kb: toKb(decompressedBytes),
    request_count: requestCount,
    window_duration_ms: windowDurationMs,
    notes: {
      perfDecodedCoveragePct: Math.round(perfCoverage * 100),
      decompressedMethod: perfCoverage >= 0.3 ? "ResourceTiming(decodedBodySize)" : "Playwright(response.body) best-effort",
      compressedMethod: "CDP Network.loadingFinished encodedDataLength (bytes received incl. headers)",
      scrollToEnd: scrollIsEnabled(cfg),
      linkMatch: step?.linkMatch || "",
      navigationFallback: step?.navigationFallback || "",
      action: step?.actionTaken || "",
    },
  };
}

export async function settle(page, cfg) {
  const waitUntil = cfg?.settle?.waitUntil || "networkidle";
  const extraMs = Number(cfg?.settle?.extraMs ?? 1000);
  if (waitUntil === "networkidle") {
    await page.waitForLoadState(waitUntil, { timeout: 5000 }).catch(() => {});
  } else {
    await page.waitForLoadState(waitUntil);
  }
  if (extraMs > 0) await sleep(extraMs);
}

// EcoIndex scrolls every page to the bottom before measuring it, so that
// lazy-loaded content counts: on by default, `scroll.enabled: false` turns it off.
function scrollIsEnabled(cfg) {
  return cfg.scroll?.enabled !== false;
}

// Bounds the wait for an idle network after each scroll step: on a page that
// never goes idle (polling, streaming), the scroll keeps going down. The
// requests started by the scroll finish during the settle pass that follows.
const SCROLL_STEP_IDLE_TIMEOUT_MS = 2000;

export async function autoScrollIfEnabled(page, cfg) {
  if (!scrollIsEnabled(cfg)) return;
  const sc = cfg.scroll || {};

  const mode = sc.mode || "page";
  const stepPx = Number(sc.stepPx ?? 800);
  const pauseMs = Number(sc.pauseMs ?? 250);
  const maxMs = Number(sc.maxMs ?? 30000);
  const backToTop = !!sc.backToTop;
  const selector = sc.selector;

  const started = Date.now();
  let reachedEnd = false;

  while (Date.now() - started < maxMs) {
    const { done } = await page.evaluate(
      ({ mode, stepPx, selector }) => {
        function scrollEl(el, dy) {
          const before = el.scrollTop;
          el.scrollTop = Math.min(el.scrollTop + dy, el.scrollHeight);
          const after = el.scrollTop;
          const atBottom = after + el.clientHeight >= el.scrollHeight - 2;
          return { moved: after !== before, atBottom };
        }

        if (mode === "selector") {
          const el = selector ? document.querySelector(selector) : null;
          if (!el) return { done: true, reason: "no-element" };
          const r = scrollEl(el, stepPx);
          return { done: r.atBottom || !r.moved };
        }
        const beforeY = window.scrollY;
        window.scrollBy(0, stepPx);
        const afterY = window.scrollY;
        const atBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 2;
        return { done: atBottom || afterY === beforeY };
      },
      { mode, stepPx, selector }
    );

    await sleep(pauseMs);
    await page.waitForLoadState("networkidle", { timeout: SCROLL_STEP_IDLE_TIMEOUT_MS }).catch(() => {});
    await sleep(150);

    if (done) {
      reachedEnd = true;
      break;
    }
  }

  if (!reachedEnd) {
    warnProgress(
      `Scroll stopped after scroll.maxMs (${maxMs} ms) before the end of ${page.url()}: ` +
        "content further down may not be loaded nor counted."
    );
  }

  if (backToTop) {
    if ((cfg.scroll || {}).mode === "selector" && (cfg.scroll || {}).selector) {
      await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (el) el.scrollTop = 0;
      }, cfg.scroll.selector);
    } else {
      await page.evaluate(() => window.scrollTo(0, 0));
    }
    await sleep(200);
  }
}
