const fs = require("fs");
const path = require("path");
const logger = require("./logger");

const DATA_DIR = process.env.DATA_DIR || "/opt/worker-lux-1/data";
const FILE = path.join(DATA_DIR, "sessions.json");

function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(FILE)) {
    fs.writeFileSync(FILE, JSON.stringify({ sessions: [] }, null, 2));
  }
}

function loadSessions() {
  ensureFile();

  try {
    const data = JSON.parse(fs.readFileSync(FILE));
    return data.sessions || [];
  } catch (err) {
    logger.error("failed to read sessions file", { error: err.message });
    return [];
  }
}

function saveSessions(list) {
  try {
    fs.writeFileSync(
      FILE,
      JSON.stringify({ sessions: list }, null, 2)
    );
  } catch (err) {
    logger.error("failed to write sessions file", { error: err.message });
  }
}

module.exports = {
  loadSessions,
  saveSessions
};
