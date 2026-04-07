const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

// POST /api/auth/login
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const result = await pool.query(
      `SELECT u.id, u.email, u.password_hash, u.user_type, u.is_active,
              c.id AS comercial_id, c.nome, c.foto_url, c.contacto
       FROM users u
       LEFT JOIN comerciais c ON c.user_id = u.id
       WHERE u.email = $1`,
      [email.toLowerCase()]
    );

    const user = result.rows[0];
    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const payload = {
      id: user.id,
      email: user.email,
      user_type: user.user_type,
      comercial_id: user.comercial_id,
      nome: user.nome,
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    });

    await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        user_type: user.user_type,
        comercial_id: user.comercial_id,
        nome: user.nome,
        foto_url: user.foto_url,
        contacto: user.contacto,
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/me
router.get('/me', verifyToken, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.email, u.user_type, u.is_active, u.last_login_at, u.created_at,
              c.id AS comercial_id, c.nome, c.foto_url, c.contacto, c.cargo_id,
              c.agencia_principal_id, c.crm_id
       FROM users u
       LEFT JOIN comerciais c ON c.user_id = u.id
       WHERE u.id = $1`,
      [req.user.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/refresh
router.post('/refresh', verifyToken, (req, res) => {
  const { id, email, user_type, comercial_id, nome } = req.user;
  const token = jwt.sign({ id, email, user_type, comercial_id, nome }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
  res.json({ token });
});

// POST /api/auth/change-password
router.post('/change-password', verifyToken, async (req, res, next) => {
  try {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) {
      return res.status(400).json({ error: 'current_password and new_password required' });
    }
    if (new_password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const result = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    const user = result.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });

    const valid = await bcrypt.compare(current_password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });

    const hash = await bcrypt.hash(new_password, 12);
    await pool.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [hash, req.user.id]);

    res.json({ message: 'Password updated' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
