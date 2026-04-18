/**
 * backfillRoutes.js
 *
 * Express routes for 21Online Sync Center backfill.
 */

const {
  startBackfill,
  pauseBackfill,
  getBackfillStatus,
  startTestIncremental,
} = require("./backfillRunner");
const logger = require("./logger");

function registerBackfillRoutes(app, authMiddleware) {
  app.post("/api/21online/backfill-workspace", authMiddleware, (req, res) => {
    const {
      job_id,
      workspace_id = null,
      workspace_external_id,
      workspace_row_id,
      workspace_name = null,
      connection_id,
      email,
      password,
      entities,
      callback_url,
      callback_api_key,
      checkpoint,
      leads_since,
    } = req.body || {};

    if (!job_id || !workspace_external_id || !workspace_row_id || !connection_id) {
      return res.status(400).json({
        success: false,
        error:
          "Missing required fields: job_id, workspace_external_id, workspace_row_id, connection_id",
      });
    }

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: "Missing credentials: email, password",
      });
    }

    if (!entities || !Array.isArray(entities) || entities.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Missing or empty entities array",
      });
    }

    if (!callback_url || !callback_api_key) {
      return res.status(400).json({
        success: false,
        error: "Missing callback configuration: callback_url, callback_api_key",
      });
    }

    const validEntities = ["users", "assets", "leads", "contacts", "calendar", "tasks", "contracts", "proposals", "owners", "buyers", "transactions", "referrals", "visits", "documents", "awards", "asset_details"];
    const invalidEntities = entities.filter((e) => !validEntities.includes(e));

    if (invalidEntities.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Invalid entities: ${invalidEntities.join(", ")}. Valid: ${validEntities.join(", ")}`,
      });
    }

    logger.info("[backfill-route] Received backfill request", {
      job_id,
      workspace_id: workspace_id || null,
      workspace_external_id,
      workspace_row_id,
      workspace_name,
      connection_id,
      entities,
    });

    const result = startBackfill({
      job_id,
      workspace_id,
      workspace_external_id,
      workspace_row_id,
      workspace_name,
      connection_id,
      email,
      password,
      entities,
      callback_url,
      callback_api_key,
      checkpoint: checkpoint || null,
      leads_since: leads_since || null,
    });

    if (!result.accepted) {
      logger.warn("[backfill-route] Backfill rejected", {
        job_id,
        error: result.error,
      });

      return res.status(409).json({
        success: false,
        error: result.error,
      });
    }

    logger.info("[backfill-route] Backfill accepted", {
      job_id,
      workspace_id: workspace_id || null,
      workspace_external_id,
      workspace_row_id,
      workspace_name,
    });

    return res.status(200).json({
      success: true,
      accepted: true,
    });
  });

  app.post("/api/21online/backfill-pause", authMiddleware, (req, res) => {
    const { job_id } = req.body || {};

    logger.info("[backfill-route] Pause request received", {
      job_id: job_id || "any",
    });

    const result = pauseBackfill(job_id);

    if (!result.success) {
      return res.status(404).json(result);
    }

    return res.status(200).json({ success: true });
  });

  app.get("/api/21online/backfill-status", authMiddleware, (req, res) => {
    const status = getBackfillStatus();
    return res.status(200).json(status);
  });

  app.post("/api/21online/test-incremental", authMiddleware, (req, res) => {
    const {
      job_id,
      workspace_id = null,
      workspace_external_id,
      workspace_row_id,
      workspace_name = null,
      connection_id,
      email,
      password,
      entity_name,
      since_timestamp,
      callback_url,
      callback_api_key,
    } = req.body || {};

    if (!job_id || !workspace_external_id || !connection_id || !email || !password) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields",
      });
    }

    if (!entity_name || !["users", "assets", "leads", "calendar", "tasks", "contracts", "proposals"].includes(entity_name)) {
      return res.status(400).json({
        success: false,
        error: "Invalid entity_name",
      });
    }

    if (!since_timestamp) {
      return res.status(400).json({
        success: false,
        error: "since_timestamp is required",
      });
    }

    if (!callback_url || !callback_api_key) {
      return res.status(400).json({
        success: false,
        error: "Missing callback configuration",
      });
    }

    logger.info("[test-incremental-route] Received", {
      job_id,
      entity_name,
      since_timestamp,
      workspace_id: workspace_id || null,
      workspace_external_id,
      workspace_row_id,
      workspace_name,
    });

    const result = startTestIncremental({
      job_id,
      workspace_id,
      workspace_external_id,
      workspace_row_id,
      workspace_name,
      connection_id,
      email,
      password,
      entity_name,
      since_timestamp,
      callback_url,
      callback_api_key,
    });

    if (!result.accepted) {
      return res.status(409).json({
        success: false,
        error: result.error,
      });
    }

    return res.status(200).json({
      success: true,
      accepted: true,
    });
  });
}

module.exports = { registerBackfillRoutes };