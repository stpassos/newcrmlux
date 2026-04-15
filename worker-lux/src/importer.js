const logger = require("./logger");
const config = require("./config");
const { nextJob, updateJob } = require("./jobQueue");
const { login21online } = require("./auth21online");

let running = false;

async function executeJob(job) {
  job.status = "running";
  job.started_at = new Date().toISOString();
  updateJob(job);

  let jobTimedOut = false;

  const timeoutId = setTimeout(() => {
    jobTimedOut = true;
    job.status = "timeout";
    job.error = "job timeout";
    job.finished_at = new Date().toISOString();
    updateJob(job);
    logger.error("job timeout", { jobId: job.id, entity: job.entity || null });
  }, config.JOB_TIMEOUT_MS || 90000);

  logger.info("job started", { jobId: job.id, entity: job.entity || null, email: job.email || null });

  try {
    if (!job.email || !job.password) throw new Error("missing_credentials");

    const session = await login21online(job.email, job.password);

    if (jobTimedOut) {
      logger.warn("job aborted after timeout flag", { jobId: job.id });
      return;
    }

    job.status = "completed";
    job.finished_at = new Date().toISOString();
    job.session_email = session.email;
    job.cookie_present = Boolean(session.cookies);
    updateJob(job);

    logger.info("job completed", { jobId: job.id, session_email: session.email });
  } catch (err) {
    job.status = "failed";
    job.error = err.message;
    job.finished_at = new Date().toISOString();
    updateJob(job);
    logger.error("job failed", { jobId: job.id, error: err.message });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function workerLoop() {
  if (running) return;
  running = true;

  logger.info("worker loop started");

  while (true) {
    const job = nextJob();
    if (!job) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      continue;
    }
    logger.info("worker picked next job", { jobId: job.id, entity: job.entity || null });
    await executeJob(job);
  }
}

module.exports = { workerLoop, executeJob };
