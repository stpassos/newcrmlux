const logger = require("./logger");

function extractActionCandidates(html) {
  if (!html || typeof html !== "string") return [];
  const candidates = new Set();
  const regexes = [
    /"actionId"\s*:\s*"([^"]+)"/g,
    /"id"\s*:\s*"([^"]+)"/g,
    /Next-Action["']?\s*[:=]\s*["']([^"']+)["']/g,
    /\/_next\/[^"' ]+/g
  ];
  for (const regex of regexes) {
    let match;
    while ((match = regex.exec(html)) !== null) {
      const value = match[1] || match[0];
      if (!value) continue;
      if (value.length >= 8 && !value.startsWith("/_next/") && !value.startsWith("http")) {
        candidates.add(value.trim());
      }
    }
  }
  return Array.from(candidates);
}

function resolveLoginActionId(html) {
  const candidates = extractActionCandidates(html);
  logger.info("login action discovery", { candidates_found: candidates.length, candidates: candidates.slice(0, 10) });
  if (!candidates.length) return null;
  return candidates[0];
}

module.exports = { extractActionCandidates, resolveLoginActionId };
