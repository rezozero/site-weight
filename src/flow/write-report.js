import fs from "node:fs";
import path from "node:path";

export function writeReport({ report, outDir, runId, requestDetails }) {
  const technicalCsvLines = [
    "step_index,step_name,page_url,dom_nodes,mode,decompressed_kb,compressed_kb,request_count,window_duration_ms,ecoindex_score,ecoindex_grade,perf_decoded_coverage_pct,decompressed_method,compressed_method,scroll_to_end,link_match,navigation_fallback,action",
  ];

  for (const r of report.results) {
    technicalCsvLines.push(
      [
        r.stepIndex,
        `"${String(r.name).replace(/"/g, '""')}"`,
        `"${String(r.page_url || "").replace(/"/g, '""')}"`,
        r.dom_nodes,
        r.mode,
        r.decompressed_kb,
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

  const technicalCsvPath = path.join(outDir, `technical_${runId}.csv`);
  fs.writeFileSync(technicalCsvPath, technicalCsvLines.join("\n"), "utf-8");

  const humanCsvLines = [
    "index,name,url,taille (decompressé kB),taille (compressé kB),nombre de requete,dom_nodes,ecoindex,note",
  ];

  for (const r of report.results) {
    humanCsvLines.push(
      [
        r.stepIndex,
        `"${String(r.name).replace(/"/g, '""')}"`,
        `"${String(r.page_url || "").replace(/"/g, '""')}"`,
        r.decompressed_kb,
        r.compressed_kb,
        r.request_count,
        r.dom_nodes,
        r.ecoindex_score,
        r.ecoindex_grade || "",
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
