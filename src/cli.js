#!/usr/bin/env node
import path from "node:path";
import { parseArgs } from "node:util";

import { loadConfig } from "./flow/load-config.js";
import { runJourney } from "./flow/run-journey.js";
import { writeReport } from "./flow/write-report.js";
import { logProgress } from "./utils/logger.js";
import { parseViewport } from "./utils/viewport.js";

const USAGE = `Usage: site-weight <journey.js|folder> [options]

Options:
  --out <dir>        Folder that receives one sub-folder per run (default: <journey folder>/reports)
  --viewport <WxH>   Browser viewport, e.g. 1920x1080 (default: the journey "viewport", else 1366x768)
  --headed           Show the browser window instead of running headless
  -h, --help         Show this help`;

class UsageError extends Error {}

function parseCliArgs(args) {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      options: {
        out: { type: "string" },
        viewport: { type: "string" },
        headed: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
    });
  } catch (error) {
    throw new UsageError(error.message);
  }

  const { values, positionals } = parsed;
  if (values.help) {
    return { help: true };
  }
  if (positionals.length !== 1) {
    throw new UsageError("Expected exactly one journey path.");
  }

  let viewport;
  if (values.viewport !== undefined) {
    viewport = parseViewport(values.viewport);
    if (!viewport) {
      throw new UsageError(`Invalid --viewport "${values.viewport}": expected WIDTHxHEIGHT, e.g. 1920x1080.`);
    }
  }

  return {
    journeyPath: positionals[0],
    outRoot: values.out === undefined ? undefined : path.resolve(process.cwd(), values.out),
    viewport,
    headed: values.headed,
  };
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));
  if (options.help) {
    console.log(USAGE);
    return;
  }

  const { cfg, cfgPath } = await loadConfig(options.journeyPath);
  logProgress(`Loading config from ${cfgPath}`);
  logProgress(`Config loaded (name: ${cfg.name || "journey"}, steps: ${cfg.steps?.length || 0})`);

  const { report, outDir, runId, requestDetails, incomplete } = await runJourney({
    cfg,
    cfgPath,
    outRoot: options.outRoot,
    viewport: options.viewport,
    headed: options.headed,
  });
  const { csvPath, technicalCsvPath, requestsPath } = writeReport({
    report,
    outDir,
    runId,
    requestDetails,
  });

  console.log(`OK: ${csvPath}`);
  console.log(`OK: ${technicalCsvPath}`);
  if (requestsPath) {
    console.log(`OK: ${requestsPath}`);
  }
  if (incomplete) {
    console.error("Journey stopped on a step timeout: the reports only cover the steps before it.");
    process.exitCode = 1;
  }
}

main().catch((err) => {
  if (err instanceof UsageError) {
    console.error(`${err.message}\n\n${USAGE}`);
  } else {
    console.error(err);
  }
  process.exit(1);
});
