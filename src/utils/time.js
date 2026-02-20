export function nowIsoSafe() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
