const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const { verifyToken, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/users — list users with comercial profile
router.get('/', verifyToken, requireRole('admin'), async (req, res, next) => {
  try {
    const { user_type, is_active, search, limit = 50, offset = 0 } = req.query;
    const conditions = [];
    const params = [];

    if (user_type) { params.push(user_type); conditions.push(`u.user_type = $${params.length}`); }
    if (is_active !== undefined) { params.push(is_active === 'true'); conditions.push(`u.is_active = $${params.length}`); }
    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(u.email ILIKE $${params.length} OR c.nome ILIKE $${params.length})`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(
      `SELECT u.id, u.email, u.user_type, u.is_active, u.last_login_at, u.created_at,
              c.id AS comercial_id, c.nome, c.contacto, c.foto_url, c.crm_id, c.estado AS comercial_estado
       FROM users u
       LEFT JOIN comerciais c ON c.user_id = u.id
       ${where}
       ORDER BY c.nome ASC NULLS LAST
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const count = await pool.query(
      `SELECT COUNT(*) FROM users u LEFT JOIN comerciais c ON c.user_id = u.id ${where}`,
      params.slice(0, -2)
    );

    res.json({ data: result.rows, total: parseInt(count.rows[0].count) });
  } catch (err) {
    next(err);
  }
});

// GET /api/users/:id
router.get('/:id', verifyToken, async (req, res, next) => {
  try {
    if (req.user.user_type !== 'admin' && req.user.id !== req.params.id) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    const result = await pool.query(
      `SELECT u.id, u.email, u.user_type, u.is_active, u.last_login_at, u.created_at,
              c.id AS comercial_id, c.nome, c.contacto, c.foto_url, c.crm_id,
              c.cargo_id, c.agencia_principal_id, c.facebook, c.instagram, c.linkedin
       FROM users u
       LEFT JOIN comerciais c ON c.user_id = u.id
       WHERE u.id = $1`,
      [req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// POST /api/users — create user + comercial profile (admin only)
router.post('/', verifyToken, requireRole('admin'), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { email, password, nome, user_type = 'comercial', contacto, foto_url, crm_id, agencia_principal_id } = req.body;
    if (!email || !password || !nome) {
      return res.status(400).json({ error: 'email, password and nome required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    await client.query('BEGIN');

    const hash = await bcrypt.hash(password, 12);
    const userResult = await client.query(
      `INSERT INTO users (email, password_hash, user_type)
       VALUES ($1, $2, $3)
       RETURNING id, email, user_type, created_at`,
      [email.toLowerCase(), hash, user_type]
    );
    const newUser = userResult.rows[0];

    const comercialResult = await client.query(
      `INSERT INTO comerciais (user_id, email, nome, contacto, foto_url, crm_id, agencia_principal_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, nome, contacto, foto_url, crm_id`,
      [newUser.id, email.toLowerCase(), nome, contacto, foto_url, crm_id, agencia_principal_id || null]
    );

    await client.query('COMMIT');
    res.status(201).json({ ...newUser, ...comercialResult.rows[0], comercial_id: comercialResult.rows[0].id });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// PUT /api/users/:id — update user (non-admins can only edit themselves)
router.put('/:id', verifyToken, async (req, res, next) => {
  const client = await pool.connect();
  try {
    if (req.user.user_type !== 'admin' && req.user.id !== req.params.id) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    await client.query('BEGIN');

    // Update users table (admin only fields)
    if (req.user.user_type === 'admin') {
      const { user_type, is_active } = req.body;
      if (user_type || is_active !== undefined) {
        const fields = [];
        const params = [];
        if (user_type) { params.push(user_type); fields.push(`user_type = $${params.length}`); }
        if (is_active !== undefined) { params.push(is_active); fields.push(`is_active = $${params.length}`); }
        if (fields.length) {
          params.push(req.params.id);
          await client.query(
            `UPDATE users SET ${fields.join(', ')}, updated_at = NOW() WHERE id = $${params.length}`,
            params
          );
        }
      }
    }

    // Update comerciais profile
    const { nome, contacto, foto_url, facebook, instagram, linkedin, website, biography } = req.body;
    const fields = [];
    const params = [];

    if (nome !== undefined) { params.push(nome); fields.push(`nome = $${params.length}`); }
    if (contacto !== undefined) { params.push(contacto); fields.push(`contacto = $${params.length}`); }
    if (foto_url !== undefined) { params.push(foto_url); fields.push(`foto_url = $${params.length}`); }
    if (facebook !== undefined) { params.push(facebook); fields.push(`facebook = $${params.length}`); }
    if (instagram !== undefined) { params.push(instagram); fields.push(`instagram = $${params.length}`); }
    if (linkedin !== undefined) { params.push(linkedin); fields.push(`linkedin = $${params.length}`); }
    if (website !== undefined) { params.push(website); fields.push(`website = $${params.length}`); }
    if (biography !== undefined) { params.push(biography); fields.push(`biografia = $${params.length}`); }

    let comercial = null;
    if (fields.length) {
      params.push(req.params.id);
      const result = await client.query(
        `UPDATE comerciais SET ${fields.join(', ')}, updated_at = NOW()
         WHERE user_id = $${params.length}
         RETURNING id AS comercial_id, nome, contacto, foto_url`,
        params
      );
      comercial = result.rows[0];
    }

    await client.query('COMMIT');
    res.json({ id: req.params.id, ...comercial });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// DELETE /api/users/:id — soft deactivate (admin only)
router.delete('/:id', verifyToken, requireRole('admin'), async (req, res, next) => {
  try {
    const result = await pool.query(
      'UPDATE users SET is_active = false, updated_at = NOW() WHERE id = $1 RETURNING id',
      [req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json({ message: 'User deactivated' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
