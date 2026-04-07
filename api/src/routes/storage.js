const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const pool = require('../db/pool');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

const STORAGE_ROOT = process.env.STORAGE_PATH || 'C:\\storage\\newcrmlux';

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const module_type = req.body.module || req.query.module || 'generic';
      const dir = path.join(STORAGE_ROOT, module_type);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, `${uuidv4()}${ext}`);
    },
  }),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
});

// POST /api/storage/upload
router.post('/upload', verifyToken, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file provided' });

    const {
      module: moduleType = 'generic',
      entity_type,
      entity_id,
      visibility = 'private',
    } = req.body;

    const relativePath = path.join(moduleType, req.file.filename).replace(/\\/g, '/');

    const result = await pool.query(
      `INSERT INTO storage_files
         (file_path, original_filename, mime_type, file_ext, size_bytes,
          visibility, module, entity_type, entity_id, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id, file_path, original_filename, mime_type, size_bytes, visibility, module, created_at`,
      [
        relativePath,
        req.file.originalname,
        req.file.mimetype,
        path.extname(req.file.originalname).replace('.', ''),
        req.file.size,
        visibility === 'public' ? 'public' : 'private',
        moduleType,
        entity_type || null,
        entity_id || null,
        req.user.id,
      ]
    );

    const file = result.rows[0];
    file.url = `/api/storage/${file.id}`;
    res.status(201).json(file);
  } catch (err) {
    next(err);
  }
});

// GET /api/storage/:id — serve file
router.get('/:id', async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT * FROM storage_files WHERE id = $1 AND is_active = true',
      [req.params.id]
    );
    const file = result.rows[0];
    if (!file) return res.status(404).json({ error: 'File not found' });

    if (file.visibility === 'private') {
      const authHeader = req.headers['authorization'];
      const token = authHeader && authHeader.split(' ')[1];
      if (!token) return res.status(401).json({ error: 'Authentication required' });
      try {
        require('jsonwebtoken').verify(token, process.env.JWT_SECRET);
      } catch {
        return res.status(401).json({ error: 'Invalid token' });
      }
    }

    const filePath = path.join(STORAGE_ROOT, file.file_path);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found on disk' });

    res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${file.original_filename}"`);
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    next(err);
  }
});

// GET /api/storage — list files
router.get('/', verifyToken, async (req, res, next) => {
  try {
    const { entity_type, entity_id, module: moduleType } = req.query;
    const conditions = ['is_active = true'];
    const params = [];

    if (entity_type) { params.push(entity_type); conditions.push(`entity_type = $${params.length}`); }
    if (entity_id) { params.push(entity_id); conditions.push(`entity_id = $${params.length}`); }
    if (moduleType) { params.push(moduleType); conditions.push(`module = $${params.length}`); }

    const result = await pool.query(
      `SELECT id, file_path, original_filename, mime_type, size_bytes, visibility,
              module, entity_type, entity_id, created_at
       FROM storage_files
       WHERE ${conditions.join(' AND ')}
       ORDER BY created_at ASC`,
      params
    );

    const data = result.rows.map(f => ({ ...f, url: `/api/storage/${f.id}` }));
    res.json({ data, total: data.length });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/storage/:id — soft delete
router.delete('/:id', verifyToken, async (req, res, next) => {
  try {
    const result = await pool.query(
      'UPDATE storage_files SET is_active = false, updated_at = NOW() WHERE id = $1 AND is_active = true RETURNING id',
      [req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'File not found' });
    res.json({ message: 'File deleted' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
