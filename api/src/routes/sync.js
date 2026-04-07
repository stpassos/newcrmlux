const express = require('express');
const pool = require('../db/pool');
const { verifyToken, requireRole, verifyInternalKey } = require('../middleware/auth');

const router = express.Router();

const BUSINESS_TYPE_MAP = {
  sale: 'venda',
  rent: 'arrendamento',
  trespass: 'trespasse',
};

// POST /api/sync/callback — called by Linux worker with batches of 21online records
router.post('/callback', verifyInternalKey, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { entity, records, job_id } = req.body;
    if (!entity || !records || !Array.isArray(records)) {
      return res.status(400).json({ error: 'entity and records[] required' });
    }

    await client.query('BEGIN');

    let processed = 0;
    let errors = 0;

    for (const record of records) {
      try {
        if (entity === 'assets') {
          await upsertProperty(client, record);
        } else if (entity === 'users') {
          await upsertComercial(client, record);
        } else if (entity === 'leads') {
          await upsertLead(client, record);
        }
        processed++;
      } catch (err) {
        console.error(`Error processing ${entity} ${record?.id}:`, err.message);
        errors++;
      }
    }

    if (job_id) {
      await client.query(
        `UPDATE crm21_sync_jobs
         SET processed_records = processed_records + $1,
             failed_records = failed_records + $2
         WHERE id = $3`,
        [processed, errors, job_id]
      );
    }

    await client.query('COMMIT');
    res.json({ processed, errors, total: records.length });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

async function upsertProperty(client, raw) {
  const crm_external_id = String(raw.id || raw.asset_id || '');
  if (!crm_external_id) throw new Error('Missing asset id');

  const tipo_negocio = BUSINESS_TYPE_MAP[raw.business_type] || raw.business_type || null;
  const preco = parseFloat(raw.price) || null;
  const ad_title = raw.title || raw.designation || raw.ad_title || null;
  const descricao = raw.description || raw.obs || null;

  const address = raw.address || raw.location?.address || null;
  const cidade = raw.municipality || raw.location?.municipality || raw.city || null;
  const distrito = raw.district || raw.location?.district || null;
  const country = raw.country || 'Portugal';
  const postalMatch = (raw.postal_code || address || '').match(/\d{4}-\d{3}/);
  const postal_code = postalMatch ? postalMatch[0] : null;
  const latitude = parseFloat(raw.latitude || raw.location?.lat) || null;
  const longitude = parseFloat(raw.longitude || raw.location?.lng) || null;

  const numero_quartos = parseInt(raw.bedrooms || raw.rooms) || null;
  const number_of_wcs = parseInt(raw.bathrooms || raw.wcs) || null;
  const gross_area = parseFloat(raw.gross_area || raw.area_gross) || null;
  const area_util = parseFloat(raw.useful_area || raw.area_useful) || null;
  const terrain_area = parseFloat(raw.land_area || raw.area_land) || null;
  const energy_efficiency = raw.energy_certificate || raw.energy || null;
  const building_year = parseInt(raw.year_built || raw.construction_year) || null;
  const tipo_imovel = raw.property_type || raw.sub_type || raw.asset_type || null;
  const foto_url = raw.main_photo || raw.photo_url || raw.foto_url || null;

  const estado = (raw.status === 'active' || raw.active === true) ? 'Disponível' : 'Indisponível';

  // Resolve consultor by crm_id
  let consultor_id = null;
  const agentId = raw.agent_id || raw.user_id || raw.comercial_crm_id;
  if (agentId) {
    const c = await client.query('SELECT id FROM comerciais WHERE crm_id = $1', [String(agentId)]);
    consultor_id = c.rows[0]?.id || null;
  }

  await client.query(
    `INSERT INTO properties (
       crm_external_id, crm_status, last_synced_at,
       ad_title, descricao, estado, tipo_negocio, tipo_imovel, preco,
       address, cidade, distrito, postal_code, country, latitude, longitude,
       numero_quartos, number_of_wcs, gross_area, area_util, terrain_area,
       energy_efficiency, building_year, foto_url,
       consultor_id, crm_payload
     ) VALUES (
       $1,$2,NOW(),$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
       $16,$17,$18,$19,$20,$21,$22,$23,$24,$25
     )
     ON CONFLICT (crm_external_id) DO UPDATE SET
       crm_status = EXCLUDED.crm_status,
       last_synced_at = NOW(),
       ad_title = EXCLUDED.ad_title,
       descricao = EXCLUDED.descricao,
       estado = EXCLUDED.estado,
       tipo_negocio = EXCLUDED.tipo_negocio,
       tipo_imovel = EXCLUDED.tipo_imovel,
       preco = EXCLUDED.preco,
       address = EXCLUDED.address,
       cidade = EXCLUDED.cidade,
       distrito = EXCLUDED.distrito,
       postal_code = EXCLUDED.postal_code,
       latitude = EXCLUDED.latitude,
       longitude = EXCLUDED.longitude,
       numero_quartos = EXCLUDED.numero_quartos,
       number_of_wcs = EXCLUDED.number_of_wcs,
       gross_area = EXCLUDED.gross_area,
       area_util = EXCLUDED.area_util,
       terrain_area = EXCLUDED.terrain_area,
       energy_efficiency = EXCLUDED.energy_efficiency,
       building_year = EXCLUDED.building_year,
       foto_url = EXCLUDED.foto_url,
       consultor_id = COALESCE(EXCLUDED.consultor_id, properties.consultor_id),
       crm_payload = EXCLUDED.crm_payload,
       updated_at = NOW()`,
    [
      crm_external_id, raw.status || 'active',
      ad_title, descricao, estado, tipo_negocio, tipo_imovel, preco,
      address, cidade, distrito, postal_code, country, latitude, longitude,
      numero_quartos, number_of_wcs, gross_area, area_util, terrain_area,
      energy_efficiency, building_year, foto_url,
      consultor_id, JSON.stringify(raw)
    ]
  );
}

async function upsertComercial(client, raw) {
  const crm_id = String(raw.id || raw.user_id || '');
  if (!crm_id) throw new Error('Missing user id');

  const nome = raw.name || `${raw.first_name || ''} ${raw.last_name || ''}`.trim() || 'Sem Nome';
  const email = raw.email;

  await client.query(
    `INSERT INTO comerciais (crm_id, nome, email)
     VALUES ($1, $2, $3)
     ON CONFLICT (crm_id) DO UPDATE SET
       nome = COALESCE(EXCLUDED.nome, comerciais.nome),
       email = COALESCE(EXCLUDED.email, comerciais.email),
       updated_at = NOW()`,
    [crm_id, nome, email]
  );
}

async function upsertLead(client, raw) {
  const crm_lead_id = String(raw.id || raw.lead_id || '');
  if (!crm_lead_id) throw new Error('Missing lead id');

  const lead_name = raw.name || `${raw.first_name || ''} ${raw.last_name || ''}`.trim() || 'Sem Nome';

  // Resolve property by crm_external_id
  let property_id = null;
  if (raw.asset_id) {
    const p = await client.query('SELECT id FROM properties WHERE crm_external_id = $1', [String(raw.asset_id)]);
    property_id = p.rows[0]?.id || null;
  }

  await client.query(
    `INSERT INTO lead_contacts (
       crm_lead_id, lead_name, lead_email, lead_phone,
       lead_source, lead_status, property_id, crm_payload
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (crm_lead_id) DO UPDATE SET
       lead_name = COALESCE(EXCLUDED.lead_name, lead_contacts.lead_name),
       lead_email = COALESCE(EXCLUDED.lead_email, lead_contacts.lead_email),
       lead_phone = COALESCE(EXCLUDED.lead_phone, lead_contacts.lead_phone),
       lead_status = EXCLUDED.lead_status,
       property_id = COALESCE(EXCLUDED.property_id, lead_contacts.property_id),
       crm_payload = EXCLUDED.crm_payload,
       updated_at = NOW()`,
    [
      crm_lead_id, lead_name, raw.email, raw.phone,
      raw.source || 'crm21', raw.status || 'nova',
      property_id, JSON.stringify(raw)
    ]
  );
}

// POST /api/sync/jobs — create sync job
router.post('/jobs', verifyToken, requireRole('admin'), async (req, res, next) => {
  try {
    const { entity, workspace_id, workspace_name } = req.body;
    if (!entity) return res.status(400).json({ error: 'entity required' });

    const result = await pool.query(
      `INSERT INTO crm21_sync_jobs (entity, status, workspace_id, workspace_name)
       VALUES ($1, 'queued', $2, $3)
       RETURNING *`,
      [entity, workspace_id || null, workspace_name || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// GET /api/sync/jobs
router.get('/jobs', verifyToken, requireRole('admin'), async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT * FROM crm21_sync_jobs ORDER BY created_at DESC LIMIT 50'
    );
    res.json({ data: result.rows });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/sync/jobs/:id — update job status (worker)
router.patch('/jobs/:id', verifyInternalKey, async (req, res, next) => {
  try {
    const { status, total_records, error_message, checkpoint } = req.body;
    const fields = [];
    const params = [];

    if (status) {
      params.push(status); fields.push(`status = $${params.length}`);
      if (status === 'running') fields.push('started_at = NOW()');
      if (['completed', 'failed'].includes(status)) fields.push('finished_at = NOW()');
    }
    if (total_records !== undefined) { params.push(total_records); fields.push(`total_records = $${params.length}`); }
    if (error_message !== undefined) { params.push(error_message); fields.push(`error_message = $${params.length}`); }
    if (checkpoint !== undefined) { params.push(JSON.stringify(checkpoint)); fields.push(`checkpoint = $${params.length}`); }

    if (!fields.length) return res.status(400).json({ error: 'No fields to update' });

    params.push(req.params.id);
    const result = await pool.query(
      `UPDATE crm21_sync_jobs SET ${fields.join(', ')}, updated_at = NOW()
       WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Job not found' });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
