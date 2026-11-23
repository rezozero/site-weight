// Smoke run: serves ci/site locally, runs each smoke journey through the CLI
// and checks the reports it writes, then checks how the CLI handles invalid,
// failing and timed-out journeys. Exits non-zero if any check fails.
// Usage: node ci/smoke.js [--keep] [--cli <path>]
//   --keep  leave the reports on disk
//   --cli   run another copy of src/cli.js, e.g. the one from an installed tarball
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { computeEcoindex, computeFootprint, computeJourneyEcoindex } from "../src/utils/ecoindex.js";
import { createRunFolder } from "../src/utils/run-folder.js";

const CI_DIR = path.dirname(fileURLToPath(import.meta.url));
const SITE_DIR = path.join(CI_DIR, "site");
const { values: args } = parseArgs({
  options: {
    cli: { type: "string", default: path.join(CI_DIR, "..", "src", "cli.js") },
    keep: { type: "boolean", default: false },
  },
});
const CLI_PATH = path.resolve(args.cli);
const KEEP_REPORTS = args.keep;

const CONTENT_TYPES = {
  ".css": "text/css",
  ".html": "text/html; charset=utf-8",
  ".svg": "image/svg+xml",
};

const JOURNEYS = [
  {
    file: "journey.steps.js",
    runSlug: "smoke-steps",
    cliArgs: ["--viewport", "1920x1080"],
    useOutOption: true,
    cumulative: false,
    // The third step stays on page 2: three page views over four steps.
    expectedPaths: ["/", "/page-2/", "/page-2/", "/"],
    expectedViewport: { width: 1920, height: 1080 },
  },
  {
    file: "journey.urls.js",
    runSlug: "smoke-urls",
    cliArgs: [],
    useOutOption: false,
    // mode: "cumulative": each step counts the requests since the start.
    cumulative: true,
    expectedPaths: ["/", "/page-2/"],
    // Set by the journey's own "viewport" key. No "scroll" key: scrolls by default.
    expectedViewport: { width: 1024, height: 768 },
  },
];

const HUMAN_COLUMNS = 13;
const TECHNICAL_COLUMNS = 22;
// The error column, followed by the GES and water columns.
const HUMAN_ERROR_COLUMN = HUMAN_COLUMNS - 3;
const TECHNICAL_ERROR_COLUMN = TECHNICAL_COLUMNS - 3;

// The GES and water cells of a row hold the footprint of its EcoIndex score.
function checkFootprint(ges, water, score, label) {
  const expected = computeFootprint(Number(score));
  check(
    Number(ges) === expected.ges && Number(water) === expected.water,
    `${label}: GES / water "${ges}" / "${water}", expected ${expected.ges} / ${expected.water} for EcoIndex ${score}`
  );
}

// EcoIndex DOM count of ci/site/index.html: its elements plus the two of the
// open shadow root, minus the three descendants of the inline <svg>.
const HOME_DOM_NODES = 20;
// Lazy-loaded image at the bottom of the home page, loaded by the scroll.
const LAZY_IMAGE_QUERY = "?below-the-fold";

// Async on purpose: a synchronous spawn would block the site server running in
// this same process.
function runCli(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI_PATH, ...args], { env });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    child.on("close", (status) => resolve({ status, output }));
  });
}

function startSiteServer() {
  const server = http.createServer((req, res) => {
    const urlPath = new URL(req.url, "http://localhost").pathname;
    const filePath = path.join(SITE_DIR, urlPath.endsWith("/") ? `${urlPath}index.html` : urlPath);
    if (!filePath.startsWith(SITE_DIR) || !fs.existsSync(filePath)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "content-type": CONTENT_TYPES[path.extname(filePath)] || "application/octet-stream" });
    fs.createReadStream(filePath).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

// A free local port: the connection is refused, unlike the ports Chromium
// blocks as unsafe (port 1 fails with ERR_UNSAFE_PORT before connecting).
function findClosedPort() {
  return new Promise((resolve) => {
    const server = http.createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

// Quoted fields never contain line breaks in these reports.
function parseCsvLine(line) {
  const fields = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted && char === "\"" && line[i + 1] === "\"") {
      field += "\"";
      i += 1;
    } else if (char === "\"") {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      fields.push(field);
      field = "";
    } else {
      field += char;
    }
  }
  fields.push(field);
  return fields;
}

function readCsv(filePath) {
  return fs.readFileSync(filePath, "utf-8").split("\n").map(parseCsvLine);
}

function check(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function checkReports(journey, reportsRoot, baseUrl, label) {
  const reportDirs = fs.existsSync(reportsRoot) ? fs.readdirSync(reportsRoot) : [];
  check(reportDirs.length === 1, `${label}: expected one run folder in ${reportsRoot}, found ${reportDirs.length}`);
  const runId = reportDirs[0];
  const runIdPattern = new RegExp(`^\\d{4}-\\d{2}-\\d{2}_\\d{2}-\\d{2}-\\d{2}_${journey.runSlug}$`);
  check(runIdPattern.test(runId), `${label}: run folder "${runId}" is not <YYYY-MM-DD_HH-mm-ss>_${journey.runSlug}`);
  const reportDir = path.join(reportsRoot, runId);
  const files = fs.readdirSync(reportDir);
  const humanCsv = `${runId}.csv`;
  const technicalCsv = `technical_${runId}.csv`;
  const requestsJson = `requests_${runId}.json`;
  check(
    [humanCsv, technicalCsv, requestsJson].every((name) => files.includes(name)),
    `${label}: missing report files (${files.join(", ")})`
  );

  const stepCount = journey.expectedPaths.length;
  const human = readCsv(path.join(reportDir, humanCsv));
  const technical = readCsv(path.join(reportDir, technicalCsv));
  check(human.length === stepCount + 2, `${label}: human CSV has ${human.length} lines, expected ${stepCount + 2}`);
  check(technical.length === stepCount + 2, `${label}: technical CSV has ${technical.length} lines, expected ${stepCount + 2}`);
  human.forEach((row, i) => check(row.length === HUMAN_COLUMNS, `${label}: human CSV line ${i + 1} has ${row.length} columns`));
  technical.forEach((row, i) => check(
    row.length === TECHNICAL_COLUMNS,
    `${label}: technical CSV line ${i + 1} has ${row.length} columns`
  ));
  check(human.at(-1)[0] === "Moyenne", `${label}: human CSV has no average row`);

  let previousRequests = 0;
  journey.expectedPaths.forEach((expectedPath, i) => {
    const [index, , url, stepKb, compressedKb, , requests, domNodes, score, , , ges, water] = human[i + 1];
    const stepLabel = `${label} step ${index}`;
    const error = human[i + 1][HUMAN_ERROR_COLUMN];
    check(error === "", `${stepLabel}: unexpected error "${error}"`);
    check(url === new URL(expectedPath, baseUrl).toString(), `${stepLabel}: page url ${url}, expected ${expectedPath}`);
    check(Number(stepKb) >= 0 && Number(compressedKb) >= 0, `${stepLabel}: negative size (${stepKb} / ${compressedKb})`);
    check(Number(domNodes) > 0, `${stepLabel}: no DOM nodes counted`);
    if (expectedPath === "/") {
      check(Number(domNodes) === HOME_DOM_NODES, `${stepLabel}: ${domNodes} DOM nodes, expected ${HOME_DOM_NODES}`);
    }
    // EcoIndex scores are whole numbers.
    check(/^\d+$/.test(score), `${stepLabel}: EcoIndex "${score}" is not a whole number`);
    checkFootprint(ges, water, score, stepLabel);
    if (i === 0) {
      check(Number(requests) >= 4, `${stepLabel}: ${requests} requests, expected the page, its CSS and its two images`);
    } else if (journey.cumulative) {
      check(Number(requests) > previousRequests, `${stepLabel}: cumulative request count did not grow (${requests})`);
    }
    previousRequests = Number(requests);
  });

  // The average row holds the journey EcoIndex and the per page view averages
  // it is computed from. Consecutive steps on the same URL make one page view:
  // their requests and sizes add up, the page view keeps the largest DOM.
  const stepRows = human.slice(1, -1);
  const pageViews = [];
  stepRows.forEach((row, i) => {
    // In cumulative mode, a step's own values are the growth of the totals.
    const ownValue = (column) => Number(row[column]) - (journey.cumulative && i > 0 ? Number(stepRows[i - 1][column]) : 0);
    const view = { url: row[2], kb: ownValue(4), requests: ownValue(6), dom: Number(row[7]) };
    const current = pageViews.at(-1);
    if (current && current.url === view.url) {
      current.kb += view.kb;
      current.requests += view.requests;
      current.dom = Math.max(current.dom, view.dom);
    } else {
      pageViews.push(view);
    }
  });
  const pageViewAverage = (key) => pageViews.reduce((sum, view) => sum + view[key], 0) / pageViews.length;
  const averageRow = human.at(-1);
  const [, , , , averageCompressed, , averageRequests, averageDomNodes, journeyScore, journeyGrade, , journeyGes, journeyWater] =
    averageRow;
  checkFootprint(journeyGes, journeyWater, journeyScore, `${label} average row`);
  check(
    averageRequests === pageViewAverage("requests").toFixed(1),
    `${label}: average requests per page view ${averageRequests}, expected ${pageViewAverage("requests").toFixed(1)}`
  );
  check(
    averageDomNodes === pageViewAverage("dom").toFixed(1),
    `${label}: average DOM nodes ${averageDomNodes}, expected ${pageViewAverage("dom").toFixed(1)}`
  );
  // The step sizes are rounded to 0.1 kB, so their sum can be off by a little.
  check(
    Math.abs(Number(averageCompressed) - pageViewAverage("kb")) <= 0.1,
    `${label}: average kB per page view ${averageCompressed}, expected about ${pageViewAverage("kb").toFixed(1)}`
  );
  check(
    /^\d+$/.test(journeyScore) && Number(journeyScore) <= 100 && /^[A-G]$/.test(journeyGrade),
    `${label}: journey EcoIndex "${journeyScore}" / "${journeyGrade}" in the average row`
  );
  const technicalAverage = technical.at(-1);
  check(
    technicalAverage[3] === averageDomNodes &&
      technicalAverage[7] === averageCompressed &&
      technicalAverage[8] === averageRequests &&
      technicalAverage[10] === journeyScore &&
      technicalAverage[11] === journeyGrade &&
      technicalAverage[20] === journeyGes &&
      technicalAverage[21] === journeyWater,
    `${label}: technical average row does not match the human one`
  );

  const details = JSON.parse(fs.readFileSync(path.join(reportDir, requestsJson), "utf-8"));
  check(details.steps.length === stepCount, `${label}: requests JSON has ${details.steps.length} steps`);
  const { width, height } = details.viewport || {};
  const expected = journey.expectedViewport;
  check(
    width === expected.width && height === expected.height,
    `${label}: viewport ${width}x${height}, expected ${expected.width}x${expected.height}`
  );
  check(
    details.steps[0].requests.some((request) => request.url.endsWith(LAZY_IMAGE_QUERY)),
    `${label}: the lazy image at the bottom of the home page was not loaded by the scroll`
  );
  return reportDir;
}

// The EcoIndex formula and the journey score, on fixed values.
function checkEcoindexComputation() {
  const label = "EcoIndex computation";
  try {
    // Raw score 80.25: EcoIndex rounds it to 80 before grading it, so B, not A.
    const boundary = computeEcoindex({ domNodes: 470, sizeKb: 0, requests: 0 });
    check(boundary.score === 80 && boundary.grade === "B", `${label}: ${JSON.stringify(boundary)}, expected 80 (B)`);
    // EcoIndex_python: 2 + 2 * (50 - 80) / 100 gCO2e and 3 + 3 * (50 - 80) / 100 cl.
    check(boundary.ges === 1.4 && boundary.water === 2.1, `${label}: footprint ${JSON.stringify(boundary)}, expected 1.4 gCO2e / 2.1 cl`);
    for (const [score, ges, water] of [[0, 3, 4.5], [50, 2, 3], [100, 1, 1.5], [37, 2.26, 3.39]]) {
      const footprint = computeFootprint(score);
      check(
        footprint.ges === ges && footprint.water === water,
        `${label}: footprint of ${score} ${JSON.stringify(footprint)}, expected ${ges} gCO2e / ${water} cl`
      );
    }

    // Same URL (hash aside): one page view; the failed step is left out.
    const journey = computeJourneyEcoindex([
      { page_url: "https://example.com/a", step_compressed_kb: 100, step_request_count: 10, dom_nodes: 500, error: "" },
      { page_url: "https://example.com/a#menu", step_compressed_kb: 20, step_request_count: 2, dom_nodes: 600, error: "" },
      { page_url: "https://example.com/b", step_compressed_kb: 50, step_request_count: 5, dom_nodes: 300, error: "" },
      { page_url: "https://example.com/c", step_compressed_kb: 900, step_request_count: 90, dom_nodes: 900, error: "click: failed" },
    ]);
    const expected = { pageCount: 2, leftOutCount: 1, compressedKb: 85, requests: 8.5, domNodes: 450 };
    for (const [key, value] of Object.entries(expected)) {
      check(journey[key] === value, `${label}: journey ${key} ${journey[key]}, expected ${value}`);
    }
    console.log(`ok ${label}`);
    return true;
  } catch (error) {
    console.error(`FAIL ${error.message}`);
    return false;
  }
}

const TIMEOUT_STEP_MS = 5000;

// The step after the failed action times out: the reports keep steps 0 to 3,
// the timed-out one with its error only, and step 4 never runs.
function checkTimeoutReports(reportDir, runId, baseUrl, label) {
  const human = readCsv(path.join(reportDir, `${runId}.csv`));
  const technical = readCsv(path.join(reportDir, `technical_${runId}.csv`));
  // Header, steps 0 to 3, average row.
  check(human.length === 6, `${label}: human CSV has ${human.length} lines, expected 6`);
  check(technical.length === 6, `${label}: technical CSV has ${technical.length} lines, expected 6`);
  human.forEach((row, i) => check(row.length === HUMAN_COLUMNS, `${label}: human CSV line ${i + 1} has ${row.length} columns`));
  technical.forEach((row, i) => check(
    row.length === TECHNICAL_COLUMNS,
    `${label}: technical CSV line ${i + 1} has ${row.length} columns`
  ));

  const stepRows = human.slice(1, -1);
  const errors = stepRows.map((row) => row[HUMAN_ERROR_COLUMN]);
  const technicalErrors = technical.slice(1, -1).map((row) => row[TECHNICAL_ERROR_COLUMN]);
  check(errors[0] === "" && errors[1] === "", `${label}: unexpected error on steps 0-1 ("${errors[0]}", "${errors[1]}")`);
  check(
    stepRows[1][2] === new URL("/page-2/", baseUrl).toString(),
    `${label}: goto step ended on ${stepRows[1][2]}, expected /page-2/`
  );
  check(errors[2].startsWith("hover: Unknown step.action"), `${label}: failed action error "${errors[2]}"`);
  check(
    errors[3].startsWith(`Step 3 timed out after ${TIMEOUT_STEP_MS} ms`),
    `${label}: timed-out step error "${errors[3]}"`
  );
  check(
    technicalErrors.every((error, i) => error === errors[i]),
    `${label}: technical CSV errors do not match the human ones`
  );

  const details = JSON.parse(fs.readFileSync(path.join(reportDir, `requests_${runId}.json`), "utf-8"));
  check(details.steps.length === 4, `${label}: requests JSON has ${details.steps.length} steps, expected 4`);
}

// Journeys the CLI must reject or stop, all with exit code 1. Each journey is
// built from `urls`: `baseUrl`, the local site, and `closedUrl`, a local port
// nothing listens on. Without `checkReports`, the run must leave no run folder
// behind.
const FAILURE_CASES = [
  {
    label: "invalid startUrl",
    journey: () => ({ name: "Smoke bad start", startUrl: "example.com", steps: [{ action: "noop" }] }),
    output: /steps require startUrl/,
  },
  {
    label: "invalid mode",
    journey: ({ baseUrl }) => ({ name: "Smoke bad mode", startUrl: baseUrl, mode: "total", steps: [{ action: "noop" }] }),
    output: /mode must be one of/,
  },
  {
    // Fails on the first step, before measuring anything.
    label: "unreachable startUrl",
    journey: ({ closedUrl }) => ({ name: "Smoke unreachable", startUrl: closedUrl, steps: [{ action: "noop" }] }),
    output: /ERR_CONNECTION_REFUSED/,
  },
  {
    label: "failed action and step timeout",
    journey: ({ baseUrl }) => ({
      name: "Smoke timeout",
      startUrl: baseUrl,
      stepTimeoutMs: TIMEOUT_STEP_MS,
      settle: { extraMs: 100, pauseMs: 0 },
      // Keeps the landing well under the step timeout.
      scroll: { enabled: false },
      steps: [
        { name: "Home", action: "noop" },
        { name: "Page 2", action: "goto", url: new URL("/page-2/", baseUrl).toString() },
        { name: "Unknown action", action: "hover" },
        { name: "Missing element", action: "waitForSelector", selector: "#missing" },
        { name: "Never run", action: "noop" },
      ],
    }),
    output: /Journey stopped on a step timeout/,
    checkReports: checkTimeoutReports,
  },
];

async function checkFailureCase(failureCase, urls) {
  const { label } = failureCase;
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "site-weight-smoke-"));
  fs.writeFileSync(
    path.join(workDir, "journey.js"),
    `export default ${JSON.stringify(failureCase.journey(urls), null, 2)};\n`
  );
  try {
    const run = await runCli([workDir], process.env);
    check(run.status === 1, `${label}: CLI exited with ${run.status}, expected 1\n${run.output}`);
    check(failureCase.output.test(run.output), `${label}: output does not match ${failureCase.output}\n${run.output}`);
    const reportsRoot = path.join(workDir, "reports");
    const runFolders = fs.existsSync(reportsRoot) ? fs.readdirSync(reportsRoot) : [];
    if (failureCase.checkReports) {
      check(runFolders.length === 1, `${label}: expected one run folder in ${reportsRoot}, found ${runFolders.length}`);
      failureCase.checkReports(path.join(reportsRoot, runFolders[0]), runFolders[0], urls.baseUrl, label);
    } else {
      check(runFolders.length === 0, `${label}: left ${runFolders.join(", ")} in ${reportsRoot}`);
    }
    console.log(`ok ${label}${KEEP_REPORTS ? ` (${workDir})` : ""}`);
    return true;
  } catch (error) {
    console.error(`FAIL ${error.message}`);
    return false;
  } finally {
    if (!KEEP_REPORTS) {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  }
}

async function checkHelp() {
  const label = "--help";
  const run = await runCli(["--help"], process.env);
  try {
    check(run.status === 0, `${label}: CLI exited with ${run.status}\n${run.output}`);
    check(/^Usage: site-weight /.test(run.output), `${label}: no usage in the output\n${run.output}`);
    console.log(`ok ${label}`);
    return true;
  } catch (error) {
    console.error(`FAIL ${error.message}`);
    return false;
  }
}

// Two runs of a journey started in the same second: the second folder gets a
// "-2" suffix. The CLI cannot start two runs in one second on demand, so this
// calls the module directly (the repository's copy, even with --cli).
function checkRunFolderSuffix() {
  const label = "run folder suffix";
  const reportsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "site-weight-smoke-"));
  try {
    const startedAt = new Date(2026, 0, 2, 3, 4, 5);
    const first = createRunFolder(reportsRoot, "Smoke suffix", startedAt);
    const second = createRunFolder(reportsRoot, "Smoke suffix", startedAt);
    check(first.runId === "2026-01-02_03-04-05_smoke-suffix", `${label}: first run folder "${first.runId}"`);
    check(second.runId === `${first.runId}-2`, `${label}: second run folder "${second.runId}", expected "${first.runId}-2"`);
    check(fs.existsSync(second.outDir), `${label}: ${second.outDir} was not created`);
    console.log(`ok ${label}`);
    return true;
  } catch (error) {
    console.error(`FAIL ${error.message}`);
    return false;
  } finally {
    fs.rmSync(reportsRoot, { recursive: true, force: true });
  }
}

async function main() {
  const server = await startSiteServer();
  const baseUrl = `http://127.0.0.1:${server.address().port}/`;
  let failed = false;

  try {
    for (const journey of JOURNEYS) {
      const label = journey.file;
      // A temp CommonJS project outside the repository, like most user
      // projects: journey.js must still load as an ES module there.
      const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "site-weight-smoke-"));
      fs.writeFileSync(path.join(workDir, "package.json"), "{ \"type\": \"commonjs\" }\n");
      fs.copyFileSync(path.join(CI_DIR, journey.file), path.join(workDir, "journey.js"));
      const outDir = path.join(workDir, "out");
      const outArgs = journey.useOutOption ? ["--out", outDir] : [];
      const run = await runCli([workDir, ...journey.cliArgs, ...outArgs], { ...process.env, SITE_WEIGHT_SMOKE_URL: baseUrl });

      try {
        check(run.status === 0, `${label}: CLI exited with ${run.status}\n${run.output}`);
        check(/Journey EcoIndex: [\d.]+ \([A-G]\)/.test(run.output), `${label}: no journey EcoIndex in the output`);
        const defaultReportsRoot = path.join(workDir, "reports");
        if (journey.useOutOption) {
          check(!fs.existsSync(defaultReportsRoot), `${label}: --out ignored, reports written next to the journey`);
        }
        const reportDir = checkReports(journey, journey.useOutOption ? outDir : defaultReportsRoot, baseUrl, label);
        console.log(`ok ${label}${KEEP_REPORTS ? ` (${reportDir})` : ""}`);
      } catch (error) {
        failed = true;
        console.error(`FAIL ${error.message}`);
      } finally {
        if (!KEEP_REPORTS) {
          fs.rmSync(workDir, { recursive: true, force: true });
        }
      }
    }

    const closedUrl = `http://127.0.0.1:${await findClosedPort()}/`;
    for (const failureCase of FAILURE_CASES) {
      if (!(await checkFailureCase(failureCase, { baseUrl, closedUrl }))) {
        failed = true;
      }
    }
    if (!(await checkHelp()) || !checkRunFolderSuffix() || !checkEcoindexComputation()) {
      failed = true;
    }
  } finally {
    server.close();
  }

  if (failed) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
