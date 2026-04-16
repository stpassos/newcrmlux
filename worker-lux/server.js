const express = require("express");
const cors = require("cors");
require("dotenv").config();

const logger = require("./src/logger");
const { createJob, getJob, jobs } = require("./src/jobQueue");
const { workerLoop } = require("./src/importer");
const {
  fetch21onlinePage
} = require("./src/workerActions");
const { runDiscovery } = require("./src/discovery21online");
const { crmFetch } = require("./src/crmFetch21online");
const { registerBackfillRoutes } = require("./src/backfillRoutes");

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));

/**
 * Logging middleware
 */
app.use((req, res, next) => {
  const start = Date.now();

  res.on("finish", () => {
    logger.info("http request", {
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      duration_ms: Date.now() - start,
      ip: req.socket.remoteAddress
    });
  });

  next();
});

const PORT = process.env.PORT || 8080;
const API_KEY = process.env.INTERNAL_API_KEY || "";

/**
 * Auth
 */
function requireApiKey(req, res) {
  const key = req.headers["x-internal-api-key"];

  if (key !== API_KEY) {
    logger.warn("invalid api key", { ip: req.socket.remoteAddress || "" });
    res.status(401).json({ success: false, error: "unauthorized" });
    return false;
  }

  return true;
}

function workerAuthMiddleware(req, res, next) {
  if (!requireApiKey(req, res)) return;
  next();
}

/**
 * Health
 */
app.get("/health", (req, res) => {
  res.json({
    success: true,
    service: "crm21-linux-worker",
    time: new Date().toISOString()
  });
});

/**
 * TEST LOGIN
 */
app.post("/api/21online/test-login", async (req, res) => {
  if (!requireApiKey(req, res)) return;

  const { email, password } = req.body || {};

  try {
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: "missing_credentials"
      });
    }

    const { login21online } = require("./src/auth21online");
    const session = await login21online(email, password, { forceRefresh: true });

    return res.json({
      success: true,
      email: session.email,
      cookie_present: Boolean(session.cookies)
    });

  } catch (err) {
    return res.json({
      success: false,
      error: err.message || "login_failed"
    });
  }
});

/**
 * GENERIC CRM FETCH (AGORA COM WORKSPACE)
 */
app.post("/api/21online/crm-fetch", async (req, res) => {
  if (!requireApiKey(req, res)) return;

  const {
    email,
    password,
    path,
    params = {},
    method = "GET",
    body = null,
    headers = {},
    workspace_id = null,
    workspace_external_id = null,
    workspace_name = null
  } = req.body || {};

  if (!email || !password || !path) {
    return res.status(400).json({
      success: false,
      error: "email_password_path_required"
    });
  }

  try {
    const result = await crmFetch({
      email,
      password,
      path,
      params,
      method,
      body,
      headers,
      workspace_id,
      workspace_external_id,
      workspace_name
    });

    return res.json(result);

  } catch (err) {
    logger.error("crm-fetch failed", {
      error: err.message
    });

    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * IMPORT (JOB QUEUE)
 */
app.post("/api/21online/import", (req, res) => {
  if (!requireApiKey(req, res)) return;

  const {
    entity,
    workspace_id,
    workspace_external_id,
    workspace_name,
    email,
    password
  } = req.body || {};

  const job = createJob({
    entity,
    workspace_id,
    workspace_external_id,
    workspace_name,
    email,
    password
  });

  res.json({
    success: true,
    job_id: job.id
  });
});

/**
 * SYNC LEADS
 */
app.post("/api/21online/sync-leads", async (req, res) => {
  if (!requireApiKey(req, res)) return;

  const {
    email,
    password,
    workspace_id = null,
    workspace_external_id = null,
    workspace_name = null
  } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({
      success: false,
      error: "missing_credentials"
    });
  }

  try {
    const result = await fetch21onlinePage({
      email,
      password,
      url: "https://21online.app/api/leads",
      method: "GET",
      workspace_id,
      workspace_external_id,
      workspace_name
    });

    return res.json({
      success: result.success,
      status: result.status,
      body: result.body
    });

  } catch (err) {
    logger.error("sync-leads failed", {
      error: err.message
    });

    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * MARK LEAD READ
 */
app.post("/api/21online/mark-lead-read", async (req, res) => {
  if (!requireApiKey(req, res)) return;

  const {
    email,
    password,
    crm_lead_id,
    read = true,
    workspace_id = null,
    workspace_external_id = null,
    workspace_name = null
  } = req.body || {};

  if (!email || !password || !crm_lead_id) {
    return res.status(400).json({
      success: false,
      error: "missing_required_fields"
    });
  }

  try {
    const payload = read
      ? [{ id: crm_lead_id, read: true }]
      : [{ id: crm_lead_id, read: false }];

    const result = await fetch21onlinePage({
      email,
      password,
      url: "https://21online.app/leads",
      method: "POST",
      workspace_id,
      workspace_external_id,
      workspace_name,
      headers: {
        "Content-Type": "text/plain;charset=UTF-8",
        "Accept": "text/x-component"
      },
      body: JSON.stringify(payload)
    });

    return res.json({
      success: result.success,
      status: result.status,
      body: result.body
    });

  } catch (err) {
    logger.error("mark-lead-read failed", {
      error: err.message
    });

    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * DISCOVERY
 */
app.post("/api/21online/discovery", async (req, res) => {
  if (!requireApiKey(req, res)) return;

  const {
    email,
    password,
    mode = "quick",
    consultant_crm_id = null
  } = req.body || {};

  try {
    const result = await runDiscovery({
      email,
      password,
      mode,
      consultant_crm_id
    });

    return res.json(result);

  } catch (err) {
    logger.error("discovery failed", {
      error: err.message
    });

    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * JOB STATUS
 */
app.get("/api/21online/jobs/:id", (req, res) => {
  if (!requireApiKey(req, res)) return;

  const job = getJob(req.params.id);

  if (!job) {
    return res.status(404).json({
      success: false,
      error: "job_not_found"
    });
  }

  res.json({
    success: true,
    job
  });
});

/**
 * BACKFILL ROUTES
 */
registerBackfillRoutes(app, workerAuthMiddleware);

/**
 * JOB LIST
 */
app.get("/api/jobs", (req, res) => {
  if (!requireApiKey(req, res)) {
    return res.status(401).json({ success: false });
  }

  const list = Array.from(jobs.values());

  res.json({
    success: true,
    total: list.length,
    jobs: list
  });
});

/**
 * JOB STATS
 */
app.get("/api/jobs/stats", (req, res) => {
  if (!requireApiKey(req, res)) {
    return res.status(401).json({ success: false });
  }

  const list = Array.from(jobs.values());

  const stats = {
    total: list.length,
    queued: list.filter(j => j.status === "queued").length,
    running: list.filter(j => j.status === "running").length,
    completed: list.filter(j => j.status === "completed").length,
    failed: list.filter(j => j.status === "failed").length
  };

  res.json({
    success: true,
    stats
  });
});

/**
 * START WORKER
 */


// ─── PLAYWRIGHT UPLOAD DOCUMENT ────────────────────────────────────────
const { playwrightUploadDocument } = require("./src/playwrightUpload");

app.post("/api/21online/playwright-upload-document", async (req, res) => {
  if (!requireApiKey(req, res)) return;

  const {
    email,
    password,
    asset_external_id,
    owner_ref_id,
    document_label,
    file_name,
    file_base64,
    file_type,
  } = req.body || {};

  const targetId = asset_external_id || owner_ref_id;

  if (!email || !password || !targetId || !file_name || !file_base64) {
    return res.status(400).json({
      success: false,
      error: "email, password, asset_external_id (or owner_ref_id), file_name, and file_base64 are required"
    });
  }

  try {
    const fileBuffer = Buffer.from(file_base64, "base64");

    const result = await playwrightUploadDocument({
      email,
      password,
      assetExternalId: targetId,
      documentLabel: document_label || "other",
      fileName: file_name,
      fileBuffer,
      fileType: file_type || "application/pdf",
    });

    logger.info("playwright-upload-document result", {
      asset_external_id: targetId,
      file_name,
      success: result.success,
    });

    return res.json(result);

  } catch (err) {
    logger.error("playwright-upload-document failed", {
      error: err.message,
      asset_external_id: targetId,
    });

    return res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

app.listen(PORT, () => {
  logger.info("worker started", { port: PORT });
  workerLoop();
});
/**
 * UPLOAD DOCUMENT TO 21ONLINE
 * Mimics the browser POST to /owners/{ownerRefId}?tab=documents
 */
app.post("/api/21online/upload-document", async (req, res) => {
  if (!requireApiKey(req, res)) return;

  const {
    email,
    password,
    owner_ref_id,
    documents,
    workspace_id = null,
    workspace_external_id = null,
    workspace_name = null
  } = req.body || {};

  if (!email || !password || !owner_ref_id || !documents || !Array.isArray(documents)) {
    return res.status(400).json({
      success: false,
      error: "email, password, owner_ref_id, and documents[] are required"
    });
  }

  try {
    const result = await fetch21onlinePage({
      email,
      password,
      url: `https://21online.app/owners/${owner_ref_id}?tab=documents`,
      method: "POST",
      workspace_id,
      workspace_external_id,
      workspace_name,
      headers: {
        "Content-Type": "text/plain;charset=UTF-8",
        "Accept": "text/x-component"
      },
      body: JSON.stringify(documents)
    });

    logger.info("upload-document response", {
      owner_ref_id,
      status: result.status,
      success: result.success,
      body_preview: (result.body || "").substring(0, 300)
    });

    return res.json({
      success: result.success,
      status: result.status,
      body: result.body
    });

  } catch (err) {
    logger.error("upload-document failed", {
      error: err.message,
      owner_ref_id
    });

    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// ─── FULL DOCUMENT UPLOAD (storage + Next-Action) ────────────────────
const { uploadDocumentFull } = require("./src/documentUploader");

app.post("/api/21online/upload-document-full", async (req, res) => {
  if (!requireApiKey(req, res)) return;

  const {
    email, password, owner_ref_id, file_name, file_base64,
    file_type, file_size, document_label, topic, topic_type,
    workspace_id
  } = req.body || {};

  if (!email || !password || !owner_ref_id || !file_base64 || !file_name || !document_label) {
    return res.status(400).json({
      success: false,
      error: "email, password, owner_ref_id, file_base64, file_name, document_label required"
    });
  }

  try {
    const result = await uploadDocumentFull({
      email, password,
      ownerRefId: owner_ref_id,
      fileName: file_name,
      fileBase64: file_base64,
      fileType: file_type || "application/pdf",
      fileSize: file_size || 0,
      documentLabel: document_label,
      topic: topic || owner_ref_id,
      topicType: topic_type || "owners",
      workspaceId: workspace_id || null,
    });

    logger.info("upload-document-full result", {
      owner_ref_id,
      success: result.success,
      public_id: result.public_id,
    });

    return res.json(result);
  } catch (err) {
    logger.error("upload-document-full failed", {
      error: err.message,
      owner_ref_id,
    });

    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
});
