// The window size EcoIndex measures its pages with.
export const DEFAULT_VIEWPORT = { width: 1920, height: 1080 };

function isPixelSize(value) {
  return Number.isInteger(value) && value > 0;
}

export function isViewport(value) {
  return Boolean(value) && isPixelSize(value.width) && isPixelSize(value.height);
}

// "1920x1080" → { width: 1920, height: 1080 }; null when the value is not WIDTHxHEIGHT.
export function parseViewport(value) {
  const match = /^(\d+)x(\d+)$/i.exec(String(value).trim());
  if (!match) return null;
  const viewport = { width: Number(match[1]), height: Number(match[2]) };
  return isViewport(viewport) ? viewport : null;
}
