const express = require('express');
const pool = require('../db/pool');
const { verifyToken, requireRole } = require('../middleware/auth');

const router = express.Router();

const WORKER_LUX1_URL = process.env.WORKER_LUX1_URL || 'http://173.249.49.92:8080';
const WORKER_LUX1_KEY = process.env.WORKER_LUX1_KEY || '';

// GET /api/credentials
router.get('/', verifyToken, requireRole('admin'), async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id, name, email, is_active, last_tested_at, test_status, test_error,
              created_at, updated_at
       FROM c21_credentials
       ORDER BY created_at DESC`
    );
    res.json({ data: result.rows });
  } catch (err) {
    next(err);
  }
});

// POST /api/credentials — criar nova credencial
router.post('/', verifyToken, requireRole('admin'), async (req, res, next) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'name, email e password são obrigatórios' });
    }
    const result = await pool.query(
      `INSERT INTO c21_credentials (name, email, crm_password)
       VALUES ($1, $2, $3)
       RETURNING id, name, email, is_active, last_tested_at, test_status, test_error, created_at`,
      [name.trim(), email.toLowerCase().trim(), password]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/credentials/:id — atualizar campos
router.patch('/:id', verifyToken, requireRole('admin'), async (req, res, next) => {
  try {
    const { name, email, password, is_active } = req.body;
    const sets = [];
    const values = [];
    let i = 1;

    if (name !== undefined)      { sets.push(`name = $${i++}`);         values.push(name.trim()); }
    if (email !== undefined)     { sets.push(`email = $${i++}`);        values.push(email.toLowerCase().trim()); }
    if (password !== undefined)  { sets.push(`crm_password = $${i++}`); values.push(password); }
    if (is_active !== undefined) { sets.push(`is_active = $${i++}`);    values.push(is_active); }

    if (sets.length === 0) return res.status(400).json({ error: 'Nenhum campo para atualizar' });

    values.push(req.params.id);
    const result = await pool.query(
      `UPDATE c21_credentials SET ${sets.join(', ')}, updated_at = NOW()
       WHERE id = $${i}
       RETURNING id, name, email, is_active, last_tested_at, test_status, test_error, updated_at`,
      values
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Credencial não encontrada' });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/credentials/:id
router.delete('/:id', verifyToken, requireRole('admin'), async (req, res, next) => {
  try {
    const result = await pool.query(
      'DELETE FROM c21_credentials WHERE id = $1 RETURNING id',
      [req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Credencial não encontrada' });
    res.json({ message: 'Credencial removida' });
  } catch (err) {
    next(err);
  }
});

// POST /api/credentials/:id/test — testar conexão via WorkerLux-1
router.post('/:id/test', verifyToken, requireRole('admin'), async (req, res, next) => {
  try {
    const credResult = await pool.query(
      'SELECT email, crm_password FROM c21_credentials WHERE id = $1',
      [req.params.id]
    );
    const cred = credResult.rows[0];
    if (!cred) return res.status(404).json({ error: 'Credencial não encontrada' });

    let testStatus = 'error';
    let testError = null;

    try {
      const workerRes = await fetch(`${WORKER_LUX1_URL}/api/21online/test-login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-api-key': WORKER_LUX1_KEY,
        },
        body: JSON.stringify({ email: cred.email, password: cred.crm_password }),
        signal: AbortSignal.timeout(20000),
      });
      const workerData = await workerRes.json().catch(() => ({}));
      if (workerRes.ok && workerData.success === true) {
        testStatus = 'success';
      } else {
        testError = workerData.error || workerData.message || 'Autenticação falhou no 21online.app';
      }
    } catch (fetchErr) {
      testError = fetchErr.name === 'TimeoutError'
        ? 'Timeout ao contactar o WorkerLux-1'
        : 'Não foi possível contactar o WorkerLux-1';
    }

    // Persist test result
    await pool.query(
      `UPDATE c21_credentials
       SET last_tested_at = NOW(), test_status = $1, test_error = $2, updated_at = NOW()
       WHERE id = $3`,
      [testStatus, testError, req.params.id]
    );

    res.json({ success: testStatus === 'success', error: testError });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
