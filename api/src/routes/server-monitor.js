/**
 * server-monitor.js
 *
 * Routes for LUX Server Monitor.
 * Collects metrics from the Linux VPS agent and exposes them to the frontend.
 */

const express = require('express');
const pool = require('../db/pool');
const { verifyToken, requireRole } = require('../middleware/auth');

const router = express.Router();

const INGEST_KEY = process.env.INTERNAL_API_KEY || '';

// ─── POST /api/server-monitor/ingest ─────────────────────────────────────────
// Called by the Linux agent every 15s — no JWT, protected by x-monitor-key
router.post('/ingest', async (req, res, next) => {
  const key = req.headers['x-monitor-key'] || '';
  if (INGEST_KEY && key !== INGEST_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { server, workers, jobs, timestamp } = req.body || {};
  if (!server) return res.status(400).json({ error: 'Missing server metrics' });

  const ts = timestamp ? new Date(timestamp) : new Date();

  try {
    // Insert server snapshot
    await pool.query(
      `INSERT INTO lux_server_metrics
         (collected_at, server_ip, cpu_pct, ram_used_mb, ram_total_mb,
          disk_used_gb, disk_total_gb, net_rx_kbps, net_tx_kbps, load_1, load_5)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        ts,
        server.ip        || '',
        server.cpu_pct   || 0,
        server.ram_used_mb  || 0,
        server.ram_total_mb || 0,
        server.disk_used_gb  || 0,
        server.disk_total_gb || 0,
        server.net_rx_kbps || 0,
        server.net_tx_kbps || 0,
        server.load_1 || 0,
        server.load_5 || 0,
      ]
    );

    // Insert per-worker metrics
    if (Array.isArray(workers)) {
      for (const w of workers) {
        await pool.query(
          `INSERT INTO lux_worker_metrics
             (collected_at, worker_name, pm2_status, pm2_pid,
              cpu_pct, ram_mb, restarts, uptime_ms, active_jobs)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [ts, w.name || '', w.status || 'unknown', w.pid || null,
           w.cpu_pct || 0, w.ram_mb || 0, w.restarts || 0,
           w.uptime_ms || 0, w.active_jobs || 0]
        );
      }
    }

    // Insert job events
    if (Array.isArray(jobs)) {
      for (const j of jobs) {
        await pool.query(
          `INSERT INTO lux_job_log
             (logged_at, worker_name, job_id, entity, workspace_name,
              status, duration_ms, fetched, inserted, error_msg)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [ts, j.worker_name || '', j.job_id || null, j.entity || null,
           j.workspace_name || null, j.status || 'unknown',
           j.duration_ms || null, j.fetched || 0, j.inserted || 0,
           j.error_msg || null]
        );
      }
    }

    // Prune old data — keep 7 days
    await pool.query(
      `DELETE FROM lux_server_metrics WHERE collected_at < now() - interval '7 days'`
    ).catch(() => {});
    await pool.query(
      `DELETE FROM lux_worker_metrics WHERE collected_at < now() - interval '7 days'`
    ).catch(() => {});

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/server-monitor/current ─────────────────────────────────────────
router.get('/current', verifyToken, requireRole('admin'), async (req, res, next) => {
  try {
    const [serverRow, workersRows, pipelineRow, runningJobs] = await Promise.all([
      pool.query(
        `SELECT * FROM lux_server_metrics ORDER BY collected_at DESC LIMIT 1`
      ),
      pool.query(
        `SELECT DISTINCT ON (worker_name) *
         FROM lux_worker_metrics
         ORDER BY worker_name, collected_at DESC`
      ),
      // Current running pipeline endpoint
      pool.query(
        `SELECT e.endpoint_name, e.status, e.last_run_at, e.last_fetched,
                p.worker_name, p.interval_min, p.interval_max
         FROM c21_pipeline_endpoints e
         JOIN c21_pipelines p ON p.id = e.pipeline_id
         WHERE e.status = 'running'
         ORDER BY e.last_run_at DESC NULLS LAST
         LIMIT 1`
      ),
      // Jobs running/recent
      pool.query(
        `SELECT COUNT(*) FILTER (WHERE status = 'running') AS running,
                COUNT(*) FILTER (WHERE status = 'running' AND started_at > now() - interval '1 hour') AS queued
         FROM c21_pipeline_jobs`
      ),
    ]);

    // Average execution time (last 50 done jobs)
    const avgRow = await pool.query(
      `SELECT
         AVG(duration_ms)   AS avg_duration_ms,
         AVG(queue_gap_ms)  AS avg_queue_ms,
         MAX(CASE WHEN status = 'error' THEN error_msg END)   AS last_error,
         MAX(CASE WHEN status = 'error' THEN started_at END)  AS last_error_at
       FROM (
         SELECT
           duration_ms, status, error_msg,
           EXTRACT(EPOCH FROM (started_at - lag(finished_at) OVER (ORDER BY started_at))) * 1000 AS queue_gap_ms
         FROM (
           SELECT * FROM c21_pipeline_jobs ORDER BY started_at DESC LIMIT 50
         ) sub
       ) recent`
    );

    res.json({
      server:        serverRow.rows[0]  || null,
      workers:       workersRows.rows,
      pipeline:      pipelineRow.rows[0] || null,
      jobs_running:  parseInt(runningJobs.rows[0]?.running || '0'),
      jobs_queued:   parseInt(runningJobs.rows[0]?.queued  || '0'),
      avg_duration_ms: parseFloat(avgRow.rows[0]?.avg_duration_ms || '0') || 0,
      avg_queue_ms:    parseFloat(avgRow.rows[0]?.avg_queue_ms    || '0') || 0,
      last_error:      avgRow.rows[0]?.last_error    || null,
      last_error_at:   avgRow.rows[0]?.last_error_at || null,
      last_updated:    serverRow.rows[0]?.collected_at || null,
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/server-monitor/history?interval=1h|24h|7d ──────────────────────
router.get('/history', verifyToken, requireRole('admin'), async (req, res, next) => {
  const interval = ['1h', '24h', '7d'].includes(req.query.interval)
    ? req.query.interval : '24h';

  const pgInterval = { '1h': '1 hour', '24h': '24 hours', '7d': '7 days' }[interval];
  const bucket     = { '1h': '1 minute', '24h': '10 minutes', '7d': '1 hour' }[interval];

  try {
    const metrics = await pool.query(
      `SELECT
         date_trunc($1, collected_at)                                     AS t,
         ROUND(AVG(cpu_pct)::numeric, 1)                                  AS cpu_pct,
         ROUND((AVG(ram_used_mb)::numeric / NULLIF(AVG(ram_total_mb),0) * 100)::numeric, 1) AS ram_pct,
         ROUND(AVG(net_rx_kbps)::numeric, 1)                              AS net_rx,
         ROUND(AVG(net_tx_kbps)::numeric, 1)                              AS net_tx
       FROM lux_server_metrics
       WHERE collected_at >= now() - $2::interval
       GROUP BY 1
       ORDER BY 1 ASC`,
      [bucket, pgInterval]
    );

    const jobs = await pool.query(
      `SELECT
         date_trunc($1, started_at)                                        AS t,
         COUNT(*) FILTER (WHERE status = 'done')                           AS completed,
         COUNT(*) FILTER (WHERE status = 'error')                          AS failed,
         ROUND(AVG(duration_ms)::numeric / 1000, 1)                        AS avg_duration_s
       FROM c21_pipeline_jobs
       WHERE started_at >= now() - $2::interval
       GROUP BY 1
       ORDER BY 1 ASC`,
      [bucket, pgInterval]
    );

    res.json({ interval, metrics: metrics.rows, jobs: jobs.rows });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/server-monitor/logs ────────────────────────────────────────────
router.get('/logs', verifyToken, requireRole('admin'), async (req, res, next) => {
  try {
    const [recentJobs, agentLogs] = await Promise.all([
      // Recent pipeline jobs from our DB
      pool.query(
        `SELECT j.id, j.entity, j.workspace_name, j.status,
                j.fetched, j.inserted, j.duration_ms, j.error_msg,
                j.started_at, j.finished_at,
                c.name AS credential_name,
                p.worker_name
         FROM c21_pipeline_jobs j
         LEFT JOIN c21_credentials c ON c.id = j.credential_id
         LEFT JOIN c21_pipelines p   ON p.id = j.pipeline_id
         ORDER BY j.started_at DESC
         LIMIT 50`
      ),
      // Agent job log (from Linux agent)
      pool.query(
        `SELECT * FROM lux_job_log ORDER BY logged_at DESC LIMIT 30`
      ),
    ]);

    res.json({
      jobs:       recentJobs.rows,
      agent_logs: agentLogs.rows,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
