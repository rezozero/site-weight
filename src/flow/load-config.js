import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { isAbsoluteHttpUrl } from "../utils/url.js";

function normalizeUrlEntry(url, startUrl) {
  if (typeof url !== "string" || !url.trim()) {
    throw new Error("Invalid urls: each entry must be a non-empty string.");
  }
  if (isAbsoluteHttpUrl(url)) {
    const parsed = new URL(url);
    const relativeUrl = `${parsed.pathname}${parsed.search}${parsed.hash}` || "/";
    return { absoluteUrl: url, relativeUrl };
  }
  if (!startUrl) {
    throw new Error("Invalid urls: relative entries require startUrl.");
  }
  const absoluteUrl = new URL(url, startUrl).toString();
  return { absoluteUrl, relativeUrl: url };
}

function normalizeConfig(rawCfg) {
  if (!rawCfg || typeof rawCfg !== "object") {
    throw new Error("Invalid config: expected an object export from journey.js.");
  }

  const steps = Array.isArray(rawCfg.steps) ? rawCfg.steps : [];
  if (steps.length > 0) {
    return { ...rawCfg, steps, usesUrls: false };
  }

  const urls = Array.isArray(rawCfg.urls) ? rawCfg.urls : [];
  if (urls.length === 0) {
    throw new Error("Invalid config: provide non-empty steps or urls.");
  }
  if (!rawCfg.startUrl) {
    for (const url of urls) {
      if (!isAbsoluteHttpUrl(url)) {
        throw new Error("Invalid urls: relative entries require startUrl.");
      }
    }
  }

  const normalizedUrls = urls.map((url) => normalizeUrlEntry(url, rawCfg.startUrl));
  const startUrl = normalizedUrls[0].absoluteUrl;
  const mappedSteps = normalizedUrls.map((entry) => ({
    name: entry.absoluteUrl,
    action: "linkOrLocation",
    absoluteUrl: entry.absoluteUrl,
    relativeUrl: entry.relativeUrl,
  }));

  return {
    ...rawCfg,
    startUrl,
    steps: mappedSteps,
    usesUrls: true,
  };
}

export async function loadConfig(folderArg) {
  if (!folderArg) {
    throw new Error("Usage: node src/index.js <journey-folder>\nExpected a folder name containing journey.js.");
  }
  if (folderArg.endsWith(".json") || folderArg.endsWith(".js") || folderArg.endsWith(".mjs")) {
    throw new Error("Invalid argument: provide a folder name only, not a file path.");
  }

  const cfgPath = path.join(folderArg, "journey.js");
  if (!fs.existsSync(cfgPath)) {
    throw new Error(`Missing journey config: ${cfgPath}`);
  }

  const cfgModule = await import(pathToFileURL(cfgPath));
  const cfg = normalizeConfig(cfgModule?.default);
  return { cfg, cfgPath };
}
