/**
 * database.js
 *
 * Routes for the "Base de Dados" tab.
 * Exposes record counts, table sizes, and paginated record browsing
 * for each c21_ entity table.
 */

const express = require('express');
const pool    = require('../db/pool');
const { verifyToken, requireRole } = require('../middleware/auth');

const router = express.Router();

// Allowed tables (whitelist — prevents SQL injection via table name param)
const TABLE_META = [
  { table: 'c21_agents',        label: 'Agentes',      endpoint: '/api/users'        },
  { table: 'c21_contacts',      label: 'Contactos',    endpoint: '/api/contacts'     },
  { table: 'c21_assets',        label: 'Imóveis',      endpoint: '/api/assets'       },
  { table: 'c21_owners',        label: 'Vendedores',   endpoint: '/api/owners'       },
  { table: 'c21_buyers',        label: 'Compradores',  endpoint: '/api/buyers'       },
  { table: 'c21_transactions',  label: 'Transações',   endpoint: '/api/transactions' },
  { table: 'c21_referrals',     label: 'Referências',  endpoint: '/api/referrals'    },
  { table: 'c21_visits',        label: 'Visitas',      endpoint: '/api/visits'       },
  { table: 'c21_proposals',     label: 'Propostas',    endpoint: '/api/proposals'    },
  { table: 'c21_documents',     label: 'Documentos',   endpoint: '/api/documents'    },
  { table: 'c21_awards',        label: 'Galardões',    endpoint: '/api/awards'       },
  { table: 'c21_workspaces',    label: 'Workspaces',   endpoint: '/api/workspaces'   },
];

const ALLOWED_TABLES = new Set(TABLE_META.map(m => m.table));

// ─── GET /api/database/stats ──────────────────────────────────────────────────
// Returns record count + disk size for every whitelisted c21_ table.
router.get('/stats', verifyToken, requireRole('admin'), async (req, res, next) => {
  try {
    const rows = await Promise.all(TABLE_META.map(async meta => {
      const [countRes, sizeRes] = await Promise.all([
        pool.query(`SELECT COUNT(*) AS cnt FROM ${meta.table}`).catch(() => ({ rows: [{ cnt: 0 }] })),
        pool.query(
          `SELECT pg_total_relation_size($1) AS bytes,
                  pg_size_pretty(pg_total_relation_size($1)) AS pretty`,
          [meta.table]
        ).catch(() => ({ rows: [{ bytes: 0, pretty: '0 bytes' }] })),
      ]);
      return {
        table:    meta.table,
        label:    meta.label,
        endpoint: meta.endpoint,
        count:    parseInt(countRes.rows[0]?.cnt ?? 0),
        size_bytes:  parseInt(sizeRes.rows[0]?.bytes ?? 0),
        size_pretty: sizeRes.rows[0]?.pretty ?? '0 bytes',
      };
    }));

    res.json({ tables: rows });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/database/records/:table ────────────────────────────────────────
// Returns paginated rows from the specified table.
// Query params: page (default 1), limit (default 50, max 200), search (optional text)
router.get('/records/:table', verifyToken, requireRole('admin'), async (req, res, next) => {
  const { table } = req.params;

  if (!ALLOWED_TABLES.has(table)) {
    return res.status(400).json({ error: 'Tabela não permitida' });
  }

  const page  = Math.max(1, parseInt(req.query.page  || '1'));
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || '50')));
  const offset = (page - 1) * limit;
  const search = (req.query.search || '').trim();

  try {
    // Get column list
    const colRes = await pool.query(
      `SELECT column_name, data_type
       FROM information_schema.columns
       WHERE table_name = $1 AND table_schema = 'public'
       ORDER BY ordinal_position`,
      [table]
    );
    const columns = colRes.rows;

    // Build WHERE clause for text search (searches TEXT columns only)
    let whereClause = '';
    const params = [];
    if (search) {
      const textCols = columns
        .filter(c => ['text', 'character varying', 'uuid'].includes(c.data_type))
        .slice(0, 8)  // limit to first 8 text columns for performance
        .map(c => c.column_name);

      if (textCols.length > 0) {
        params.push(`%${search}%`);
        const conditions = textCols.map(col => `${col}::text ILIKE $1`).join(' OR ');
        whereClause = `WHERE ${conditions}`;
      }
    }

    const countParams = search && params.length ? params : [];
    const dataParams  = search && params.length ? [...params, limit, offset] : [limit, offset];
    const limitIdx    = dataParams.length - 1;
    const offsetIdx   = dataParams.length;

    const [countRes, dataRes] = await Promise.all([
      pool.query(
        `SELECT COUNT(*) AS cnt FROM ${table} ${whereClause}`,
        countParams
      ),
      pool.query(
        `SELECT * FROM ${table} ${whereClause} ORDER BY 1 DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        dataParams
      ),
    ]);

    res.json({
      table,
      columns: columns.map(c => ({ name: c.column_name, type: c.data_type })),
      total:   parseInt(countRes.rows[0]?.cnt ?? 0),
      page,
      limit,
      rows:    dataRes.rows,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
