import fs from "node:fs";
import path from "node:path";

export function writeReport({ report, reportSchema, outDir, runId }) {
  const formatDecimal = (value) => {
    if (value === null || value === undefined) return "";
    return String(value).replace(".", ",");
  };
  const jsonPath = path.join(outDir, `${runId}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf-8");

  const technicalCsvLines = [
    "step_index,step_name,page_url,mode,decompressed_kb,compressed_kb,request_count,window_duration_ms,perf_decoded_coverage_pct,decompressed_method,compressed_method,scroll_to_end,link_match,navigation_fallback,action",
  ];

  for (const r of report.results) {
    technicalCsvLines.push(
      [
        r.stepIndex,
        `"${String(r.name).replace(/"/g, '""')}"`,
        `"${String(r.page_url || "").replace(/"/g, '""')}"`,
        r.mode,
        formatDecimal(r.decompressed_kb),
        formatDecimal(r.compressed_kb),
        r.request_count,
        r.window_duration_ms,
        formatDecimal(r.notes.perfDecodedCoveragePct),
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
    "index,name,url,taille (decompressé, kB),taille (compressé, kB),nombre de requete",
  ];

  for (const r of report.results) {
    humanCsvLines.push(
      [
        r.stepIndex,
        `"${String(r.name).replace(/"/g, '""')}"`,
        `"${String(r.page_url || "").replace(/"/g, '""')}"`,
        formatDecimal(r.decompressed_kb),
        formatDecimal(r.compressed_kb),
        r.request_count,
      ].join(",")
    );
  }

  const csvPath = path.join(outDir, `${runId}.csv`);
  fs.writeFileSync(csvPath, humanCsvLines.join("\n"), "utf-8");

  const schemaPath = path.join(outDir, "report-schema.json");
  fs.writeFileSync(schemaPath, JSON.stringify(reportSchema, null, 2), "utf-8");

  return { jsonPath, csvPath, schemaPath, technicalCsvPath };
}
