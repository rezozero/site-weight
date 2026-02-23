#!/usr/bin/env node
import { loadConfig } from "./flow/load-config.js";
import { runJourney } from "./flow/run-journey.js";
import { writeReport } from "./flow/write-report.js";
import { logProgress } from "./utils/logger.js";

async function main() {
  const inputArg = process.argv[2];
  const { cfg, cfgPath } = await loadConfig(inputArg);
  logProgress(`Loading config from ${cfgPath}`);
  logProgress(`Config loaded (name: ${cfg.name || "journey"}, steps: ${cfg.steps?.length || 0})`);

  const { report, outDir, runId, requestDetails } = await runJourney({ cfg, cfgPath });
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
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
