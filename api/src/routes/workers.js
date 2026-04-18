const express = require('express');
const { verifyToken, requireRole } = require('../middleware/auth');

const router = express.Router();

const WORKERS = [
  {
    name: 'WorkerLux-1',
    url: process.env.WORKER_LUX1_URL || 'http://173.249.49.92:8080',
    key: process.env.WORKER_LUX1_KEY || '',
  },
  {
    name: 'WorkerLux-2',
    url: process.env.WORKER_LUX2_URL || 'http://173.249.49.92:8081',
    key: process.env.WORKER_LUX2_KEY || process.env.WORKER_LUX1_KEY || '',
  },
  {
    name: 'WorkerLux-3',
    url: process.env.WORKER_LUX3_URL || 'http://173.249.49.92:8082',
    key: process.env.WORKER_LUX3_KEY || process.env.WORKER_LUX1_KEY || '',
  },
  {
    name: 'WorkerLux-4',
    url: process.env.WORKER_LUX4_URL || 'http://173.249.49.92:8083',
    key: process.env.WORKER_LUX4_KEY || process.env.WORKER_LUX1_KEY || '',
  },
];

async function checkWorker(worker) {
  const start = Date.now();
  try {
    const res = await fetch(`${worker.url}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    const responseTime = Date.now() - start;
    const data = await res.json().catch(() => ({}));
    return {
      name: worker.name,
      url: worker.url,
      status: res.ok ? 'online' : 'error',
      http_status: res.status,
      response_time_ms: responseTime,
      service: data.service || null,
      checked_at: new Date().toISOString(),
    };
  } catch (err) {
    return {
      name: worker.name,
      url: worker.url,
      status: 'offline',
      http_status: null,
      response_time_ms: Date.now() - start,
      service: null,
      error: err.message,
      checked_at: new Date().toISOString(),
    };
  }
}

// GET /api/workers/status
router.get('/status', verifyToken, requireRole('admin'), async (req, res, next) => {
  try {
    const results = await Promise.all(WORKERS.map(checkWorker));
    res.json({ data: results });
  } catch (err) {
    next(err);
  }
});

// POST /api/workers/:name/restart
router.post('/:name/restart', verifyToken, requireRole('admin'), async (req, res, next) => {
  const worker = WORKERS.find(w => w.name === req.params.name);
  if (!worker) return res.status(404).json({ error: 'Worker not found' });
  try {
    const r = await fetch(`${worker.url}/api/admin/restart`, {
      method: 'POST',
      headers: { 'x-internal-api-key': worker.key },
      signal: AbortSignal.timeout(6000),
    });
    const data = await r.json().catch(() => ({}));
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// POST /api/workers/:name/stop
router.post('/:name/stop', verifyToken, requireRole('admin'), async (req, res, next) => {
  const worker = WORKERS.find(w => w.name === req.params.name);
  if (!worker) return res.status(404).json({ error: 'Worker not found' });
  try {
    const r = await fetch(`${worker.url}/api/admin/stop`, {
      method: 'POST',
      headers: { 'x-internal-api-key': worker.key },
      signal: AbortSignal.timeout(6000),
    });
    const data = await r.json().catch(() => ({}));
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// GET /api/workers/:name/logs
router.get('/:name/logs', verifyToken, requireRole('admin'), async (req, res, next) => {
  const worker = WORKERS.find(w => w.name === req.params.name);
  if (!worker) return res.status(404).json({ error: 'Worker not found' });
  try {
    const lines = req.query.lines || 100;
    const r = await fetch(`${worker.url}/api/admin/logs?lines=${lines}`, {
      headers: { 'x-internal-api-key': worker.key },
      signal: AbortSignal.timeout(15000),
    });
    const data = await r.json().catch(() => ({ success: false, logs: [], raw: '' }));
    res.json(data);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
