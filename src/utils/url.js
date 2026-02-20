export function normalizeTrailingSlash(value) {
  if (typeof value !== "string") return value;
  if (value === "/") return value;
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

export function isAbsoluteHttpUrl(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
