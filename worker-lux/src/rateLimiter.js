const sleep = require("./sleep");
const config = require("./config");
const logger = require("./logger");

let lastRequestTime = 0;
const globalRequests = [];
const userRequests = new Map();

function pruneOld(list, windowMs) {
  const cutoff = Date.now() - windowMs;
  while (list.length && list[0] < cutoff) list.shift();
}

async function waitForSlot(email) {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < config.MIN_REQUEST_INTERVAL_MS) {
    const wait = config.MIN_REQUEST_INTERVAL_MS - elapsed;
    logger.debug("rate limiter sleep interval", { wait_ms: wait });
    await sleep(wait);
  }

  pruneOld(globalRequests, 60000);
  if (globalRequests.length >= config.GLOBAL_RATE_LIMIT_PER_MIN) {
    const wait = 60000 - (now - globalRequests[0]);
    logger.warn("global rate limit reached", { wait_ms: wait });
    await sleep(wait);
  }

  if (!userRequests.has(email)) userRequests.set(email, []);
  const userList = userRequests.get(email);
  pruneOld(userList, 60000);

  if (userList.length >= config.USER_RATE_LIMIT_PER_MIN) {
    const wait = 60000 - (now - userList[0]);
    logger.warn("user rate limit reached", { email, wait_ms: wait });
    await sleep(wait);
  }

  const ts = Date.now();
  globalRequests.push(ts);
  userList.push(ts);
  lastRequestTime = ts;
}

module.exports = { waitForSlot };
