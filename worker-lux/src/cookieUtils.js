function normalizeSetCookie(setCookieHeader) {
  if (!setCookieHeader) return [];
  if (Array.isArray(setCookieHeader)) return setCookieHeader;
  return [setCookieHeader];
}

function extractCookiePairs(setCookieHeader) {
  const lines = normalizeSetCookie(setCookieHeader);
  const pairs = [];
  for (const line of lines) {
    if (!line || typeof line !== "string") continue;
    const firstPart = line.split(";")[0]?.trim();
    if (!firstPart || !firstPart.includes("=")) continue;
    pairs.push(firstPart);
  }
  return pairs;
}

function mergeCookieStrings(...cookieInputs) {
  const map = new Map();
  for (const input of cookieInputs) {
    if (!input) continue;
    if (Array.isArray(input)) {
      for (const item of input) {
        for (const pair of extractCookiePairs(item)) {
          const idx = pair.indexOf("=");
          const key = pair.slice(0, idx).trim();
          map.set(key, pair);
        }
      }
      continue;
    }
    if (typeof input === "string") {
      const parts = input.split(";").map(s => s.trim()).filter(Boolean);
      for (const part of parts) {
        const idx = part.indexOf("=");
        if (idx <= 0) continue;
        const key = part.slice(0, idx).trim();
        map.set(key, part);
      }
    }
  }
  return Array.from(map.values()).join("; ");
}

module.exports = { normalizeSetCookie, extractCookiePairs, mergeCookieStrings };
