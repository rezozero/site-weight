// Smoke run: serves ci/site locally, runs each smoke journey through the CLI
// and checks the reports it writes. Exits non-zero on the first failure.
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
    expectedPaths: ["/", "/page-2/", "/"],
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
    // Set by the journey's own "viewport" key.
    expectedViewport: { width: 1024, height: 768 },
  },
];

const HUMAN_COLUMNS = 11;
const TECHNICAL_COLUMNS = 20;

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
    const [index, , url, stepKb, compressedKb, , requests, domNodes] = human[i + 1];
    const stepLabel = `${label} step ${index}`;
    const error = human[i + 1][HUMAN_COLUMNS - 1];
    check(error === "", `${stepLabel}: unexpected error "${error}"`);
    check(url === new URL(expectedPath, baseUrl).toString(), `${stepLabel}: page url ${url}, expected ${expectedPath}`);
    check(Number(stepKb) >= 0 && Number(compressedKb) >= 0, `${stepLabel}: negative size (${stepKb} / ${compressedKb})`);
    check(Number(domNodes) > 0, `${stepLabel}: no DOM nodes counted`);
    if (i === 0) {
      check(Number(requests) >= 3, `${stepLabel}: ${requests} requests, expected the page, its CSS and its image`);
    } else if (journey.cumulative) {
      check(Number(requests) > previousRequests, `${stepLabel}: cumulative request count did not grow (${requests})`);
    }
    previousRequests = Number(requests);
  });

  const details = JSON.parse(fs.readFileSync(path.join(reportDir, requestsJson), "utf-8"));
  check(details.steps.length === stepCount, `${label}: requests JSON has ${details.steps.length} steps`);
  const { width, height } = details.viewport || {};
  const expected = journey.expectedViewport;
  check(
    width === expected.width && height === expected.height,
    `${label}: viewport ${width}x${height}, expected ${expected.width}x${expected.height}`
  );
  return reportDir;
}

// A run that fails before measuring anything (here, an unreachable startUrl)
// exits with code 1 and leaves no run folder behind.
async function checkFailedRun() {
  const label = "failed run";
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "site-weight-smoke-"));
  fs.writeFileSync(
    path.join(workDir, "journey.js"),
    "export default { name: \"Smoke failure\", startUrl: \"http://127.0.0.1:1/\", steps: [{ action: \"noop\" }] };\n"
  );
  try {
    const run = await runCli([workDir], process.env);
    check(run.status === 1, `${label}: CLI exited with ${run.status}, expected 1\n${run.output}`);
    const reportsRoot = path.join(workDir, "reports");
    const leftovers = fs.existsSync(reportsRoot) ? fs.readdirSync(reportsRoot) : [];
    check(leftovers.length === 0, `${label}: left ${leftovers.join(", ")} in ${reportsRoot}`);
    console.log(`ok ${label}`);
    return true;
  } catch (error) {
    console.error(`FAIL ${error.message}`);
    return false;
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
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

    if (!(await checkFailedRun())) {
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
