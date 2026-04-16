const express = require('express');
const pool = require('../db/pool');
const { verifyToken, requireRole } = require('../middleware/auth');

const router = express.Router();

// Predefined endpoints inserted when a pipeline is created
const PREDEFINED_ENDPOINTS = [
  { endpoint_name: 'Agentes',        endpoint_path: '/api/users' },
  { endpoint_name: 'Contactos',      endpoint_path: '/api/contacts' },
  { endpoint_name: 'Imóveis',        endpoint_path: '/api/assets' },
  { endpoint_name: 'Vendedores',     endpoint_path: '/api/owners' },
  { endpoint_name: 'Compradores',    endpoint_path: '/api/buyers' },
  { endpoint_name: 'Transações',     endpoint_path: '/api/transactions' },
  { endpoint_name: 'Referências',    endpoint_path: '/api/referrals' },
  { endpoint_name: 'Visitas',        endpoint_path: '/api/visits' },
  { endpoint_name: 'Propostas',      endpoint_path: '/api/proposals' },
  { endpoint_name: 'Documentos',     endpoint_path: '/api/documents' },
  { endpoint_name: 'Galardões',      endpoint_path: '/api/awards' },
  { endpoint_name: 'Detalhe Imóvel', endpoint_path: '/api/assets/{id}' },
];

// ─── GET /api/pipelines ──────────────────────────────────────────────────────
router.get('/', verifyToken, requireRole('admin'), async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id, worker_name, worker_url, interval_min, interval_max,
              status, is_active, started_at, stopped_at, created_at, updated_at
       FROM c21_pipelines
       ORDER BY created_at ASC`
    );
    res.json({ data: result.rows });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/pipelines ─────────────────────────────────────────────────────
// Creates pipeline + 12 predefined endpoints
router.post('/', verifyToken, requireRole('admin'), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { worker_name, worker_url, interval_min = 5, interval_max = 15 } = req.body;
    if (!worker_name || !worker_url) {
      return res.status(400).json({ error: 'worker_name e worker_url são obrigatórios' });
    }

    await client.query('BEGIN');

    // Upsert pipeline
    const pipelineResult = await client.query(
      `INSERT INTO c21_pipelines (worker_name, worker_url, interval_min, interval_max, status, is_active)
       VALUES ($1, $2, $3, $4, 'not_configured', true)
       ON CONFLICT (worker_name) DO UPDATE
         SET worker_url = EXCLUDED.worker_url,
             is_active  = true,
             updated_at = now()
       RETURNING *`,
      [worker_name, worker_url, interval_min, interval_max]
    );
    const pipeline = pipelineResult.rows[0];

    // Insert predefined endpoints only if none exist yet
    const existing = await client.query(
      'SELECT COUNT(*) FROM c21_pipeline_endpoints WHERE pipeline_id = $1',
      [pipeline.id]
    );
    if (parseInt(existing.rows[0].count, 10) === 0) {
      for (let i = 0; i < PREDEFINED_ENDPOINTS.length; i++) {
        const ep = PREDEFINED_ENDPOINTS[i];
        await client.query(
          `INSERT INTO c21_pipeline_endpoints
             (pipeline_id, sort_order, endpoint_name, endpoint_path)
           VALUES ($1, $2, $3, $4)`,
          [pipeline.id, i, ep.endpoint_name, ep.endpoint_path]
        );
      }
    }

    await client.query('COMMIT');
    res.status(201).json(pipeline);
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// ─── PATCH /api/pipelines/:id ────────────────────────────────────────────────
router.patch('/:id', verifyToken, requireRole('admin'), async (req, res, next) => {
  try {
    const { interval_min, interval_max, status, is_active, started_at, stopped_at } = req.body;
    const sets = [];
    const values = [];
    let i = 1;

    if (interval_min !== undefined) { sets.push(`interval_min = $${i++}`); values.push(interval_min); }
    if (interval_max !== undefined) { sets.push(`interval_max = $${i++}`); values.push(interval_max); }
    if (status      !== undefined) { sets.push(`status = $${i++}`);       values.push(status); }
    if (is_active   !== undefined) { sets.push(`is_active = $${i++}`);    values.push(is_active); }
    if (started_at  !== undefined) { sets.push(`started_at = $${i++}`);   values.push(started_at); }
    if (stopped_at  !== undefined) { sets.push(`stopped_at = $${i++}`);   values.push(stopped_at); }

    if (sets.length === 0) return res.status(400).json({ error: 'Nenhum campo para atualizar' });

    values.push(req.params.id);
    const result = await pool.query(
      `UPDATE c21_pipelines SET ${sets.join(', ')}, updated_at = now()
       WHERE id = $${i}
       RETURNING *`,
      values
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Pipeline não encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/pipelines/:id/endpoints ───────────────────────────────────────
router.get('/:id/endpoints', verifyToken, requireRole('admin'), async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT e.*,
              c.name AS credential_name, c.email AS credential_email
       FROM c21_pipeline_endpoints e
       LEFT JOIN c21_credentials c ON c.id = e.credential_id
       WHERE e.pipeline_id = $1
       ORDER BY e.sort_order ASC, e.created_at ASC`,
      [req.params.id]
    );
    res.json({ data: result.rows });
  } catch (err) {
    next(err);
  }
});

// ─── PUT /api/pipelines/:id/endpoints/reorder ────────────────────────────────
// Body: { order: ["uuid1","uuid2",...] }
router.put('/:id/endpoints/reorder', verifyToken, requireRole('admin'), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { order } = req.body;
    if (!Array.isArray(order)) return res.status(400).json({ error: 'order deve ser um array de UUIDs' });

    await client.query('BEGIN');
    for (let i = 0; i < order.length; i++) {
      await client.query(
        `UPDATE c21_pipeline_endpoints
         SET sort_order = $1, updated_at = now()
         WHERE id = $2 AND pipeline_id = $3`,
        [i, order[i], req.params.id]
      );
    }
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// ─── PATCH /api/pipelines/:id/endpoints/:eid ────────────────────────────────
router.patch('/:id/endpoints/:eid', verifyToken, requireRole('admin'), async (req, res, next) => {
  try {
    const {
      workspace_id, workspace_name, credential_id,
      active_from, active_to, active_days,
      backfill_mode, backfill_from_date, is_active, status
    } = req.body;

    const sets = [];
    const values = [];
    let i = 1;

    if (workspace_id     !== undefined) { sets.push(`workspace_id = $${i++}`);     values.push(workspace_id); }
    if (workspace_name   !== undefined) { sets.push(`workspace_name = $${i++}`);   values.push(workspace_name); }
    if (credential_id    !== undefined) { sets.push(`credential_id = $${i++}`);    values.push(credential_id || null); }
    if (active_from      !== undefined) { sets.push(`active_from = $${i++}`);      values.push(active_from || null); }
    if (active_to        !== undefined) { sets.push(`active_to = $${i++}`);        values.push(active_to || null); }
    if (active_days      !== undefined) { sets.push(`active_days = $${i++}`);      values.push(active_days); }
    if (backfill_mode    !== undefined) { sets.push(`backfill_mode = $${i++}`);    values.push(backfill_mode); }
    if (backfill_from_date !== undefined) { sets.push(`backfill_from_date = $${i++}`); values.push(backfill_from_date || null); }
    if (is_active        !== undefined) { sets.push(`is_active = $${i++}`);        values.push(is_active); }
    if (status           !== undefined) { sets.push(`status = $${i++}`);           values.push(status); }

    if (sets.length === 0) return res.status(400).json({ error: 'Nenhum campo para atualizar' });

    values.push(req.params.eid, req.params.id);
    const result = await pool.query(
      `UPDATE c21_pipeline_endpoints SET ${sets.join(', ')}, updated_at = now()
       WHERE id = $${i} AND pipeline_id = $${i + 1}
       RETURNING *`,
      values
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Endpoint não encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/pipelines/:id/jobs ─────────────────────────────────────────────
router.get('/:id/jobs', verifyToken, requireRole('admin'), async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '100', 10), 500);
    const result = await pool.query(
      `SELECT j.*,
              c.name AS credential_name,
              c.email AS credential_email
       FROM c21_pipeline_jobs j
       LEFT JOIN c21_credentials c ON c.id = j.credential_id
       WHERE j.pipeline_id = $1
       ORDER BY j.started_at DESC
       LIMIT $2`,
      [req.params.id, limit]
    );
    res.json({ data: result.rows });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/pipelines/:id/jobs ────────────────────────────────────────────
// Create a job record (called by worker or manually)
router.post('/:id/jobs', verifyToken, requireRole('admin'), async (req, res, next) => {
  try {
    const {
      endpoint_id, workspace_id, workspace_name,
      credential_id, entity
    } = req.body;
    if (!entity) return res.status(400).json({ error: 'entity é obrigatório' });

    const result = await pool.query(
      `INSERT INTO c21_pipeline_jobs
         (pipeline_id, endpoint_id, workspace_id, workspace_name, credential_id, entity)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [req.params.id, endpoint_id || null, workspace_id || null,
       workspace_name || null, credential_id || null, entity]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/pipelines/:id/jobs/:jid ──────────────────────────────────────
router.patch('/:id/jobs/:jid', verifyToken, requireRole('admin'), async (req, res, next) => {
  try {
    const { status, progress, fetched, inserted, skipped, failed, error_msg, finished_at, duration_ms } = req.body;
    const sets = [];
    const values = [];
    let i = 1;

    if (status      !== undefined) { sets.push(`status = $${i++}`);      values.push(status); }
    if (progress    !== undefined) { sets.push(`progress = $${i++}`);    values.push(progress); }
    if (fetched     !== undefined) { sets.push(`fetched = $${i++}`);     values.push(fetched); }
    if (inserted    !== undefined) { sets.push(`inserted = $${i++}`);    values.push(inserted); }
    if (skipped     !== undefined) { sets.push(`skipped = $${i++}`);     values.push(skipped); }
    if (failed      !== undefined) { sets.push(`failed = $${i++}`);      values.push(failed); }
    if (error_msg   !== undefined) { sets.push(`error_msg = $${i++}`);   values.push(error_msg); }
    if (finished_at !== undefined) { sets.push(`finished_at = $${i++}`); values.push(finished_at); }
    if (duration_ms !== undefined) { sets.push(`duration_ms = $${i++}`); values.push(duration_ms); }

    if (sets.length === 0) return res.status(400).json({ error: 'Nenhum campo para atualizar' });

    values.push(req.params.jid, req.params.id);
    const result = await pool.query(
      `UPDATE c21_pipeline_jobs SET ${sets.join(', ')}
       WHERE id = $${i} AND pipeline_id = $${i + 1}
       RETURNING *`,
      values
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Job não encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
