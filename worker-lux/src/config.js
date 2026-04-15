const config = {
  PORT: Number(process.env.PORT || 8080),
  JOB_TIMEOUT_MS: Number(process.env.JOB_TIMEOUT_MS || 90000),
  SESSION_TTL_MS: Number(process.env.SESSION_TTL_MS || 25 * 60 * 1000),
  MIN_REQUEST_INTERVAL_MS: Number(process.env.MIN_REQUEST_INTERVAL_MS || 2000),
  GLOBAL_RATE_LIMIT_PER_MIN: Number(process.env.GLOBAL_RATE_LIMIT_PER_MIN || 30),
  USER_RATE_LIMIT_PER_MIN: Number(process.env.USER_RATE_LIMIT_PER_MIN || 15),
  MAX_JOB_HISTORY: Number(process.env.MAX_JOB_HISTORY || 500),
};

module.exports = config;
