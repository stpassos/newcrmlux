const logger = require("./logger");
const { waitForSlot } = require("./rateLimiter");
const { detectBlock, registerBlock, registerSuccess, waitIfCoolingDown } = require("./antiBlock");

async function httpRequest({ url, method = "GET", headers = {}, body = null, email = "system" }) {
  await waitIfCoolingDown();
  await waitForSlot(email);

  const start = Date.now();

  try {
    const options = {
      method,
      headers: { "User-Agent": "crm21-worker", ...headers }
    };
    if (body) options.body = body;

    const response = await fetch(url, options);
    const text = await response.text();
    const duration = Date.now() - start;
    const responseHeaders = Object.fromEntries(response.headers.entries());

    logger.info("http external request", { method, url, status: response.status, duration_ms: duration });

    const blockCheck = detectBlock({ status: response.status, headers: responseHeaders, body: text });
    if (blockCheck.blocked) registerBlock(blockCheck.reason);
    else registerSuccess();

    return { status: response.status, body: text, headers: responseHeaders };
  } catch (err) {
    logger.error("http request failed", { url, error: err.message });
    throw err;
  }
}

module.exports = { httpRequest };
