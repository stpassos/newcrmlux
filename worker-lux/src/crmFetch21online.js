const logger = require("./logger");
const { fetch21onlinePage } = require("./workerActions");

function buildUrl(path, params = {}) {
  if (!path || typeof path !== "string") throw new Error("invalid_path");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`https://21online.app${normalizedPath}`);
  if (params && typeof params === "object") {
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === "") continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

async function crmFetch({ email, password, path, params = {}, method = "GET", body = null, headers = {}, workspace_id = null, workspace_external_id = null, workspace_name = null }) {
  if (!email || !password) throw new Error("missing_credentials");
  if (!path) throw new Error("missing_path");

  const finalUrl = buildUrl(path, params);
  logger.info("crm-fetch request", { email, method, path, final_url: finalUrl, workspace_id: workspace_id || null });

  const result = await fetch21onlinePage({ email, password, url: finalUrl, method, headers: { Accept: "application/json", ...headers }, body, workspace_id, workspace_external_id, workspace_name });

  let data = null;
  if (typeof result.body === "string" && result.body.trim()) {
    try { data = JSON.parse(result.body); } catch { data = result.body; }
  }

  logger.info("crm-fetch response", { email, method, path, status: result.status, success: result.success });
  return { success: result.success, status: result.status, data };
}

module.exports = { crmFetch, buildUrl };
