function write(level, message, meta = {}) {
  const entry = { ts: new Date().toISOString(), level, message, ...meta };
  console.log(JSON.stringify(entry));
}

module.exports = {
  info: (message, meta) => write("INFO", message, meta),
  warn: (message, meta) => write("WARN", message, meta),
  error: (message, meta) => write("ERROR", message, meta),
  debug: (message, meta) => write("DEBUG", message, meta),
};
