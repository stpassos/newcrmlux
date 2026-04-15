const logger = require("./logger");
const sleep = require("./sleep");

let cooldownUntil = 0;
let backoffMs = 0;

function isHtmlResponse(headers = {}, body = "") {
  const contentType =
    headers["content-type"] ||
    headers["Content-Type"] ||
    "";

  return contentType.includes("text/html") ||
    body.trim().startsWith("<!DOCTYPE") ||
    body.trim().startsWith("<html");
}

function detectBlock({ status, headers = {}, body = "" }) {
  if (status === 403) {
    return { blocked: true, reason: "http_403" };
  }
  if (status === 429) {
    return { blocked: true, reason: "http_429" };
  }
  if (isHtmlResponse(headers, body) && body.toLowerCase().includes("challenge")) {
    return { blocked: true, reason: "challenge_html" };
  }
  if (isHtmlResponse(headers, body) && body.toLowerCase().includes("vercel")) {
    return { blocked: true, reason: "vercel_html" };
  }
  return { blocked: false, reason: null };
}

function registerBlock(reason) {
  backoffMs = backoffMs ? Math.min(backoffMs * 2, 60 * 60 * 1000) : 60 * 1000;
  cooldownUntil = Date.now() + backoffMs;
  logger.error("anti block triggered", { reason, cooldown_ms: backoffMs });
}

function registerSuccess() {
  if (backoffMs > 0) {
    backoffMs = Math.max(Math.floor(backoffMs / 2), 0);
  }
  logger.debug("anti block success", { cooldown_ms: backoffMs });
}

async function waitIfCoolingDown() {
  const remaining = cooldownUntil - Date.now();
  if (remaining > 0) {
    logger.warn("anti block cooldown active", { wait_ms: remaining });
    await sleep(remaining);
  }
}

module.exports = {
  detectBlock,
  registerBlock,
  registerSuccess,
  waitIfCoolingDown
};
