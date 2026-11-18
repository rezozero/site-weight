import fs from "node:fs";
import path from "node:path";

const TECHNICAL_HEADER =
  "step_index,step_name,page_url,dom_nodes,mode,decompressed_kb,decompressed_kb_delta,compressed_kb,request_count,window_duration_ms,ecoindex_score,ecoindex_grade,perf_decoded_coverage_pct,decompressed_method,compressed_method,scroll_to_end,link_match,navigation_fallback,action,error";
const HUMAN_HEADER =
  "index,name,url,taille (decompressé kB),taille (compressé kB),taille cumulative (decompressé kB),nombre de requete,dom_nodes,ecoindex,note,erreur";

// Sums of one-decimal kB values drift (0.1 + 0.2): keep one decimal.
function roundKb(kb) {
  return Math.round(kb * 10) / 10;
}

function csvText(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function average(sum, count) {
  return (sum / count).toFixed(1);
}

// Each result holds the decompressed size of its own step. The reports show it
// as the step size ("delta") and as a running total over the journey.
export function writeReport({ report, outDir, runId, requestDetails }) {
  const technicalCsvLines = [TECHNICAL_HEADER];
  const humanCsvLines = [HUMAN_HEADER];

  let measuredSteps = 0;
  let cumulativeDecompressed = 0;
  let sumCumulativeDecompressed = 0;
  let sumDecompressedDelta = 0;
  let sumCompressed = 0;

  for (const r of report.results) {
    // A step that timed out has no measurement: only its name and error, and
    // it stays out of the averages.
    if (r.timedOut) {
      const identity = [r.stepIndex, csvText(r.name), csvText(r.page_url)];
      technicalCsvLines.push([...identity, ...Array(16).fill(""), csvText(r.error)].join(","));
      humanCsvLines.push([...identity, ...Array(7).fill(""), csvText(r.error)].join(","));
      continue;
    }

    const decompressedDelta = r.step_decompressed_kb;
    cumulativeDecompressed = roundKb(cumulativeDecompressed + decompressedDelta);
    sumCumulativeDecompressed += cumulativeDecompressed;
    sumDecompressedDelta += decompressedDelta;
    sumCompressed += r.compressed_kb;
    measuredSteps += 1;

    technicalCsvLines.push(
      [
        r.stepIndex,
        csvText(r.name),
        csvText(r.page_url),
        r.dom_nodes,
        r.mode,
        cumulativeDecompressed,
        decompressedDelta,
        r.compressed_kb,
        r.request_count,
        r.window_duration_ms,
        r.ecoindex_score,
        r.ecoindex_grade || "",
        r.notes.perfDecodedCoveragePct,
        csvText(r.notes.decompressedMethod),
        csvText(r.notes.compressedMethod),
        r.notes.scrollToEnd ? "true" : "false",
        r.notes.linkMatch || "",
        r.notes.navigationFallback || "",
        r.notes.action || "",
        csvText(r.error),
      ].join(",")
    );
    humanCsvLines.push(
      [
        r.stepIndex,
        csvText(r.name),
        csvText(r.page_url),
        decompressedDelta,
        r.compressed_kb,
        cumulativeDecompressed,
        r.request_count,
        r.dom_nodes,
        r.ecoindex_score,
        r.ecoindex_grade || "",
        csvText(r.error),
      ].join(",")
    );
  }

  if (measuredSteps > 0) {
    const averageDelta = average(sumDecompressedDelta, measuredSteps);
    const averageCompressed = average(sumCompressed, measuredSteps);
    technicalCsvLines.push(
      [
        "Moyenne",
        ...Array(4).fill(""),
        average(sumCumulativeDecompressed, measuredSteps),
        averageDelta,
        averageCompressed,
        ...Array(12).fill(""),
      ].join(",")
    );
    humanCsvLines.push(["Moyenne", "", "", averageDelta, averageCompressed, ...Array(6).fill("")].join(","));
  }

  const technicalCsvPath = path.join(outDir, `technical_${runId}.csv`);
  fs.writeFileSync(technicalCsvPath, technicalCsvLines.join("\n"), "utf-8");

  const csvPath = path.join(outDir, `${runId}.csv`);
  fs.writeFileSync(csvPath, humanCsvLines.join("\n"), "utf-8");

  let requestsPath = null;
  if (requestDetails) {
    requestsPath = path.join(outDir, `requests_${runId}.json`);
    fs.writeFileSync(requestsPath, JSON.stringify(requestDetails, null, 2), "utf-8");
  }

  return { csvPath, technicalCsvPath, requestsPath };
}
