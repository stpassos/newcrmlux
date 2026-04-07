const express = require('express');
const pool = require('../db/pool');
const { verifyToken, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/properties
router.get('/', verifyToken, async (req, res, next) => {
  try {
    const {
      estado, tipo_negocio, tipo_imovel, consultor_id,
      min_preco, max_preco, search,
      limit = 50, offset = 0, order_by = 'created_at', order_dir = 'DESC'
    } = req.query;

    const conditions = ['p.archived = false'];
    const params = [];

    if (estado) { params.push(estado); conditions.push(`p.estado = $${params.length}`); }
    if (tipo_negocio) { params.push(tipo_negocio); conditions.push(`p.tipo_negocio = $${params.length}`); }
    if (tipo_imovel) { params.push(tipo_imovel); conditions.push(`p.tipo_imovel = $${params.length}`); }
    if (consultor_id) { params.push(consultor_id); conditions.push(`p.consultor_id = $${params.length}`); }
    if (min_preco) { params.push(parseFloat(min_preco)); conditions.push(`p.preco >= $${params.length}`); }
    if (max_preco) { params.push(parseFloat(max_preco)); conditions.push(`p.preco <= $${params.length}`); }
    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(p.ad_title ILIKE $${params.length} OR p.address ILIKE $${params.length} OR p.referencia ILIKE $${params.length})`);
    }

    const allowed_order = ['created_at', 'updated_at', 'preco', 'ad_title', 'last_synced_at'];
    const col = allowed_order.includes(order_by) ? order_by : 'created_at';
    const dir = order_dir.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    params.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(
      `SELECT
         p.id, p.referencia, p.crm_external_id, p.ad_title, p.estado, p.tipo_negocio, p.tipo_imovel,
         p.preco, p.address, p.cidade, p.distrito, p.postal_code, p.country,
         p.numero_quartos, p.number_of_wcs, p.gross_area, p.area_util, p.terrain_area,
         p.energy_efficiency, p.building_year, p.export_to_website, p.foto_url,
         p.crm_imported_at, p.last_synced_at, p.created_at, p.updated_at,
         p.consultor_id,
         c.nome AS consultor_nome, c.email AS consultor_email, c.contacto AS consultor_contacto
       FROM properties p
       LEFT JOIN comerciais c ON c.id = p.consultor_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY p.${col} ${dir}
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const count = await pool.query(
      `SELECT COUNT(*) FROM properties p WHERE ${conditions.join(' AND ')}`,
      params.slice(0, -2)
    );

    res.json({ data: result.rows, total: parseInt(count.rows[0].count) });
  } catch (err) {
    next(err);
  }
});

// GET /api/properties/:id
router.get('/:id', verifyToken, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT
         p.*,
         c.nome AS consultor_nome, c.email AS consultor_email,
         c.contacto AS consultor_contacto, c.foto_url AS consultor_foto
       FROM properties p
       LEFT JOIN comerciais c ON c.id = p.consultor_id
       WHERE p.id = $1 AND p.archived = false`,
      [req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Property not found' });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// GET /api/properties/:id/images
router.get('/:id/images', verifyToken, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id, url, crm_image_id, crm_image_url, ordem, is_cover, storage_file_id, created_at
       FROM property_images
       WHERE property_id = $1
       ORDER BY ordem ASC`,
      [req.params.id]
    );
    res.json({ data: result.rows });
  } catch (err) {
    next(err);
  }
});

// POST /api/properties
router.post('/', verifyToken, requireRole('admin'), async (req, res, next) => {
  try {
    const {
      referencia, ad_title, descricao, description_pt, estado = 'Disponível',
      tipo_negocio, tipo_imovel, preco,
      address, cidade, distrito, postal_code, country = 'Portugal', latitude, longitude,
      numero_quartos, number_of_wcs, gross_area, area_util, terrain_area,
      energy_efficiency, building_year, export_to_website,
      consultor_id, agencia_id
    } = req.body;

    const result = await pool.query(
      `INSERT INTO properties (
         referencia, ad_title, descricao, description_pt, estado,
         tipo_negocio, tipo_imovel, preco,
         address, cidade, distrito, postal_code, country, latitude, longitude,
         numero_quartos, number_of_wcs, gross_area, area_util, terrain_area,
         energy_efficiency, building_year, export_to_website,
         consultor_id, agencia_id
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
         $16,$17,$18,$19,$20,$21,$22,$23,$24,$25
       ) RETURNING id, referencia, ad_title, estado, created_at`,
      [
        referencia, ad_title, descricao, description_pt, estado,
        tipo_negocio, tipo_imovel, preco,
        address, cidade, distrito, postal_code, country, latitude, longitude,
        numero_quartos, number_of_wcs, gross_area, area_util, terrain_area,
        energy_efficiency, building_year, export_to_website,
        consultor_id || null, agencia_id || null
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// PUT /api/properties/:id
router.put('/:id', verifyToken, requireRole('admin'), async (req, res, next) => {
  try {
    const fields = [];
    const params = [];
    const allowed = [
      'ad_title', 'descricao', 'description_pt', 'estado', 'tipo_negocio', 'tipo_imovel',
      'preco', 'address', 'cidade', 'distrito', 'postal_code', 'country', 'latitude', 'longitude',
      'numero_quartos', 'number_of_wcs', 'gross_area', 'area_util', 'terrain_area',
      'energy_efficiency', 'building_year', 'export_to_website',
      'consultor_id', 'agencia_id', 'notas_internas', 'foto_url'
    ];

    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        params.push(req.body[key]);
        fields.push(`${key} = $${params.length}`);
      }
    }

    if (!fields.length) return res.status(400).json({ error: 'No fields to update' });

    params.push(req.params.id);
    const result = await pool.query(
      `UPDATE properties SET ${fields.join(', ')}, updated_at = NOW()
       WHERE id = $${params.length} AND archived = false
       RETURNING id, referencia, ad_title, estado, updated_at`,
      params
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Property not found' });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/properties/:id — soft archive
router.delete('/:id', verifyToken, requireRole('admin'), async (req, res, next) => {
  try {
    const result = await pool.query(
      'UPDATE properties SET archived = true, archived_at = NOW() WHERE id = $1 AND archived = false RETURNING id',
      [req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Property not found' });
    res.json({ message: 'Property archived' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
