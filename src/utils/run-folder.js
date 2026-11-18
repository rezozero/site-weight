import fs from "node:fs";
import path from "node:path";

const MAX_SLUG_LENGTH = 40;

function pad(value) {
  return String(value).padStart(2, "0");
}

// Local time, to the second: the folder name matches the clock of whoever ran it,
// and sorts chronologically.
function localTimestamp(date) {
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
  return `${day}_${time}`;
}

function slugify(name) {
  const slug = String(name ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/^-+|-+$/g, "");
  return slug || "journey";
}

// Creates `<reportsRoot>/<YYYY-MM-DD_HH-mm-ss>_<journey-slug>/`, with a `-2`,
// `-3`… suffix when a run already took that name in the same second. The
// folder name is also the run id used in the report filenames.
export function createRunFolder(reportsRoot, journeyName) {
  fs.mkdirSync(reportsRoot, { recursive: true });
  const baseName = `${localTimestamp(new Date())}_${slugify(journeyName)}`;
  for (let attempt = 1; ; attempt += 1) {
    const runId = attempt === 1 ? baseName : `${baseName}-${attempt}`;
    const outDir = path.join(reportsRoot, runId);
    try {
      fs.mkdirSync(outDir);
      return { outDir, runId };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
}
