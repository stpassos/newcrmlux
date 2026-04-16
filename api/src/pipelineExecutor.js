/**
 * pipelineExecutor.js
 *
 * Background execution engine for c21_pipelines.
 * - Reads active endpoints in sort_order
 * - For each endpoint: resolves workspaces, calls worker backfill-workspace
 * - Waits random interval between endpoints
 * - Loops until pipeline status != 'running'
 */

const pool = require('./db/pool');

const WORKER_URL      = process.env.WORKER_LUX1_URL  || 'http://207.180.210.173:8080';
const WORKER_KEY      = process.env.WORKER_LUX1_KEY  || process.env.INTERNAL_API_KEY || '';
const API_BASE_URL    = process.env.API_BASE_URL      || 'https://imodigital.pt';
const CALLBACK_API_KEY = process.env.INTERNAL_API_KEY || '';

// Map pipeline endpoint_path → backfill entity name (worker supported entities)
const PATH_TO_ENTITY = {
  '/api/users':        'users',
  '/api/assets':       'assets',
  '/api/contacts':     'contacts',
  '/api/leads':        'leads',
  '/api/calendar':     'calendar',
  '/api/proposals':    'proposals',
  '/api/tasks':        'tasks',
  '/api/calendar':     'calendar',
  '/api/contracts':    'contracts',
  '/api/owners':       'owners',
  '/api/buyers':       'buyers',
  '/api/transactions': 'transactions',
  '/api/referrals':    'referrals',
  '/api/visits':       'visits',
  '/api/documents':    'documents',
  '/api/awards':       'awards',
};

// Active pipeline loops: pipelineId → { cancel: boolean }
const activeLoops = new Map();

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function randomBetween(minSec, maxSec) {
  return (minSec + Math.random() * Math.max(0, maxSec - minSec)) * 1000;
}

// ─── Workspace resolution ─────────────────────────────────────────────────────

async function fetchWorkspacesFromWorker(email, password) {
  try {
    const res = await fetch(`${WORKER_URL}/api/21online/crm-fetch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-api-key': WORKER_KEY,
      },
      body: JSON.stringify({ email, password, path: '/api/workspaces', method: 'GET' }),
      signal: AbortSignal.timeout(20000),
    });
    const data = await res.json().catch(() => ({}));
    if (data.success && Array.isArray(data.data)) {
      return data.data.map(ws => ({
        external_id: String(ws.id || ws.external_id || ws.slug || ''),
        name:        String(ws.name || ws.slug || ''),
      })).filter(w => w.external_id);
    }
  } catch (err) {
    console.error(`[pipelineExecutor] fetchWorkspaces error: ${err.message}`);
  }
  return [];
}

// ─── Single endpoint execution ────────────────────────────────────────────────

async function clearWorkerStaleLock(pipelineId, endpointName) {
  try {
    const statusRes = await fetch(`${WORKER_URL}/api/21online/backfill-status`, {
      headers: { 'x-internal-api-key': WORKER_KEY },
      signal: AbortSignal.timeout(5000),
    });
    if (!statusRes.ok) return;
    const status = await statusRes.json().catch(() => null);
    if (!status || !status.active || !status.jobId) return;

    // Worker has an active lock — check if that job is still 'running' in our DB
    const dbRow = await pool.query(
      'SELECT status FROM c21_pipeline_jobs WHERE id = $1',
      [status.jobId]
    );
    const dbStatus = dbRow.rows[0]?.status;

    if (dbStatus !== 'running') {
      // Stale lock: DB says the job is done/error but worker still holds it
      console.warn(`[pipeline:${pipelineId}] ${endpointName}: worker has stale lock on job ${status.jobId} (DB: ${dbStatus || 'not found'}) — force-cancelling`);
      await fetch(`${WORKER_URL}/api/21online/backfill-cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-api-key': WORKER_KEY },
        body: JSON.stringify({ reason: `Stale lock: DB status=${dbStatus || 'not found'}, detected by pipelineExecutor` }),
        signal: AbortSignal.timeout(5000),
      }).catch(err => console.warn(`[pipeline:${pipelineId}] Could not cancel stale lock: ${err.message}`));
    }
  } catch (err) {
    // Non-blocking — just log and continue
    console.warn(`[pipeline:${pipelineId}] clearWorkerStaleLock error: ${err.message}`);
  }
}

async function runEndpoint(pipelineId, ep, intervalMin, intervalMax) {
  const entity = PATH_TO_ENTITY[ep.endpoint_path];
  if (!entity) {
    console.log(`[pipeline:${pipelineId}] ${ep.endpoint_name}: path ${ep.endpoint_path} not supported by worker — skip`);
    return;
  }

  if (!ep.credential_id || !ep.cred_email) {
    console.log(`[pipeline:${pipelineId}] ${ep.endpoint_name}: no credential configured — skip`);
    return;
  }

  // Clear any stale in-memory lock on the worker before submitting
  await clearWorkerStaleLock(pipelineId, ep.endpoint_name);

  // Determine workspaces first (before touching endpoint status)
  let workspaces = [];
  if (ep.workspace_id) {
    workspaces = [{ external_id: ep.workspace_id, name: ep.workspace_name || '' }];
  } else {
    workspaces = await fetchWorkspacesFromWorker(ep.cred_email, ep.cred_password);
    if (workspaces.length === 0) {
      console.warn(`[pipeline:${pipelineId}] ${ep.endpoint_name}: no workspaces found for credential`);
      await pool.query(
        `UPDATE c21_pipeline_endpoints SET status = 'error', updated_at = now() WHERE id = $1`,
        [ep.id]
      );
      return;
    }
  }

  let totalFetched = 0, totalInserted = 0, endpointStatus = 'done';

  for (const ws of workspaces) {
    if (!ws.external_id) continue;

    const jobId = require('crypto').randomUUID();

    // Insert job record
    await pool.query(
      `INSERT INTO c21_pipeline_jobs
         (id, pipeline_id, endpoint_id, workspace_id, workspace_name, credential_id, entity, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'running')`,
      [jobId, pipelineId, ep.id, ws.external_id, ws.name, ep.credential_id, entity]
    );

    console.log(`[pipeline:${pipelineId}] ${ep.endpoint_name} ws=${ws.name} entity=${entity} job=${jobId}`);

    try {
      const workerRes = await fetch(`${WORKER_URL}/api/21online/backfill-workspace`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-api-key': WORKER_KEY,
        },
        body: JSON.stringify({
          job_id:                jobId,
          workspace_external_id: ws.external_id,
          workspace_row_id:      ws.external_id,
          workspace_id:          ws.external_id,
          workspace_name:        ws.name,
          connection_id:         ep.credential_id,
          email:                 ep.cred_email,
          password:              ep.cred_password,
          entities:              [entity],
          callback_url:          `${API_BASE_URL}/api/pipelines/callback`,
          callback_api_key:      CALLBACK_API_KEY,
          backfill_mode:       ep._force_full ? 'full' : (ep.backfill_mode || 'full'),
          incremental_months:  ep.incremental_months || 14,
          ...(entity === 'leads' && ep.backfill_from_date && { leads_since: ep.backfill_from_date.toISOString().slice(0, 10) }),
        }),
        signal: AbortSignal.timeout(15000),
      });

      if (!workerRes.ok) {
        const err = await workerRes.json().catch(() => ({}));
        const msg = err.error || `Worker HTTP ${workerRes.status}`;
        console.error(`[pipeline:${pipelineId}] Worker rejected job ${jobId}: ${msg}`);
        await pool.query(
          `UPDATE c21_pipeline_jobs
           SET status = 'error', error_msg = $1, finished_at = now()
           WHERE id = $2`,
          [msg, jobId]
        );
        // Mark endpoint as error immediately (not running — worker never accepted it)
        await pool.query(
          `UPDATE c21_pipeline_endpoints SET status = 'error', updated_at = now() WHERE id = $1`,
          [ep.id]
        );
        endpointStatus = 'error';
        // Still honour the interval even on rejection (prevents rapid-fire when worker is busy)
        const rejectWaitMs = randomBetween(intervalMin, intervalMax);
        console.log(`[pipeline:${pipelineId}] ${ep.endpoint_name} ws=${ws.name}: waiting ${Math.round(rejectWaitMs / 1000)}s after rejection`);
        await sleep(rejectWaitMs);
        continue;
      }

      // Worker accepted — now mark endpoint as running
      await pool.query(
        `UPDATE c21_pipeline_endpoints
         SET status = 'running', last_run_at = now(), updated_at = now()
         WHERE id = $1`,
        [ep.id]
      );

      // Poll DB for job completion (worker updates via callback endpoint)
      const finalStatus = await pollJobUntilDone(jobId, 15 * 60 * 1000);
      const jobRow = await pool.query('SELECT * FROM c21_pipeline_jobs WHERE id = $1', [jobId]);
      if (jobRow.rows[0]) {
        totalFetched  += jobRow.rows[0].fetched  || 0;
        totalInserted += jobRow.rows[0].inserted || 0;
        if (jobRow.rows[0].status === 'error') endpointStatus = 'error';
      }
      console.log(`[pipeline:${pipelineId}] job ${jobId} finished: ${finalStatus} fetched=${totalFetched}`);

    } catch (err) {
      console.error(`[pipeline:${pipelineId}] Error calling worker for job ${jobId}: ${err.message}`);
      await pool.query(
        `UPDATE c21_pipeline_jobs
         SET status = 'error', error_msg = $1, finished_at = now()
         WHERE id = $2`,
        [err.message, jobId]
      );
      endpointStatus = 'error';
    }

    // Random interval after each workspace job
    const waitMs = randomBetween(intervalMin, intervalMax);
    console.log(`[pipeline:${pipelineId}] ${ep.endpoint_name} ws=${ws.name}: waiting ${Math.round(waitMs / 1000)}s before next job`);
    await sleep(waitMs);
  }

  // Update endpoint final stats
  await pool.query(
    `UPDATE c21_pipeline_endpoints
     SET status = $1, last_fetched = $2, last_inserted = $3, updated_at = now()
     WHERE id = $4`,
    [endpointStatus, totalFetched, totalInserted, ep.id]
  );
}

async function pollJobUntilDone(jobId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(8000); // check every 8s
    const row = await pool.query('SELECT status FROM c21_pipeline_jobs WHERE id = $1', [jobId]);
    const status = row.rows[0]?.status;
    if (status && ['done', 'error', 'cancelled'].includes(status)) return status;
  }
  // Timeout — mark job as error
  await pool.query(
    `UPDATE c21_pipeline_jobs
     SET status = 'error', error_msg = 'Timeout waiting for worker', finished_at = now()
     WHERE id = $1`,
    [jobId]
  );
  return 'timeout';
}

// ─── Pipeline loop ────────────────────────────────────────────────────────────

async function runPipelineLoop(pipelineId) {
  const ctx = { cancel: false };
  activeLoops.set(pipelineId, ctx);
  console.log(`[pipeline:${pipelineId}] Execution loop started`);

  try {
    while (!ctx.cancel) {
      // Re-read pipeline from DB on each cycle
      const pRow = await pool.query(
        'SELECT * FROM c21_pipelines WHERE id = $1',
        [pipelineId]
      );
      const pipeline = pRow.rows[0];

      if (!pipeline || pipeline.status !== 'running') {
        console.log(`[pipeline:${pipelineId}] Status is '${pipeline?.status}' — ending loop`);
        break;
      }

      // Load active endpoints with credential info
      const epRows = await pool.query(
        `SELECT e.*,
                c.email   AS cred_email,
                c.crm_password AS cred_password
         FROM c21_pipeline_endpoints e
         LEFT JOIN c21_credentials c ON c.id = e.credential_id
         WHERE e.pipeline_id = $1 AND e.is_active = true
         ORDER BY e.sort_order ASC, e.created_at ASC`,
        [pipelineId]
      );
      const endpoints = epRows.rows;

      if (endpoints.length === 0) {
        console.log(`[pipeline:${pipelineId}] No active endpoints — waiting 60s`);
        await sleep(60000);
        continue;
      }

      console.log(`[pipeline:${pipelineId}] Starting cycle with ${endpoints.length} endpoints`);

      for (const ep of endpoints) {
        if (ctx.cancel) break;

        // Check day-of-week schedule (1=Mon … 7=Sun)
        if (ep.active_days && ep.active_days.length > 0) {
          const jsDay = new Date().getDay(); // 0=Sun
          const isoDay = jsDay === 0 ? 7 : jsDay;
          if (!ep.active_days.includes(isoDay)) {
            console.log(`[pipeline:${pipelineId}] ${ep.endpoint_name}: skipped (day ${isoDay} not in ${ep.active_days})`);
            continue;
          }
        }

        // Check time-of-day window
        if (ep.active_from && ep.active_to) {
          const now = new Date();
          const hhmm = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
          if (hhmm < ep.active_from.slice(0,5) || hhmm >= ep.active_to.slice(0,5)) {
            console.log(`[pipeline:${pipelineId}] ${ep.endpoint_name}: skipped (time ${hhmm} outside ${ep.active_from}-${ep.active_to})`);
            continue;
          }
        }

        // Check runs_per_day limit
        if (ep.runs_per_day) {
          const todayRuns = await pool.query(
            `SELECT COUNT(*) AS cnt FROM c21_pipeline_jobs
             WHERE endpoint_id = $1 AND started_at >= CURRENT_DATE AND status IN ('done','error')`,
            [ep.id]
          );
          if (parseInt(todayRuns.rows[0].cnt, 10) >= ep.runs_per_day) {
            console.log(`[pipeline:${pipelineId}] ${ep.endpoint_name}: skipped (ran ${todayRuns.rows[0].cnt}/${ep.runs_per_day} times today)`);
            continue;
          }
        }

        await runEndpoint(pipelineId, ep, pipeline.interval_min, pipeline.interval_max);
      }

      if (ctx.cancel) break;

      // Check status again before next cycle
      const statusCheck = await pool.query(
        'SELECT status, interval_min, interval_max FROM c21_pipelines WHERE id = $1',
        [pipelineId]
      );
      if (!statusCheck.rows[0] || statusCheck.rows[0].status !== 'running') break;

      const cycleMs = randomBetween(
        statusCheck.rows[0].interval_min,
        statusCheck.rows[0].interval_max
      );
      console.log(`[pipeline:${pipelineId}] Cycle complete. Next cycle in ${Math.round(cycleMs / 1000)}s`);
      await sleep(cycleMs);
    }
  } catch (err) {
    console.error(`[pipeline:${pipelineId}] Loop error: ${err.message}`);
  }

  // Reset any endpoints left in running/waiting state
  await pool.query(
    `UPDATE c21_pipeline_endpoints
     SET status = 'idle', updated_at = now()
     WHERE pipeline_id = $1 AND status IN ('running', 'waiting')`,
    [pipelineId]
  ).catch(() => {});

  activeLoops.delete(pipelineId);
  console.log(`[pipeline:${pipelineId}] Execution loop ended`);
}

// ─── Public API ───────────────────────────────────────────────────────────────

function startPipeline(pipelineId) {
  if (activeLoops.has(pipelineId)) {
    console.log(`[pipeline:${pipelineId}] Already running — ignoring start`);
    return;
  }
  runPipelineLoop(pipelineId).catch(err => {
    console.error(`[pipeline:${pipelineId}] Unhandled: ${err.message}`);
    activeLoops.delete(pipelineId);
  });
}

function stopPipeline(pipelineId) {
  const ctx = activeLoops.get(pipelineId);
  if (ctx) {
    ctx.cancel = true;
    console.log(`[pipeline:${pipelineId}] Stop requested`);
  }
}

function isRunning(pipelineId) {
  return activeLoops.has(pipelineId);
}

// Runs a single endpoint immediately (manual backfill button), bypassing runs_per_day
function runEndpointNow(pipelineId, ep, opts = {}) {
  const epWithFlag = { ...ep, _force_full: opts.force_full || false };
  runEndpoint(pipelineId, epWithFlag, 5000, 10000).catch(err => {
    console.error(`[pipeline:${pipelineId}] runEndpointNow error: ${err.message}`);
  });
}

// ─── Auto-resume on API startup ───────────────────────────────────────────────
// If the API restarts mid-execution, any stale 'running' endpoint gets reset to
// 'idle' and the pipeline loop resumes from the beginning of its next cycle.

async function resumeOnStartup() {
  try {
    // Fix any endpoints stuck in 'running' state from a previous API session
    await pool.query(
      `UPDATE c21_pipeline_endpoints
       SET status = 'idle', updated_at = now()
       WHERE status = 'running'`
    );

    // Fix any jobs stuck in 'running' state from a previous API session
    const staleJobs = await pool.query(
      `UPDATE c21_pipeline_jobs
       SET status = 'error', error_msg = 'Stale job — API restarted', finished_at = now()
       WHERE status = 'running'
       RETURNING id`
    );
    if (staleJobs.rowCount > 0) {
      console.log(`[pipelineExecutor] Cleared ${staleJobs.rowCount} stale running job(s) on startup`);
    }

    // Force-cancel any stale in-memory lock on the worker
    // (worker may still be executing a job that the API has now marked as error)
    try {
      const cancelRes = await fetch(`${WORKER_URL}/api/21online/backfill-cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-api-key': WORKER_KEY },
        body: JSON.stringify({ reason: 'API restarted — clearing stale lock' }),
        signal: AbortSignal.timeout(8000),
      });
      if (cancelRes.ok) {
        const data = await cancelRes.json().catch(() => ({}));
        if (data.success) {
          console.log(`[pipelineExecutor] Cleared stale worker lock on startup (cancelled job: ${data.cancelled_job_id})`);
        }
      }
    } catch (err) {
      console.warn(`[pipelineExecutor] Could not clear worker lock on startup: ${err.message}`);
    }

    // Resume pipeline loops for all pipelines still marked as running
    const result = await pool.query(
      `SELECT id FROM c21_pipelines WHERE status = 'running'`
    );
    for (const row of result.rows) {
      console.log(`[pipeline:${row.id}] Auto-resuming after API restart`);
      startPipeline(row.id);
    }
  } catch (err) {
    console.error(`[pipelineExecutor] resumeOnStartup error: ${err.message}`);
  }
}

module.exports = { startPipeline, stopPipeline, isRunning, resumeOnStartup };
