// Module customization hooks, registered by load-config.js with `module.register`.
// They run in a separate loader thread: keep this file free of side effects.

export const FORCE_ESM_PARAM = "site-weight-esm";

// Load a URL carrying FORCE_ESM_PARAM as an ES module, whatever the "type"
// of the nearest package.json says about `.js` files.
export async function load(url, context, nextLoad) {
  if (url.startsWith("file:") && new URL(url).searchParams.has(FORCE_ESM_PARAM)) {
    return nextLoad(url, { ...context, format: "module" });
  }
  return nextLoad(url, context);
}
