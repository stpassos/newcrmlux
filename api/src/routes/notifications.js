'use strict';
const express = require('express');
const pool = require('../db/pool');
const { verifyToken, requireRole } = require('../middleware/auth');
const { sendSms, logNotification } = require('../lib/smsNotifier');

const router = express.Router();

// ─── GET /api/notifications/config ───────────────────────────────────────────
router.get('/config', verifyToken, requireRole('admin'), async (req, res, next) => {
  try {
    const [configResult, endpointsResult] = await Promise.all([
      pool.query('SELECT * FROM notification_config LIMIT 1'),
      pool.query(
        `SELECT DISTINCT endpoint_name FROM c21_pipeline_endpoints ORDER BY endpoint_name`
      ),
    ]);
    res.json({
      config: configResult.rows[0] || null,
      available_endpoints: endpointsResult.rows.map(e => e.endpoint_name),
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/notifications/config ──────────────────────────────────────────
router.post('/config', verifyToken, requireRole('admin'), async (req, res, next) => {
  try {
    const {
      phone_number, enabled,
      cpu_threshold, ram_threshold, disk_threshold,
      cpu_message, ram_message, disk_message,
      job_fail_message, job_cancel_message,
      monitored_endpoints, cooldown_minutes,
    } = req.body;

    const { rows } = await pool.query(
      `INSERT INTO notification_config
         (id, phone_number, enabled,
          cpu_threshold, ram_threshold, disk_threshold,
          cpu_message, ram_message, disk_message,
          job_fail_message, job_cancel_message,
          monitored_endpoints, cooldown_minutes, updated_at)
       VALUES
         (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now())
       ON CONFLICT (id) DO UPDATE SET
         phone_number        = EXCLUDED.phone_number,
         enabled             = EXCLUDED.enabled,
         cpu_threshold       = EXCLUDED.cpu_threshold,
         ram_threshold       = EXCLUDED.ram_threshold,
         disk_threshold      = EXCLUDED.disk_threshold,
         cpu_message         = EXCLUDED.cpu_message,
         ram_message         = EXCLUDED.ram_message,
         disk_message        = EXCLUDED.disk_message,
         job_fail_message    = EXCLUDED.job_fail_message,
         job_cancel_message  = EXCLUDED.job_cancel_message,
         monitored_endpoints = EXCLUDED.monitored_endpoints,
         cooldown_minutes    = EXCLUDED.cooldown_minutes,
         updated_at          = now()
       RETURNING *`,
      [
        phone_number || '',
        enabled ?? false,
        cpu_threshold != null ? parseInt(cpu_threshold) : null,
        ram_threshold != null ? parseInt(ram_threshold) : null,
        disk_threshold != null ? parseInt(disk_threshold) : null,
        cpu_message || 'Alerta CRM: CPU {value}% (limite: {threshold}%)',
        ram_message || 'Alerta CRM: RAM {value}% (limite: {threshold}%)',
        disk_message || 'Alerta CRM: Disco {value}% (limite: {threshold}%)',
        job_fail_message || 'CRM Job falhou - {endpoint} ({workspace}): {error}',
        job_cancel_message || 'CRM Job cancelado - {endpoint} ({workspace})',
        JSON.stringify(monitored_endpoints || []),
        cooldown_minutes != null ? parseInt(cooldown_minutes) : 15,
      ]
    );
    res.json({ success: true, config: rows[0] });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/notifications/test ────────────────────────────────────────────
router.post('/test', verifyToken, requireRole('admin'), async (req, res, next) => {
  try {
    const { phone_number } = req.body;
    if (!phone_number) return res.status(400).json({ error: 'phone_number required' });

    const text = `Teste de notificacao CRM - ${new Date().toLocaleString('pt-PT')}`;
    try {
      await sendSms(phone_number, text);
      await logNotification('test', 'Test SMS', phone_number, true, null);
      res.json({ success: true, message: 'SMS enviado com sucesso' });
    } catch (e) {
      await logNotification('test', 'Test SMS', phone_number, false, e.message);
      res.status(502).json({ success: false, error: e.message });
    }
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/notifications/log ──────────────────────────────────────────────
router.get('/log', verifyToken, requireRole('admin'), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM notification_log ORDER BY sent_at DESC LIMIT 50`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
