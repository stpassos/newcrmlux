const fs = require("fs");
const path = require("path");
const logger = require("./logger");
const config = require("./config");

const DATA_DIR = process.env.DATA_DIR || "/opt/worker-lux-1/data";
const FILE = path.join(DATA_DIR, "jobs.json");

function ensureFile() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(FILE)) {
      fs.writeFileSync(FILE, JSON.stringify({ jobs: [] }, null, 2));
    }
  } catch (err) {
    logger.error("failed to ensure jobs file", { error: err.message });
  }
}

function loadJobs() {
  ensureFile();

  try {
    const data = JSON.parse(fs.readFileSync(FILE));
    return data.jobs || [];
  } catch (err) {
    logger.error("failed to read jobs file", { error: err.message });
    return [];
  }
}

function saveJobs(jobs) {
  try {
    const sorted = jobs.sort(
      (a, b) => new Date(b.created_at) - new Date(a.created_at)
    );

    const trimmed = sorted.slice(0, config.MAX_JOB_HISTORY);

    fs.writeFileSync(
      FILE,
      JSON.stringify({ jobs: trimmed }, null, 2)
    );
  } catch (err) {
    logger.error("failed to write jobs file", { error: err.message });
  }
}

module.exports = {
  loadJobs,
  saveJobs
};
