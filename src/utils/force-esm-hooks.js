// Module customization hooks, registered by load-config.js with `module.register`.
// They run in a separate loader thread: keep this file free of side effects.

import { readFileSync } from "node:fs";
import { Script } from "node:vm";

export const FORCE_ESM_PARAM = "site-weight-esm";

function hasForceEsmParam(url) {
  return typeof url === "string" && url.startsWith("file:") && new URL(url).searchParams.has(FORCE_ESM_PARAM);
}

// Node's own detection rule: source that does not compile as a CommonJS
// function body (import/export statements, top-level await) is an ES module.
function hasModuleSyntax(source) {
  try {
    new Script(`(function (exports, require, module, __filename, __dirname) {\n${source}\n})`);
    return false;
  } catch (error) {
    return error instanceof SyntaxError;
  }
}

// A local `.js` file imported by the journey inherits FORCE_ESM_PARAM when it
// is written as an ES module, so it loads as one too. CommonJS helpers and
// packages from node_modules resolve as usual.
export async function resolve(specifier, context, nextResolve) {
  const result = await nextResolve(specifier, context);
  if (!hasForceEsmParam(context.parentURL) || !result.url.startsWith("file:")) {
    return result;
  }
  const url = new URL(result.url);
  if (!url.pathname.endsWith(".js") || url.pathname.includes("/node_modules/")) {
    return result;
  }
  try {
    if (!hasModuleSyntax(readFileSync(url, "utf8"))) return result;
  } catch {
    return result;
  }
  url.searchParams.set(FORCE_ESM_PARAM, "");
  return { ...result, url: url.href, format: "module" };
}

// Load a URL carrying FORCE_ESM_PARAM as an ES module, whatever the "type"
// of the nearest package.json says about `.js` files.
export async function load(url, context, nextLoad) {
  if (hasForceEsmParam(url)) {
    return nextLoad(url, { ...context, format: "module" });
  }
  return nextLoad(url, context);
}
