const express = require('express');
const pool = require('../db/pool');
const { verifyToken, requireRole } = require('../middleware/auth');

const router = express.Router();

const WORKER_LUX1_URL = process.env.WORKER_LUX1_URL || 'http://173.249.49.92:8080';
const WORKER_LUX1_KEY = process.env.WORKER_LUX1_KEY || '';

/**
 * Recursively extracts field schema from an object.
 * Returns array of { path, type, sample }
 */
function extractSchema(obj, prefix = '') {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return [];

  const fields = [];
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
    const sample = value === null ? null
      : Array.isArray(value) ? `[${value.length} items]`
      : typeof value === 'object' ? null
      : String(value).slice(0, 80);

    fields.push({ path, type, sample });

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      fields.push(...extractSchema(value, path));
    }
  }
  return fields;
}

// POST /api/endpoints/map
router.post('/map', verifyToken, requireRole('admin'), async (req, res, next) => {
  try {
    const { endpoint } = req.body;
    if (!endpoint) return res.status(400).json({ error: 'endpoint é obrigatório' });

    // Get active CRM connection
    const connResult = await pool.query(
      `SELECT email, crm_password FROM crm_connections WHERE is_active = true ORDER BY created_at DESC LIMIT 1`
    );
    const conn = connResult.rows[0];
    if (!conn) return res.status(404).json({ error: 'Nenhuma conexão CRM ativa configurada.' });

    // Normalise endpoint — strip base domain if full URL, keep path+query
    let path;
    try {
      const u = new URL(endpoint);
      path = u.pathname + u.search; // e.g. /api/assets?workspaceID=...
    } catch {
      path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    }

    // Call WorkerLux-1 crm-fetch
    const workerRes = await fetch(`${WORKER_LUX1_URL}/api/21online/crm-fetch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-api-key': WORKER_LUX1_KEY,
      },
      body: JSON.stringify({ email: conn.email, password: conn.crm_password, path }),
      signal: AbortSignal.timeout(90000),
    });

    const workerData = await workerRes.json().catch(() => ({}));

    if (!workerRes.ok || !workerData.success) {
      return res.status(502).json({ error: workerData.error || 'Erro ao contactar o worker.' });
    }

    // Extract the items array
    const raw = workerData.data;
    const items = Array.isArray(raw) ? raw
      : Array.isArray(raw?.data) ? raw.data
      : raw && typeof raw === 'object' ? [raw]
      : [];

    if (items.length === 0) {
      return res.json({ endpoint: path, fields: [], total: 0, sample_count: 0 });
    }

    // Merge schema from first 3 items to capture optional fields
    const mergedSample = Object.assign({}, ...items.slice(0, 3));
    const fields = extractSchema(mergedSample);

    res.json({
      endpoint: path,
      fields,
      total: items.length,
      sample_count: Math.min(items.length, 3),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
