import fs from "node:fs";
import path from "node:path";

export function writeReport({ report, outDir, runId, requestDetails }) {
  const technicalCsvLines = [
    "step_index,step_name,page_url,dom_nodes,mode,decompressed_kb,decompressed_kb_delta,compressed_kb,request_count,window_duration_ms,ecoindex_score,ecoindex_grade,perf_decoded_coverage_pct,decompressed_method,compressed_method,scroll_to_end,link_match,navigation_fallback,action",
  ];

  let previousDecompressed = 0;
  let stepsCount = 0;
  let sumDecompressed = 0;
  let sumDecompressedDelta = 0;
  let sumCompressed = 0;

  for (const r of report.results) {
    const decompressedDelta = stepsCount === 0 ? r.decompressed_kb : r.decompressed_kb - previousDecompressed;
    previousDecompressed = r.decompressed_kb;
    sumDecompressed += r.decompressed_kb;
    sumDecompressedDelta += decompressedDelta;
    sumCompressed += r.compressed_kb;
    stepsCount += 1;

    technicalCsvLines.push(
      [
        r.stepIndex,
        `"${String(r.name).replace(/"/g, '""')}"`,
        `"${String(r.page_url || "").replace(/"/g, '""')}"`,
        r.dom_nodes,
        r.mode,
        r.decompressed_kb,
        decompressedDelta,
        r.compressed_kb,
        r.request_count,
        r.window_duration_ms,
        r.ecoindex_score,
        r.ecoindex_grade || "",
        r.notes.perfDecodedCoveragePct,
        `"${r.notes.decompressedMethod.replace(/"/g, '""')}"`,
        `"${r.notes.compressedMethod.replace(/"/g, '""')}"`,
        r.notes.scrollToEnd ? "true" : "false",
        r.notes.linkMatch || "",
        r.notes.navigationFallback || "",
        r.notes.action || "",
      ].join(",")
    );
  }

  if (stepsCount > 0) {
    technicalCsvLines.push(
      [
        "Moyenne",
        "",
        "",
        "",
        "",
        (sumDecompressed / stepsCount).toFixed(1),
        (sumDecompressedDelta / stepsCount).toFixed(1),
        (sumCompressed / stepsCount).toFixed(1),
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
      ].join(",")
    );
  }

  const technicalCsvPath = path.join(outDir, `technical_${runId}.csv`);
  fs.writeFileSync(technicalCsvPath, technicalCsvLines.join("\n"), "utf-8");

  const humanCsvLines = [
    "index,name,url,taille (decompressé kB),taille (compressé kB),taille cumulative (decompressé kB),nombre de requete,dom_nodes,ecoindex,note",
  ];

  let previousHumanDecompressed = 0;
  let sumHumanDelta = 0;
  let sumHumanCompressed = 0;
  let sumHumanCumulative = 0;
  let humanCount = 0;

  for (const r of report.results) {
    const decompressedDelta = humanCount === 0 ? r.decompressed_kb : r.decompressed_kb - previousHumanDecompressed;
    previousHumanDecompressed = r.decompressed_kb;
    sumHumanDelta += decompressedDelta;
    sumHumanCompressed += r.compressed_kb;
    sumHumanCumulative += r.decompressed_kb;
    humanCount += 1;

    humanCsvLines.push(
      [
        r.stepIndex,
        `"${String(r.name).replace(/"/g, '""')}"`,
        `"${String(r.page_url || "").replace(/"/g, '""')}"`,
        decompressedDelta,
        r.compressed_kb,
        r.decompressed_kb,
        r.request_count,
        r.dom_nodes,
        r.ecoindex_score,
        r.ecoindex_grade || "",
      ].join(",")
    );
  }

  if (humanCount > 0) {
    humanCsvLines.push(
      [
        "Moyenne",
        "",
        "",
        (sumHumanDelta / humanCount).toFixed(1),
        (sumHumanCompressed / humanCount).toFixed(1),
        "",
        "",
        "",
        "",
        "",
      ].join(",")
    );
  }

  const csvPath = path.join(outDir, `${runId}.csv`);
  fs.writeFileSync(csvPath, humanCsvLines.join("\n"), "utf-8");

  let requestsPath = null;
  if (requestDetails) {
    requestsPath = path.join(outDir, `requests_${runId}.json`);
    fs.writeFileSync(requestsPath, JSON.stringify(requestDetails, null, 2), "utf-8");
  }

  return { csvPath, technicalCsvPath, requestsPath };
}
