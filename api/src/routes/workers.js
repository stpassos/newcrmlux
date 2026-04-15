const express = require('express');
const { verifyToken, requireRole } = require('../middleware/auth');

const router = express.Router();

const WORKERS = [
  {
    name: 'WorkerLux-1',
    url: process.env.WORKER_LUX1_URL || 'http://173.249.49.92:8080',
  },
  {
    name: 'WorkerLux-2',
    url: process.env.WORKER_LUX2_URL || 'http://173.249.49.92:8081',
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

module.exports = router;
