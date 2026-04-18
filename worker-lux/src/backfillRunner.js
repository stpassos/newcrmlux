/**
 * backfillRunner.js
 *
 * Motor de backfill seguro por workspace para o 21Online Sync Center.
 */

const { fetch21onlinePage } = require("./workerActions");
const logger = require("./logger");
const crypto = require("crypto");
const { getWorkspaceCookiePair } = require("./workspaceManager");

// ─── Config ──────────────────────────────────────────────
const BACKFILL_CONFIG = {
  DELAY_BETWEEN_PAGES_MS: 3000,
  DELAY_BETWEEN_ENTITIES_MS: 5000,
  DELAY_AFTER_STORE_CALLBACK_MS: 1000,

  ASSUMED_PAGE_SIZE: 50,
  MAX_PAGES_PER_ENTITY: 500,

  RECORDS_BATCH_SIZE: 10,
  MAX_BATCH_PAYLOAD_BYTES: 512 * 1024,

  CALLBACK_MAX_RETRIES: 2,
  CALLBACK_TIMEOUT_MS: 15000,
  CALLBACK_RETRY_DELAY_MS: 2000,
};

const ENTITY_API_PATH = {
  users:        "/api/users",
  assets:       "/api/assets",
  leads:        "/api/leads",
  contacts:     "/api/contacts",
  calendar:     "/api/calendar",
  tasks:        "/api/tasks",
  contracts:    "/api/contracts",
  proposals:    "/api/proposals",
  owners:       "/api/owners",
  buyers:       "/api/buyers",
  transactions: "/api/transactions",
  referrals:    "/api/referrals",
  visits:       "/api/visits",
  documents:    "/api/documents",
  awards:       "/api/awards",
  asset_details: "/api/assets",
};

// Entities that have a detail endpoint to enrich list records
const ENTITY_DETAIL_PATH = {
  users: "/api/users/{id}",
};

let activeBackfill = null; // { jobId, pauseRequested }

// ─── Helpers ─────────────────────────────────────────────

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hashRecords(records) {
  if (!records || records.length === 0) return "empty";
  const fingerprint = JSON.stringify({
    len: records.length,
    first_id:
      records[0]?.id ||
      records[0]?.external_id ||
      JSON.stringify(records[0]).substring(0, 80),
    last_id:
      records[records.length - 1]?.id ||
      records[records.length - 1]?.external_id ||
      JSON.stringify(records[records.length - 1]).substring(0, 80),
  });
  return crypto.createHash("md5").update(fingerprint).digest("hex");
}

function buildEntityUrl(apiPath, workspaceID, page, extraParams = {}) {
  const url = new URL(`https://21online.app${apiPath}`);

  if (workspaceID) {
    url.searchParams.set("workspaceID", String(workspaceID));
  }

  url.searchParams.set("page", String(page));

  for (const [key, value] of Object.entries(extraParams || {})) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }

  return url.toString();
}

async function sendCallback(callbackUrl, callbackApiKey, payload) {
  const maxRetries = BACKFILL_CONFIG.CALLBACK_MAX_RETRIES;
  const timeoutMs = BACKFILL_CONFIG.CALLBACK_TIMEOUT_MS;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const res = await fetch(callbackUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${callbackApiKey}`,
          apikey: callbackApiKey,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timer);

      const text = await res.text();

      try {
        return JSON.parse(text);
      } catch {
        logger.error(
          `[backfill:callback] Non-JSON response (attempt ${attempt}/${maxRetries}, status ${res.status}): ${text.substring(0, 200)}`
        );
        if (attempt < maxRetries) {
          await sleep(BACKFILL_CONFIG.CALLBACK_RETRY_DELAY_MS);
          continue;
        }
        return { success: false };
      }
    } catch (err) {
      const isTimeout = err.name === "AbortError";
      logger.error(
        `[backfill:callback] ${isTimeout ? "Timeout" : "Network error"} (attempt ${attempt}/${maxRetries}): ${err.message}`
      );
      if (attempt < maxRetries) {
        await sleep(BACKFILL_CONFIG.CALLBACK_RETRY_DELAY_MS);
        continue;
      }
      return { success: false };
    }
  }

  return { success: false };
}

async function validateNoRunningJobInDB(ctx) {
  try {
    const result = await sendCallback(ctx.callbackUrl, ctx.callbackApiKey, {
      action: "worker_callback",
      event: "check_running_jobs",
      job_id: ctx.jobId,
      workspace_row_id: ctx.workspaceRowId,
      entity: "all",
      data: {
        workspace_id: ctx.workspaceId,
        workspace_external_id: ctx.workspaceExternalId,
        workspace_name: ctx.workspaceName,
      },
    });

    if (result && result.has_running_jobs && result.running_job_id !== ctx.jobId) {
      logger.warn(
        `[backfill:${ctx.jobId}] DB lock: another job is running (${result.running_job_id})`
      );
      return false;
    }

    return true;
  } catch (err) {
    logger.warn(
      `[backfill:${ctx.jobId}] Could not validate DB lock: ${err.message} — proceeding with memory lock`
    );
    return true;
  }
}

async function callbackLog(ctx, level, step, message, metadata) {
  return sendCallback(ctx.callbackUrl, ctx.callbackApiKey, {
    action: "worker_callback",
    event: "log",
    job_id: ctx.jobId,
    workspace_row_id: ctx.workspaceRowId,
    entity: ctx.currentEntity || "all",
    data: {
      level,
      step,
      message,
      metadata,
      workspace_id: ctx.workspaceId,
      workspace_external_id: ctx.workspaceExternalId,
      workspace_name: ctx.workspaceName,
    },
  });
}

async function callbackRecords(ctx, entity, records) {
  const payloadStr = JSON.stringify(records);

  if (payloadStr.length > BACKFILL_CONFIG.MAX_BATCH_PAYLOAD_BYTES) {
    logger.warn(
      `[backfill:${ctx.jobId}] Batch too large (${payloadStr.length} bytes) for ${entity} — splitting`
    );

    const mid = Math.ceil(records.length / 2);
    const r1 = await callbackRecords(ctx, entity, records.slice(0, mid));
    await sleep(BACKFILL_CONFIG.DELAY_AFTER_STORE_CALLBACK_MS);
    const r2 = await callbackRecords(ctx, entity, records.slice(mid));

    return {
      stored: ((r1 && r1.stored) || 0) + ((r2 && r2.stored) || 0),
    };
  }

  return sendCallback(ctx.callbackUrl, ctx.callbackApiKey, {
    action: "worker_callback",
    event: "records",
    job_id: ctx.jobId,
    workspace_row_id: ctx.workspaceRowId,
    entity,
    data: {
      records,
      entity,
      connection_id: ctx.connectionId,
      workspace_id: ctx.workspaceId,
      workspace_external_id: ctx.workspaceExternalId,
      workspace_name: ctx.workspaceName,
      ingestion_batch_id: ctx.currentBatchId || null,
    },
  });
}

function shouldPause(ctx, callbackResponse) {
  if (activeBackfill && activeBackfill.pauseRequested) return true;

  if (callbackResponse && callbackResponse.is_pause_requested) {
    if (activeBackfill) activeBackfill.pauseRequested = true;
    return true;
  }

  return false;
}

function extractRecords(bodyText, entity) {
  let parsed;

  try {
    parsed = JSON.parse(bodyText);
  } catch {
    logger.warn(`[backfill] Failed to parse JSON for ${entity}`);
    return { records: [], totalPages: null, currentPage: null };
  }

  const data = parsed;
  let records = [];

  // Calendar response: { visits, cpcvs, signs, cmis, tasks, contact_birthdays }
  // Merge all event type arrays into a flat list with event_type injected
  const CALENDAR_EVENT_KEYS = ['visits', 'cpcvs', 'signs', 'cmis', 'tasks', 'contact_birthdays'];
  if (entity === 'calendar' && CALENDAR_EVENT_KEYS.some(k => Array.isArray(data[k]))) {
    for (const key of CALENDAR_EVENT_KEYS) {
      if (Array.isArray(data[key])) {
        for (const rec of data[key]) {
          records.push({ ...rec, event_type: key });
        }
      }
    }
  } else if (Array.isArray(data)) {
    records = data;
  } else if (Array.isArray(data.data)) {
    records = data.data;
  } else if (Array.isArray(data.records)) {
    records = data.records;
  } else if (Array.isArray(data.users)) {
    records = data.users;
  } else if (Array.isArray(data.assets)) {
    records = data.assets;
  } else if (Array.isArray(data.contacts)) {
    records = data.contacts;
  } else if (Array.isArray(data.leads)) {
    records = data.leads;
  } else if (Array.isArray(data.items)) {
    records = data.items;
  }

  const totalPages = data.total_pages || data.totalPages || data.last_page || null;
  const currentPage = data.current_page || data.currentPage || data.page || null;

  return { records, totalPages, currentPage };
}

// ─── Detail Enrichment ───────────────────────────────────

async function enrichRecordsWithDetail(entity, records, email, password, extraCookies) {
  const detailTemplate = ENTITY_DETAIL_PATH[entity];
  if (!detailTemplate) return records;

  const CONCURRENT = 3;
  const enriched = records.map((r) => Object.assign({}, r));

  for (let i = 0; i < enriched.length; i += CONCURRENT) {
    const batch = enriched.slice(i, i + CONCURRENT);
    await Promise.all(
      batch.map(async (rec, idx) => {
        const id = rec.id || rec.external_id || rec._id;
        if (!id) return;
        const path = detailTemplate.replace("{id}", id);
        const url = `https://21online.app${path}`;
        try {
          const result = await fetch21onlinePage({ email, password, url, method: "GET", extraCookies });
          if (result && result.success && result.body) {
            let detail;
            try { detail = JSON.parse(result.body); } catch { return; }
            if (detail && typeof detail === "object" && !Array.isArray(detail)) {
              Object.assign(enriched[i + idx], detail);
            }
          }
        } catch (e) {
          // skip enrichment for this record on error
        }
      })
    );
    if (i + CONCURRENT < enriched.length) {
      await sleep(1000);
    }
  }

  return enriched;
}

// ─── Core: Run Backfill ──────────────────────────────────

// ─── Calendar: Monthly Iteration ────────────────────────

const CALENDAR_FILTERS = "visit,contract,sign,cmi,contact_birthday";

function calendarMonths(fromDateStr, toDateStr) {
  const months = [];
  const from = new Date(fromDateStr || "2020-01-01");
  const to   = new Date(toDateStr || new Date());
  let cur = new Date(from.getFullYear(), from.getMonth(), 1);
  while (cur <= to) {
    const y  = cur.getFullYear();
    const m  = String(cur.getMonth() + 1).padStart(2, "0");
    const lastDay = new Date(y, cur.getMonth() + 1, 0).getDate();
    months.push({
      startDate: `${y}-${m}-01`,
      endDate:   `${y}-${m}-${String(lastDay).padStart(2, "0")}`,
      label:     `${y}-${m}`,
    });
    cur.setMonth(cur.getMonth() + 1);
  }
  return months;
}

function flattenCalendarResponse(bodyText, monthLabel) {
  let parsed;
  try { parsed = JSON.parse(bodyText); } catch { return []; }
  const buckets = [
    ...(parsed.visits           || []),
    ...(parsed.cpcvs            || []),
    ...(parsed.signs            || []),
    ...(parsed.cmis             || []),
    ...(parsed.tasks            || []),
    ...(parsed.contact_birthdays || []),
  ];
  return buckets.map((rec) => {
    // For contact_birthday, id is the contact UUID (same contact same record across months).
    // Build a stable external_id so birthdays deduplicate across months.
    const stableId = rec.type === "contact_birthday"
      ? `contact_birthday_${rec.id}`
      : rec.id;
    return { ...rec, id: stableId, _calendar_month: monthLabel };
  });
}

async function runCalendarBackfill(ctx, params, workspaceCookiePair, entityIdx) {
  const {
    jobId, workspaceId, workspaceExternalId, workspaceName, workspaceRowId,
    email, password, callbackUrl, callbackApiKey,
    backfill_mode, incremental_months,
  } = params;

  const nMonths = Math.max(1, parseInt(incremental_months) || 14);
  const now = new Date();

  let fromDate, toDate;
  if (backfill_mode === 'incremental') {
    // Incremental: current month only going forward nMonths
    fromDate = new Date(now.getFullYear(), now.getMonth(), 1);
    toDate = new Date(now.getFullYear(), now.getMonth() + nMonths, 1);
  } else {
    // Full: nMonths back (historical, run once) + nMonths forward
    fromDate = new Date(now.getFullYear(), now.getMonth() - nMonths, 1);
    toDate = new Date(now.getFullYear(), now.getMonth() + nMonths, 1);
  }
  const months = calendarMonths(fromDate.toISOString(), toDate.toISOString());

  let entityFetched = 0;
  let entityStored  = 0;
  let entityFailed  = false;
  let wasPaused     = false;

  logger.info(`[backfill:${jobId}] calendar: ${months.length} months to fetch (${months[0]?.label} → ${months[months.length - 1]?.label})`);

  for (let mi = 0; mi < months.length; mi++) {
    if (activeBackfill && activeBackfill.pauseRequested) {
      wasPaused = true;
      break;
    }

    const { startDate, endDate, label } = months[mi];
    const url = `https://21online.app/api/calendar?workspaceID=${workspaceId}&filters=${CALENDAR_FILTERS}&startDate=${startDate}&endDate=${endDate}&calendar_view=month`;

    logger.info(`[backfill:${jobId}] calendar month ${label}`);

    let result;
    try {
      result = await fetch21onlinePage({ email, password, url, method: "GET", extraCookies: workspaceCookiePair });
    } catch (err) {
      logger.error(`[backfill:${jobId}] calendar fetch error ${label}: ${err.message}`);
      entityFailed = true;
      break;
    }

    if (!result.success) {
      logger.error(`[backfill:${jobId}] calendar fetch failed ${label}: status ${result.status}`);
      entityFailed = true;
      break;
    }

    const records = flattenCalendarResponse(result.body, label);
    entityFetched += records.length;

    for (let i = 0; i < records.length; i += BACKFILL_CONFIG.RECORDS_BATCH_SIZE) {
      const batch = records.slice(i, i + BACKFILL_CONFIG.RECORDS_BATCH_SIZE);
      const storeResult = await callbackRecords(ctx, "calendar", batch);
      if (storeResult?.stored) entityStored += storeResult.stored;
      if (i + BACKFILL_CONFIG.RECORDS_BATCH_SIZE < records.length) {
        await sleep(BACKFILL_CONFIG.DELAY_AFTER_STORE_CALLBACK_MS);
      }
    }

    const progressPct = Math.round(((entityIdx + (mi + 1) / months.length)) / (params.entities?.length || 1) * 100);
    const progressCb = await sendCallback(callbackUrl, callbackApiKey, {
      action: "worker_callback", event: "progress",
      job_id: jobId, workspace_row_id: workspaceRowId, entity: "calendar",
      data: {
        page: mi + 1,
        records_in_page: records.length,
        records_fetched: entityFetched,
        records_stored: entityStored,
        progress_pct: Math.min(progressPct, 99),
        calendar_month: label,
        workspace_id: workspaceId,
        workspace_external_id: workspaceExternalId,
        workspace_name: workspaceName,
      },
    });

    if (shouldPause(ctx, progressCb)) {
      wasPaused = true;
      break;
    }

    if (mi < months.length - 1) {
      await sleep(BACKFILL_CONFIG.DELAY_BETWEEN_PAGES_MS);
    }
  }

  return { entityFetched, entityStored, entityFailed, wasPaused };
}

// ─── Asset Details: enrich c21_assets via /api/assets/{id} ──────────────────

async function runAssetDetailsBackfill(ctx, params, workspaceCookiePair) {
  const {
    jobId, workspaceId, workspaceExternalId, workspaceName, workspaceRowId,
    email, password,
  } = params;

  let page = 1;
  const allIds = [];
  let hasMore = true;
  const seenHashes = new Set();

  logger.info(`[backfill:${jobId}] asset_details: collecting asset IDs...`);

  while (hasMore && page <= BACKFILL_CONFIG.MAX_PAGES_PER_ENTITY) {
    if (activeBackfill && activeBackfill.pauseRequested) {
      return { entityFetched: 0, entityStored: 0, entityFailed: false, wasPaused: true };
    }
    if (page > 1) await sleep(BACKFILL_CONFIG.DELAY_BETWEEN_PAGES_MS);
    const url = buildEntityUrl('/api/assets', workspaceId, page);
    let result;
    try {
      result = await fetch21onlinePage({ email, password, url, method: 'GET', extraCookies: workspaceCookiePair });
    } catch (err) {
      logger.error(`[backfill:${jobId}] asset_details: error collecting IDs page ${page}: ${err.message}`);
      return { entityFetched: 0, entityStored: 0, entityFailed: true, wasPaused: false };
    }
    if (!result.success) {
      logger.error(`[backfill:${jobId}] asset_details: failed page ${page}: status ${result.status}`);
      return { entityFetched: 0, entityStored: 0, entityFailed: true, wasPaused: false };
    }
    const { records, totalPages } = extractRecords(result.body, 'assets');
    if (records.length === 0) { hasMore = false; break; }
    const pageHash = hashRecords(records);
    if (seenHashes.has(pageHash)) { hasMore = false; break; }
    seenHashes.add(pageHash);
    for (const rec of records) {
      const id = rec.id || rec.external_id;
      if (id) allIds.push(String(id));
    }
    logger.info(`[backfill:${jobId}] asset_details: page ${page} -> ${records.length} IDs (total: ${allIds.length})`);
    if (totalPages && page >= totalPages) { hasMore = false; }
    else if (records.length < BACKFILL_CONFIG.ASSUMED_PAGE_SIZE) { hasMore = false; }
    else { page++; }
  }

  if (allIds.length === 0) {
    logger.info(`[backfill:${jobId}] asset_details: no assets found`);
    return { entityFetched: 0, entityStored: 0, entityFailed: false, wasPaused: false };
  }

  logger.info(`[backfill:${jobId}] asset_details: fetching detail for ${allIds.length} assets`);

  let entityFetched = 0;
  let entityStored = 0;
  let wasPaused = false;
  const CONCURRENT = 3;

  for (let i = 0; i < allIds.length; i += CONCURRENT) {
    if (activeBackfill && activeBackfill.pauseRequested) { wasPaused = true; break; }

    const batch = allIds.slice(i, i + CONCURRENT);
    const details = [];

    await Promise.all(batch.map(async (id) => {
      const detailUrl = `https://21online.app/api/assets/${id}`;
      try {
        const res = await fetch21onlinePage({ email, password, url: detailUrl, method: 'GET', extraCookies: workspaceCookiePair });
        if (res.success && res.body) {
          let detail;
          try { detail = JSON.parse(res.body); } catch { return; }
          if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
            details.push({ ...detail, id: String(id) });
          }
        }
      } catch (err) {
        logger.warn(`[backfill:${jobId}] asset_details: error id=${id}: ${err.message}`);
      }
    }));

    if (details.length > 0) {
      entityFetched += details.length;
      const storeResult = await callbackRecords(ctx, 'asset_details', details);
      if (storeResult && storeResult.stored) entityStored += storeResult.stored;
    }

    const progressPct = Math.round((i + batch.length) / allIds.length * 100);
    await sendCallback(ctx.callbackUrl, ctx.callbackApiKey, {
      action: 'worker_callback', event: 'progress',
      job_id: jobId, workspace_row_id: workspaceRowId, entity: 'asset_details',
      data: {
        page: Math.ceil((i + CONCURRENT) / CONCURRENT),
        records_in_page: details.length,
        records_fetched: entityFetched,
        records_stored: entityStored,
        progress_pct: Math.min(progressPct, 99),
        workspace_id: workspaceId,
        workspace_external_id: workspaceExternalId,
        workspace_name: workspaceName,
      },
    });

    if (i + CONCURRENT < allIds.length) await sleep(1000);
  }

  return { entityFetched, entityStored, entityFailed: false, wasPaused };
}

// ─── Core: Run Backfill ──────────────────────────────────

async function runBackfill(params) {
  const {
    jobId,
    workspaceId,
    workspaceExternalId,
    workspaceName,
    workspaceRowId,
    connectionId,
    email,
    password,
    entities,
    callbackUrl,
    callbackApiKey,
    checkpoint,
    leads_since,
    calendar_from,
  } = params;

  const ctx = {
    jobId,
    workspaceId,
    workspaceExternalId,
    workspaceName,
    workspaceRowId,
    connectionId,
    callbackUrl,
    callbackApiKey,
    currentEntity: null,
    currentBatchId: null,
  };

  const dbLockOk = await validateNoRunningJobInDB(ctx);

  if (!dbLockOk) {
    logger.error(`[backfill:${jobId}] Aborted: another backfill is running in DB`);
    await sendCallback(callbackUrl, callbackApiKey, {
      action: "worker_callback",
      event: "failed",
      job_id: jobId,
      workspace_row_id: workspaceRowId,
      entity: "all",
      data: {
        error: "Another backfill is already running (DB lock)",
        workspace_id: workspaceId,
        workspace_external_id: workspaceExternalId,
        workspace_name: workspaceName,
      },
    });
    activeBackfill = null;
    return;
  }

  const startTime = Date.now();
  let totalFetched = 0;
  let totalStored = 0;
  let totalFailed = 0;
  let completedEntities = 0;
  let wasPaused = false;
  let lastError = null;

  logger.info(`[backfill:${jobId}] Starting backfill`, {
    workspace_id: workspaceId || null,
    workspace_external_id: workspaceExternalId || null,
    workspace_name: workspaceName || null,
    workspace_row_id: workspaceRowId || null,
    entities,
  });


  // ─── Workspace Cookie Construction ───────────────────────────
  let workspaceCookiePair = "";
  const wsTarget = workspaceExternalId || workspaceId;
  if (wsTarget) {
    workspaceCookiePair = getWorkspaceCookiePair(wsTarget, workspaceName);
    logger.info(`[backfill:${jobId}] Workspace cookie built for ${wsTarget} (${workspaceName || 'unnamed'}): ${workspaceCookiePair}`);
    await callbackLog(ctx, 'info', 'workspace_cookie', `Workspace cookie applied: ${workspaceCookiePair}`, {
      workspace_id: wsTarget,
      workspace_name: workspaceName,
    });
  }

  for (let entityIdx = 0; entityIdx < entities.length; entityIdx++) {
    const entity = entities[entityIdx];
    ctx.currentEntity = entity;
    ctx.currentBatchId = `${jobId}_${entity}_${Date.now()}`;

    if (activeBackfill && activeBackfill.pauseRequested) {
      wasPaused = true;
      logger.info(`[backfill:${jobId}] Pause requested before ${entity}`);
      break;
    }

    if (entityIdx > 0) {
      logger.info(
        `[backfill:${jobId}] Waiting ${BACKFILL_CONFIG.DELAY_BETWEEN_ENTITIES_MS}ms before ${entity}`
      );
      await sleep(BACKFILL_CONFIG.DELAY_BETWEEN_ENTITIES_MS);
    }

    const entityStartCb = await sendCallback(callbackUrl, callbackApiKey, {
      action: "worker_callback",
      event: "entity_start",
      job_id: jobId,
      workspace_row_id: workspaceRowId,
      entity,
      data: {
        entity_index: entityIdx,
        total_entities: entities.length,
        workspace_id: workspaceId,
        workspace_external_id: workspaceExternalId,
        workspace_name: workspaceName,
      },
    });

    if (shouldPause(ctx, entityStartCb)) {
      wasPaused = true;
      logger.info(`[backfill:${jobId}] Pause detected at entity_start for ${entity}`);
      break;
    }

    logger.info(`[backfill:${jobId}] Processing entity`, {
      entity,
      entity_index: entityIdx + 1,
      total_entities: entities.length,
      workspace_id: workspaceId || null,
      workspace_external_id: workspaceExternalId || null,
      workspace_name: workspaceName || null,
    });

    let startPage = 1;
    if (
      checkpoint &&
      checkpoint[entity] &&
      checkpoint[entity].status === "paused" &&
      checkpoint[entity].last_page
    ) {
      startPage = checkpoint[entity].last_page;
      logger.info(`[backfill:${jobId}] Resuming ${entity} from page ${startPage}`);
    }

    // ── Asset Details: special enrichment via /api/assets/{id} ─────────────
    if (entity === 'asset_details') {
      const detResult = await runAssetDetailsBackfill(ctx, {
        ...params,
        workspaceId, workspaceExternalId, workspaceName, workspaceRowId, email, password,
      }, workspaceCookiePair);
      totalFetched += detResult.entityFetched;
      totalStored  += detResult.entityStored;
      if (detResult.wasPaused) { wasPaused = true; break; }
      if (detResult.entityFailed) { totalFailed++; break; }
      completedEntities++;
      await sendCallback(callbackUrl, callbackApiKey, {
        action: 'worker_callback', event: 'entity_done',
        job_id: jobId, workspace_row_id: workspaceRowId, entity,
        data: {
          total_fetched: detResult.entityFetched,
          total_stored:  detResult.entityStored,
          workspace_id: workspaceId,
          workspace_external_id: workspaceExternalId,
          workspace_name: workspaceName,
        },
      });
      logger.info(`[backfill:${jobId}] asset_details done: ${detResult.entityFetched} fetched, ${detResult.entityStored} stored`);
      continue;
    }
    // ─────────────────────────────────────────────────────────────────────

    const apiPath = ENTITY_API_PATH[entity];
    if (!apiPath) {
      logger.error(`[backfill:${jobId}] Unknown entity: ${entity}`);
      totalFailed++;
      continue;
    }

    // ── Calendar: special monthly iteration ─────────────
    if (entity === "calendar") {
      const calResult = await runCalendarBackfill(ctx, {
        ...params, entities, calendar_from,
      }, workspaceCookiePair, entityIdx);

      totalFetched += calResult.entityFetched;
      totalStored  += calResult.entityStored;

      if (calResult.wasPaused) { wasPaused = true; break; }
      if (calResult.entityFailed) { totalFailed++; break; }

      completedEntities++;
      await sendCallback(callbackUrl, callbackApiKey, {
        action: "worker_callback", event: "entity_done",
        job_id: jobId, workspace_row_id: workspaceRowId, entity,
        data: {
          total_fetched: calResult.entityFetched,
          total_stored:  calResult.entityStored,
          workspace_id: workspaceId,
          workspace_external_id: workspaceExternalId,
          workspace_name: workspaceName,
        },
      });
      logger.info(`[backfill:${jobId}] calendar done: ${calResult.entityFetched} fetched, ${calResult.entityStored} stored`);
      continue; // skip standard page loop
    }
    // ────────────────────────────────────────────────────

    let page = startPage;
    let hasMore = true;
    let entityFetched = 0;
    let entityStored = 0;
    let entityFailed = false;
    const seenPageHashes = new Set();

    while (hasMore && page <= BACKFILL_CONFIG.MAX_PAGES_PER_ENTITY) {
      if (activeBackfill && activeBackfill.pauseRequested) {
        wasPaused = true;
        logger.info(`[backfill:${jobId}] Pause requested at ${entity} page ${page}`);

        await sendCallback(callbackUrl, callbackApiKey, {
          action: "worker_callback",
          event: "paused",
          job_id: jobId,
          workspace_row_id: workspaceRowId,
          entity,
          data: {
            checkpoint: { entity, page, entity_index: entityIdx },
            workspace_id: workspaceId,
            workspace_external_id: workspaceExternalId,
            workspace_name: workspaceName,
          },
        });
        break;
      }

      if (page > startPage) {
        await sleep(BACKFILL_CONFIG.DELAY_BETWEEN_PAGES_MS);
      }

      const extraParams = (entity === "leads" && leads_since) ? { updated_at: leads_since, since: leads_since } : {};
      const url = buildEntityUrl(apiPath, workspaceId, page, extraParams);

      logger.info(`[backfill:${jobId}] FETCH CONTEXT`, {
        entity,
        page,
        workspace_id: workspaceId || null,
        workspace_external_id: workspaceExternalId || null,
        workspace_name: workspaceName || null,
        workspace_row_id: workspaceRowId || null,
        url,
      });

      let result;
      try {
        result = await fetch21onlinePage({
          email,
          password,
          url,
          method: "GET",
          extraCookies: workspaceCookiePair,
        });
      } catch (err) {
        logger.error(
          `[backfill:${jobId}] fetch21onlinePage exception for ${entity} page ${page}: ${err.message}`
        );
        lastError = err.message;
        entityFailed = true;
        break;
      }

      if (!result.success) {
        logger.error(
          `[backfill:${jobId}] Fetch failed for ${entity} page ${page}: status ${result.status}`
        );
        lastError = `Fetch failed: status ${result.status}`;
        entityFailed = true;

        await callbackLog(
          ctx,
          "error",
          "fetch_error",
          `Erro ao buscar ${entity} pág. ${page}: status ${result.status}`,
          {
            status: result.status,
            page,
            workspace_id: workspaceId,
            workspace_external_id: workspaceExternalId,
            workspace_name: workspaceName,
          }
        );
        break;
      }

      let { records, totalPages } = extractRecords(result.body, entity);

      // Enrich records with detail endpoint data (e.g. users → /api/users/{id})
      if (ENTITY_DETAIL_PATH[entity] && records.length > 0) {
        logger.info(`[backfill:${jobId}] Enriching ${records.length} ${entity} records with detail endpoint`);
        records = await enrichRecordsWithDetail(entity, records, email, password, workspaceCookiePair);
      }

      if (entity === "assets" && records.length > 0) {
        logger.info(`[backfill:${jobId}] assets sample references`, {
          workspace_id: workspaceId || null,
          workspace_external_id: workspaceExternalId || null,
          sample_references: records
            .slice(0, 10)
            .map((r) => r.reference || r.ref || r.external_id || r.id),
        });
      }

      if (records.length === 0) {
        logger.info(`[backfill:${jobId}] No records on ${entity} page ${page} — done`);
        hasMore = false;
        break;
      }

      const pageHash = hashRecords(records);

      if (seenPageHashes.has(pageHash)) {
        if (page <= 2) {
          logger.info(
            `[backfill:${jobId}] ${entity}: endpoint does not support pagination (page ${page} repeats page 1). Dataset complete with ${entityFetched} records.`
          );
          await callbackLog(
            ctx,
            "info",
            "pagination_not_supported",
            `${entity}: endpoint sem paginação real — dataset completo (${entityFetched} registos)`,
            {
              page,
              hash: pageHash,
              records_stored: entityStored,
              workspace_id: workspaceId,
              workspace_external_id: workspaceExternalId,
              workspace_name: workspaceName,
            }
          );
        } else {
          logger.warn(
            `[backfill:${jobId}] ${entity}: duplicate page detected at page ${page} — stopping entity (infinite loop protection). ${entityFetched} records already stored.`
          );
          await callbackLog(
            ctx,
            "warn",
            "infinite_loop",
            `${entity}: loop infinito detectado pág. ${page} — parando entidade`,
            {
              page,
              hash: pageHash,
              records_stored: entityStored,
              workspace_id: workspaceId,
              workspace_external_id: workspaceExternalId,
              workspace_name: workspaceName,
            }
          );
        }

        hasMore = false;
        break;
      }

      seenPageHashes.add(pageHash);
      entityFetched += records.length;

      for (let i = 0; i < records.length; i += BACKFILL_CONFIG.RECORDS_BATCH_SIZE) {
        const batch = records.slice(i, i + BACKFILL_CONFIG.RECORDS_BATCH_SIZE);
        const storeResult = await callbackRecords(ctx, entity, batch);

        if (storeResult && storeResult.stored) {
          entityStored += storeResult.stored;
        }

        if (i + BACKFILL_CONFIG.RECORDS_BATCH_SIZE < records.length) {
          await sleep(BACKFILL_CONFIG.DELAY_AFTER_STORE_CALLBACK_MS);
        }
      }

      const progressPct = Math.round(
        ((entityIdx + page / (totalPages || page + 1)) / entities.length) * 100
      );

      const progressCb = await sendCallback(callbackUrl, callbackApiKey, {
        action: "worker_callback",
        event: "progress",
        job_id: jobId,
        workspace_row_id: workspaceRowId,
        entity,
        data: {
          page,
          records_in_page: records.length,
          records_fetched: totalFetched + entityFetched,
          records_stored: totalStored + entityStored,
          progress_pct: Math.min(progressPct, 99),
          workspace_id: workspaceId,
          workspace_external_id: workspaceExternalId,
          workspace_name: workspaceName,
        },
      });

      if (shouldPause(ctx, progressCb)) {
        wasPaused = true;
        logger.info(`[backfill:${jobId}] Pause detected at ${entity} page ${page} via callback`);

        await sendCallback(callbackUrl, callbackApiKey, {
          action: "worker_callback",
          event: "paused",
          job_id: jobId,
          workspace_row_id: workspaceRowId,
          entity,
          data: {
            checkpoint: { entity, page: page + 1, entity_index: entityIdx },
            workspace_id: workspaceId,
            workspace_external_id: workspaceExternalId,
            workspace_name: workspaceName,
          },
        });
        break;
      }

      logger.info(`[backfill:${jobId}] ${entity} page ${page}`, {
        fetched_in_page: records.length,
        entity_fetched_total: entityFetched,
        entity_stored_total: entityStored,
        workspace_id: workspaceId || null,
        workspace_external_id: workspaceExternalId || null,
      });

      if (totalPages && page >= totalPages) {
        hasMore = false;
      } else if (records.length < BACKFILL_CONFIG.ASSUMED_PAGE_SIZE) {
        hasMore = false;
      } else {
        page++;
      }
    }

    if (wasPaused) break;

    totalFetched += entityFetched;
    totalStored += entityStored;

    if (entityFailed) {
      totalFailed++;
      logger.error(`[backfill:${jobId}] Entity ${entity} failed`);
      break;
    }

    await sendCallback(callbackUrl, callbackApiKey, {
      action: "worker_callback",
      event: "entity_done",
      job_id: jobId,
      workspace_row_id: workspaceRowId,
      entity,
      data: {
        total_fetched: entityFetched,
        total_stored: entityStored,
        workspace_id: workspaceId,
        workspace_external_id: workspaceExternalId,
        workspace_name: workspaceName,
      },
    });

    completedEntities++;
    logger.info(
      `[backfill:${jobId}] Entity ${entity} done: ${entityFetched} fetched, ${entityStored} stored`
    );
  }

  const durationMs = Date.now() - startTime;

  if (wasPaused) {
    logger.info(
      `[backfill:${jobId}] Backfill paused after ${durationMs}ms — ${completedEntities}/${entities.length} entities`
    );
  } else if (totalFailed > 0) {
    logger.error(`[backfill:${jobId}] Backfill failed after ${durationMs}ms — error: ${lastError}`);
    await sendCallback(callbackUrl, callbackApiKey, {
      action: "worker_callback",
      event: "failed",
      job_id: jobId,
      workspace_row_id: workspaceRowId,
      entity: ctx.currentEntity || "all",
      data: {
        error: lastError || "Unknown error",
        entity: ctx.currentEntity,
        total_fetched: totalFetched,
        total_stored: totalStored,
        workspace_id: workspaceId,
        workspace_external_id: workspaceExternalId,
        workspace_name: workspaceName,
      },
    });
  } else {
    logger.info(
      `[backfill:${jobId}] Backfill completed in ${durationMs}ms — ${totalFetched} fetched, ${totalStored} stored`
    );
    await sendCallback(callbackUrl, callbackApiKey, {
      action: "worker_callback",
      event: "completed",
      job_id: jobId,
      workspace_row_id: workspaceRowId,
      entity: "all",
      data: {
        total_fetched: totalFetched,
        total_stored: totalStored,
        total_failed: totalFailed,
        duration_ms: durationMs,
        workspace_id: workspaceId,
        workspace_external_id: workspaceExternalId,
        workspace_name: workspaceName,
      },
    });
  }

  activeBackfill = null;
}

// ─── Public API ──────────────────────────────────────────

function startBackfill(params) {
  if (activeBackfill) {
    return {
      accepted: false,
      error: `Backfill already running: job ${activeBackfill.jobId}`,
    };
  }

  activeBackfill = {
    jobId: params.job_id,
    pauseRequested: false,
  };

  runBackfill({
    jobId: params.job_id,
    workspaceId: params.workspace_id || params.workspace_row_id || null,
    workspaceExternalId: params.workspace_external_id || null,
    workspaceName: params.workspace_name || null,
    workspaceRowId: params.workspace_row_id || null,
    connectionId: params.connection_id,
    email: params.email,
    password: params.password,
    entities: params.entities,
    callbackUrl: params.callback_url,
    callbackApiKey: params.callback_api_key,
    checkpoint: params.checkpoint || null,
    leads_since: params.leads_since || null,
    calendar_from: params.calendar_from || null,
  }).catch((err) => {
    logger.error(`[backfill:${params.job_id}] Unhandled error: ${err.message}`);

    sendCallback(params.callback_url, params.callback_api_key, {
      action: "worker_callback",
      event: "failed",
      job_id: params.job_id,
      workspace_row_id: params.workspace_row_id,
      entity: "all",
      data: {
        error: `Unhandled error: ${err.message}`,
        workspace_id: params.workspace_id || params.workspace_row_id || null,
        workspace_external_id: params.workspace_external_id || null,
        workspace_name: params.workspace_name || null,
      },
    }).catch(() => {});

    activeBackfill = null;
  });

  return { accepted: true };
}

function pauseBackfill(jobId) {
  if (!activeBackfill) {
    return { success: false, error: "No active backfill" };
  }

  if (jobId && activeBackfill.jobId !== jobId) {
    return {
      success: false,
      error: `Active backfill is ${activeBackfill.jobId}, not ${jobId}`,
    };
  }

  activeBackfill.pauseRequested = true;
  logger.info(`[backfill:${activeBackfill.jobId}] Pause requested`);

  return { success: true };
}

function getBackfillStatus() {
  if (!activeBackfill) {
    return { active: false };
  }

  return {
    active: true,
    jobId: activeBackfill.jobId,
    pauseRequested: activeBackfill.pauseRequested,
  };
}

// ─── Test Incremental ────────────────────────────────────

async function runTestIncremental(params) {
  const {
    jobId,
    workspaceId,
    workspaceExternalId,
    workspaceName,
    workspaceRowId,
    connectionId,
    email,
    password,
    entityName,
    sinceTimestamp,
    callbackUrl,
    callbackApiKey,
  } = params;

  const ctx = {
    jobId,
    workspaceId,
    workspaceExternalId,
    workspaceName,
    workspaceRowId,
    connectionId,
    callbackUrl,
    callbackApiKey,
    currentEntity: entityName,
    currentBatchId: `${jobId}_${entityName}_${Date.now()}`,
  };

  const apiPath = ENTITY_API_PATH[entityName];
  if (!apiPath) {
    await sendCallback(callbackUrl, callbackApiKey, {
      action: "worker_callback",
      event: "test_incremental_result",
      job_id: jobId,
      workspace_row_id: workspaceRowId,
      entity: entityName,
      data: {
        error: `Unknown entity: ${entityName}`,
        classification: "inconclusivo",
        workspace_id: workspaceId,
        workspace_external_id: workspaceExternalId,
        workspace_name: workspaceName,
      },
    });
    activeBackfill = null;
    return;
  }

  logger.info(`[test-incr:${jobId}] Fetching ${entityName} since ${sinceTimestamp}`, {
    workspace_id: workspaceId || null,
    workspace_external_id: workspaceExternalId || null,
    workspace_name: workspaceName || null,
  });

  const url = buildEntityUrl(apiPath, workspaceId, 1, {
    updated_at: sinceTimestamp,
    since: sinceTimestamp,
  });

  let result;
  try {
    result = await fetch21onlinePage({
          email,
          password,
          url,
          method: "GET",
          extraCookies: workspaceCookiePair,
        });
  } catch (err) {
    logger.error(`[test-incr:${jobId}] Fetch error: ${err.message}`);
    await sendCallback(callbackUrl, callbackApiKey, {
      action: "worker_callback",
      event: "test_incremental_result",
      job_id: jobId,
      workspace_row_id: workspaceRowId,
      entity: entityName,
      data: {
        error: err.message,
        classification: "inconclusivo",
        workspace_id: workspaceId,
        workspace_external_id: workspaceExternalId,
        workspace_name: workspaceName,
      },
    });
    activeBackfill = null;
    return;
  }

  if (!result.success) {
    await sendCallback(callbackUrl, callbackApiKey, {
      action: "worker_callback",
      event: "test_incremental_result",
      job_id: jobId,
      workspace_row_id: workspaceRowId,
      entity: entityName,
      data: {
        error: `Fetch failed: status ${result.status}`,
        classification: "inconclusivo",
        workspace_id: workspaceId,
        workspace_external_id: workspaceExternalId,
        workspace_name: workspaceName,
      },
    });
    activeBackfill = null;
    return;
  }

  const { records } = extractRecords(result.body, entityName);

  let totalStored = 0;
  for (let i = 0; i < records.length; i += BACKFILL_CONFIG.RECORDS_BATCH_SIZE) {
    const batch = records.slice(i, i + BACKFILL_CONFIG.RECORDS_BATCH_SIZE);
    const storeResult = await callbackRecords(ctx, entityName, batch);
    if (storeResult && storeResult.stored) totalStored += storeResult.stored;

    if (i + BACKFILL_CONFIG.RECORDS_BATCH_SIZE < records.length) {
      await sleep(BACKFILL_CONFIG.DELAY_AFTER_STORE_CALLBACK_MS);
    }
  }

  const sinceDate = new Date(sinceTimestamp);
  const externalIds = new Set();
  let minSrcUpdated = null;
  let maxSrcUpdated = null;
  let countWithTimestamp = 0;
  let countBeforeSince = 0;

  for (const r of records) {
    const extId = r.id || r._id || "";
    if (extId) externalIds.add(String(extId));

    const srcUpd = r.updated_at || r.updatedAt || null;
    if (srcUpd) {
      countWithTimestamp++;
      const d = new Date(srcUpd);
      if (!minSrcUpdated || d < minSrcUpdated) minSrcUpdated = d;
      if (!maxSrcUpdated || d > maxSrcUpdated) maxSrcUpdated = d;
      if (d < new Date(sinceDate.getTime() - 3600000)) countBeforeSince++;
    }
  }

  let classification = "inconclusivo";
  if (records.length === 0) {
    classification = "inconclusivo";
  } else if (countWithTimestamp === 0) {
    classification = "inconclusivo";
  } else if (countBeforeSince === 0) {
    classification = "incremental_real";
  } else if (countBeforeSince > records.length * 0.1) {
    classification = "filtro_ignorado";
  } else {
    classification = "incremental_real";
  }

  logger.info(
    `[test-incr:${jobId}] Done: ${records.length} fetched, ${totalStored} stored, classification=${classification}`
  );

  await sendCallback(callbackUrl, callbackApiKey, {
    action: "worker_callback",
    event: "test_incremental_result",
    job_id: jobId,
    workspace_row_id: workspaceRowId,
    entity: entityName,
    data: {
      workspace_id: workspaceId,
      workspace_external_id: workspaceExternalId,
      workspace_name: workspaceName,
      entity_name: entityName,
      since_timestamp: sinceTimestamp,
      records_fetched: records.length,
      records_inserted: totalStored,
      distinct_external_ids: externalIds.size,
      min_source_updated_at: minSrcUpdated ? minSrcUpdated.toISOString() : null,
      max_source_updated_at: maxSrcUpdated ? maxSrcUpdated.toISOString() : null,
      classification,
      count_with_timestamp: countWithTimestamp,
      count_before_since: countBeforeSince,
    },
  });

  activeBackfill = null;
}

function startTestIncremental(params) {
  if (activeBackfill) {
    return {
      accepted: false,
      error: `Backfill already running: job ${activeBackfill.jobId}`,
    };
  }

  activeBackfill = {
    jobId: params.job_id,
    pauseRequested: false,
  };

  runTestIncremental({
    jobId: params.job_id,
    workspaceId: params.workspace_id || params.workspace_row_id || null,
    workspaceExternalId: params.workspace_external_id || null,
    workspaceName: params.workspace_name || null,
    workspaceRowId: params.workspace_row_id || null,
    connectionId: params.connection_id,
    email: params.email,
    password: params.password,
    entityName: params.entity_name,
    sinceTimestamp: params.since_timestamp,
    callbackUrl: params.callback_url,
    callbackApiKey: params.callback_api_key,
  }).catch((err) => {
    logger.error(`[test-incr:${params.job_id}] Unhandled error: ${err.message}`);

    sendCallback(params.callback_url, params.callback_api_key, {
      action: "worker_callback",
      event: "test_incremental_result",
      job_id: params.job_id,
      workspace_row_id: params.workspace_row_id,
      entity: params.entity_name,
      data: {
        error: `Unhandled error: ${err.message}`,
        classification: "inconclusivo",
        workspace_id: params.workspace_id || params.workspace_row_id || null,
        workspace_external_id: params.workspace_external_id || null,
        workspace_name: params.workspace_name || null,
      },
    }).catch(() => {});

    activeBackfill = null;
  });

  return { accepted: true };
}

module.exports = {
  startBackfill,
  pauseBackfill,
  getBackfillStatus,
  startTestIncremental,
  BACKFILL_CONFIG,
};