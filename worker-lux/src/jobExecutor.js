const logger = require("./logger");
const { nextJob, updateJob } = require("./jobQueue");

let running = false;

async function executeJob(job) {
  try {
    job.status = "running";
    updateJob(job);
    // execution handled by importer.js
  } catch (err) {
    job.status = "failed";
    job.error = err.message;
    job.finished_at = new Date().toISOString();
    logger.error("job failed", { jobId: job.id, error: err.message });
  }
}

async function workerLoop() {
  if (running) return;
  running = true;

  while (true) {
    const job = nextJob();
    if (!job) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      continue;
    }
    await executeJob(job);
  }
}

module.exports = { workerLoop };
