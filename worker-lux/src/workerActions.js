const { Pool } = require("pg");
const { login21online } = require("./auth21online");
const {
  getSession,
  invalidateSession,
} = require("./sessionManager");
const logger = require("./logger");
const { httpRequest } = require("./httpClient");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const BASE_URL = "https://21online.app/api";

function resolveExternalId(entity, item) {
  switch (entity) {
    case "users":
      return item.id || null;
    case "assets":
      return item.reference || item.id || null;
    case "leads":
      return item.id || null;
    default:
      return item.id || item.reference || null;
  }
}

function normalizeItem(entity, item, workspace) {
  const external_id = resolveExternalId(entity, item);

  if (!external_id) {
    logger.warn("skip item missing external_id", { entity });
    return null;
  }

  return {
    external_id,
    workspace_id: workspace.id,
    workspace_external_id: workspace.external_id,
    data: item,
    updated_at: new Date().toISOString(),
  };
}

async function fetchPage({
  url,
  cookie,
  method = "GET",
  headers = {},
  body = null,
  email = "system",
}) {
  const mergedHeaders = {
    Accept: "application/json, text/plain, */*",
    Cookie: cookie,
    ...headers,
  };

  return httpRequest({
    url,
    method,
    headers: mergedHeaders,
    body,
    email,
  });
}

async function ensureSession(email, password, options = {}) {
  if (!email || !password) {
    throw new Error("missing_credentials");
  }

  const forceRefresh = Boolean(options.forceRefresh);

  if (!forceRefresh) {
    const existing = getSession(email);
    if (existing?.cookies) {
      return existing;
    }
  }

  return login21online(email, password, { forceRefresh });
}

async function fetch21onlinePage({
  email,
  password,
  url,
  method = "GET",
  headers = {},
  body = null,
  workspace_id = null,
  workspace_external_id = null,
  workspace_name = null,
  extraCookies = "",
}) {
  logger.info("fetch21onlinePage request", {
    method,
    url,
    workspace_id: workspace_id || null,
    workspace_external_id: workspace_external_id || null,
    workspace_name: workspace_name || null,
    email: email || null,
  });

  let session = await ensureSession(email, password);

  const effectiveCookie = extraCookies ? session.cookies + "; " + extraCookies : session.cookies;
  logger.info("fetch21onlinePage effective cookie", { hasExtraCookies: !!extraCookies, extraCookies: extraCookies || "(none)" });

  let response = await fetchPage({
    url,
    cookie: effectiveCookie,
    method,
    headers,
    body,
    email,
  });

  if (response.status === 401) {
    logger.warn("21online returned 401, forcing re-login", {
      email,
      url,
      method,
    });

    invalidateSession(email, "fetch_401");

    session = await ensureSession(email, password, { forceRefresh: true });

    const retryCookie = extraCookies ? session.cookies + "; " + extraCookies : session.cookies;
    response = await fetchPage({
      url,
      cookie: retryCookie,
      method,
      headers,
      body,
      email,
    });
  }

  return {
    success: response.status >= 200 && response.status < 300,
    status: response.status,
    body: response.body,
    headers: response.headers,
  };
}

async function storeBatch(entity, records) {
  if (!records.length) return 0;

  const table = `crm21_n_${entity}`;
  let stored = 0;

  for (const rec of records) {
    try {
      await pool.query(
        `INSERT INTO "${table}" (external_id, workspace_id, workspace_external_id, data, updated_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (external_id, workspace_id) DO UPDATE SET
           workspace_external_id = EXCLUDED.workspace_external_id,
           data = EXCLUDED.data,
           updated_at = EXCLUDED.updated_at`,
        [
          String(rec.external_id),
          String(rec.workspace_id),
          rec.workspace_external_id ? String(rec.workspace_external_id) : null,
          JSON.stringify(rec.data),
          rec.updated_at,
        ]
      );
      stored++;
    } catch (err) {
      logger.error("store batch error", {
        entity,
        external_id: rec.external_id,
        error: err.message,
      });
    }
  }

  return stored;
}

async function processEntity({
  entity,
  workspace,
  email,
  password,
  cookie = null,
}) {
  let page = 1;
  let totalFetched = 0;
  let totalStored = 0;

  while (true) {
    const url = `${BASE_URL}/${entity}?workspaceID=${workspace.external_id}&page=${page}`;

    logger.info("processEntity fetch start", {
      entity,
      page,
      workspace_id: workspace.id,
      workspace_external_id: workspace.external_id,
      workspace_name: workspace.name,
      url,
    });

    const responseRaw = cookie
      ? await fetchPage({
          url,
          cookie,
          method: "GET",
          email: email || "system",
        })
      : await fetch21onlinePage({
          email,
          password,
          url,
          method: "GET",
          workspace_id: workspace.id,
          workspace_external_id: workspace.external_id,
          workspace_name: workspace.name,
        });

    if (!responseRaw || !responseRaw.success) {
      logger.warn("processEntity fetch failed", {
        entity,
        page,
        status: responseRaw?.status || null,
      });
      break;
    }

    let response;
    try {
      response = JSON.parse(responseRaw.body);
    } catch (err) {
      logger.warn("processEntity invalid json", {
        entity,
        page,
        error: err.message,
      });
      break;
    }

    if (!Array.isArray(response)) {
      logger.warn("processEntity invalid response shape", { entity, page });
      break;
    }

    if (response.length === 0) {
      logger.info("processEntity empty page", { entity, page });
      break;
    }

    if (page > 1 && response.length === totalFetched) {
      logger.warn("processEntity pagination loop detected", {
        entity,
        page,
        response_length: response.length,
        totalFetched,
      });
      break;
    }

    const normalized = response
      .map((item) => normalizeItem(entity, item, workspace))
      .filter(Boolean);

    const stored = await storeBatch(entity, normalized);

    totalFetched += response.length;
    totalStored += stored;

    logger.info("processEntity progress", {
      entity,
      page,
      fetched: response.length,
      totalFetched,
      totalStored,
    });

    page += 1;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  logger.info("processEntity done", {
    entity,
    workspace_id: workspace.id,
    totalFetched,
    totalStored,
  });
}

async function runBackfill({
  workspace,
  cookie = null,
  email,
  password,
  entities = ["users", "assets", "leads"],
}) {
  logger.info("backfill start", {
    workspace_name: workspace.name,
    workspace_id: workspace.id,
    entities,
  });

  for (const entity of entities) {
    await processEntity({ entity, workspace, cookie, email, password });
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  logger.info("backfill complete", {
    workspace_name: workspace.name,
    workspace_id: workspace.id,
  });
}

module.exports = {
  fetch21onlinePage,
  processEntity,
  runBackfill,
};
