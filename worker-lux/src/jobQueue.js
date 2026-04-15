const logger = require("./logger");
const { loadJobs, saveJobs } = require("./jobStore");

const jobs = new Map();
const pending = [];

function init() {
  const stored = loadJobs();
  for (const job of stored) {
    jobs.set(job.id, job);
    if (job.status === "queued" || job.status === "running") {
      job.status = "queued";
      pending.push(job.id);
    }
  }
  logger.info("job queue restored", { jobs_loaded: stored.length, pending: pending.length });
}

function persist() {
  const list = Array.from(jobs.values());
  saveJobs(list);
}

function createJob(data) {
  const id = Date.now().toString();
  const job = {
    id,
    ...data,
    status: "queued",
    created_at: new Date().toISOString(),
    started_at: null,
    finished_at: null,
    error: null
  };
  jobs.set(id, job);
  pending.push(id);
  persist();
  logger.info("job created", { jobId: id, entity: data.entity });
  return job;
}

function getJob(id) {
  return jobs.get(id) || null;
}

function updateJob(job) {
  jobs.set(job.id, job);
  persist();
}

function nextJob() {
  while (pending.length > 0) {
    const id = pending.shift();
    const job = jobs.get(id);
    if (job && job.status === "queued") return job;
  }
  return null;
}

init();

module.exports = { createJob, getJob, updateJob, nextJob, jobs };
