const express = require('express');
const pool = require('../db/pool');
const { verifyToken, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/connections — lista conexões 21online
router.get('/', verifyToken, requireRole('admin'), async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id, email, base_url, workspace_id, workspace_name,
              is_active, last_sync_at, created_at, updated_at,
              CASE WHEN encrypted_session IS NOT NULL THEN true ELSE false END AS has_session
       FROM crm_connections
       ORDER BY created_at DESC`
    );
    res.json({ data: result.rows });
  } catch (err) {
    next(err);
  }
});

// POST /api/connections — criar/atualizar conexão
router.post('/', verifyToken, requireRole('admin'), async (req, res, next) => {
  try {
    const { email, password, base_url = 'https://21online.app' } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'email e password são obrigatórios' });
    }

    // Verifica se já existe conexão com este email
    const existing = await pool.query(
      'SELECT id FROM crm_connections WHERE email = $1',
      [email.toLowerCase()]
    );

    let result;
    if (existing.rows[0]) {
      result = await pool.query(
        `UPDATE crm_connections
         SET crm_password = $1, base_url = $2, is_active = true,
             encrypted_session = NULL, updated_at = NOW()
         WHERE email = $3
         RETURNING id, email, base_url, workspace_id, workspace_name, is_active, created_at`,
        [password, base_url, email.toLowerCase()]
      );
    } else {
      result = await pool.query(
        `INSERT INTO crm_connections (email, crm_password, base_url, is_active)
         VALUES ($1, $2, $3, true)
         RETURNING id, email, base_url, workspace_id, workspace_name, is_active, created_at`,
        [email.toLowerCase(), password, base_url]
      );
    }

    const conn = result.rows[0];

    // Validate credentials with Linux worker
    let workerValid = null;
    let workerError = null;
    try {
      const workerRes = await fetch('http://207.180.210.173:8080/api/21online/test-login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-api-key': process.env.INTERNAL_API_KEY,
        },
        body: JSON.stringify({ email: email.toLowerCase(), password }),
        signal: AbortSignal.timeout(15000),
      });
      const workerData = await workerRes.json().catch(() => ({}));
      workerValid = workerRes.ok;
      if (!workerRes.ok) workerError = workerData.error || workerData.message || 'Erro de autenticação no 21online.app';
    } catch (fetchErr) {
      workerError = 'Não foi possível contactar o servidor de validação';
    }

    res.status(201).json({ ...conn, worker_valid: workerValid, worker_error: workerError });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/connections/:id — ativar/desativar
router.patch('/:id', verifyToken, requireRole('admin'), async (req, res, next) => {
  try {
    const { is_active } = req.body;
    const result = await pool.query(
      `UPDATE crm_connections SET is_active = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, email, is_active`,
      [is_active, req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Conexão não encontrada' });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// POST /api/connections/activate — ativa uma credencial c21_credentials como conexão CRM
router.post('/activate', verifyToken, requireRole('admin'), async (req, res, next) => {
  try {
    const { credential_id } = req.body;
    if (!credential_id) {
      return res.status(400).json({ error: 'credential_id é obrigatório' });
    }

    const credResult = await pool.query(
      'SELECT id, name, email, crm_password, is_active FROM c21_credentials WHERE id = $1',
      [credential_id]
    );
    const cred = credResult.rows[0];
    if (!cred) return res.status(404).json({ error: 'Credencial não encontrada' });
    if (!cred.is_active) return res.status(400).json({ error: 'A credencial selecionada está inativa' });

    // Desativar todas as conexões existentes
    await pool.query('UPDATE crm_connections SET is_active = false, updated_at = NOW()');

    // Upsert por email
    const existing = await pool.query(
      'SELECT id FROM crm_connections WHERE email = $1',
      [cred.email]
    );

    let conn;
    if (existing.rows[0]) {
      const r = await pool.query(
        `UPDATE crm_connections
         SET crm_password = $1, is_active = true, encrypted_session = NULL, updated_at = NOW()
         WHERE email = $2
         RETURNING id, email, base_url, workspace_id, workspace_name, is_active, last_sync_at, created_at,
                   CASE WHEN encrypted_session IS NOT NULL THEN true ELSE false END AS has_session`,
        [cred.crm_password, cred.email]
      );
      conn = r.rows[0];
    } else {
      const r = await pool.query(
        `INSERT INTO crm_connections (email, crm_password, base_url, is_active)
         VALUES ($1, $2, 'https://21online.app', true)
         RETURNING id, email, base_url, workspace_id, workspace_name, is_active, last_sync_at, created_at,
                   false AS has_session`,
        [cred.email, cred.crm_password]
      );
      conn = r.rows[0];
    }

    res.json({ ...conn, credential_name: cred.name });
  } catch (err) {
    next(err);
  }
});

// GET /api/connections/workspaces — lista workspaces disponíveis no 21online.app
router.get('/workspaces', verifyToken, requireRole('admin'), async (req, res, next) => {
  try {
    const connResult = await pool.query(
      `SELECT email, crm_password FROM crm_connections WHERE is_active = true ORDER BY created_at DESC LIMIT 1`
    );
    const conn = connResult.rows[0];
    if (!conn) {
      return res.status(404).json({ error: 'Nenhuma conexão ativa configurada.' });
    }

    const workerRes = await fetch('http://207.180.210.173:8080/api/21online/crm-fetch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-api-key': process.env.INTERNAL_API_KEY,
      },
      body: JSON.stringify({ email: conn.email, password: conn.crm_password, path: '/api/workspaces' }),
      signal: AbortSignal.timeout(20000),
    });

    const workerData = await workerRes.json().catch(() => ({}));
    if (!workerRes.ok || !workerData.success) {
      return res.status(502).json({ error: workerData.error || 'Erro ao obter workspaces.' });
    }

    const items = Array.isArray(workerData.data)
      ? workerData.data
      : Array.isArray(workerData.data?.data)
        ? workerData.data.data
        : [];

    res.json({ data: items, connection_email: conn.email });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/connections/:id
router.delete('/:id', verifyToken, requireRole('admin'), async (req, res, next) => {
  try {
    const result = await pool.query(
      'DELETE FROM crm_connections WHERE id = $1 RETURNING id',
      [req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Conexão não encontrada' });
    res.json({ message: 'Conexão removida' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
