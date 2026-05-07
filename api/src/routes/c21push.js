const express = require('express');
const pool = require('../db/pool');

const router = express.Router();

// ─── Session cache ────────────────────────────────────────────────────────────
const SESSION_TTL = 20 * 60 * 1000; // 20 min (conservative vs worker's 25)
const sessions = new Map();

function getSession(email) {
  const s = sessions.get(email);
  if (!s) return null;
  if (Date.now() - s.savedAt > SESSION_TTL) { sessions.delete(email); return null; }
  return s.cookies;
}
function saveSession(email, cookies) { sessions.set(email, { cookies, savedAt: Date.now() }); }
function dropSession(email) { sessions.delete(email); }

// ─── 21online.app RSC action hashes ──────────────────────────────────────────
const ACTION_LOGIN   = '7ec4e77929af146ecef2369bc094f4fbdbe9ab11';
const ACTION_CONTACT = '9bc4e229e9ad1976635305ec5d8f2eb520efff6c';
const ACTION_LEAD    = 'a749214a545c8866292269722d66c3012ca54124';

// Router state trees (URL-encoded) for each page — required by Next.js RSC
const TREE_LOGIN    = encodeURIComponent(JSON.stringify(["",{"children":["(root)",{"children":["login",{"children":["__PAGE__",{},"/login","refresh"]}]},null,null]},null,null,true]));
const TREE_CONTACTS = encodeURIComponent(JSON.stringify(["",{"children":["(root)",{"children":["contacts",{"children":["__PAGE__",{},"/contacts","refresh"]}]},null,null]},null,null,true]));
const TREE_LEADS    = encodeURIComponent(JSON.stringify(["",{"children":["(root)",{"children":["leads",{"children":["__PAGE__",{},"/leads","refresh"]}]},null,null]},null,null,true]));

// ─── Login ────────────────────────────────────────────────────────────────────
async function login21online(email, password) {
  const res = await fetch('https://21online.app/login', {
    method: 'POST',
    headers: {
      'Accept': 'text/x-component',
      'Content-Type': 'text/plain;charset=UTF-8',
      'Next-Action': ACTION_LOGIN,
      'Next-Router-State-Tree': TREE_LOGIN,
      'Origin': 'https://21online.app',
      'Referer': 'https://21online.app/login',
      'User-Agent': 'newcrmlux-api/1.0',
    },
    body: JSON.stringify([{ email, password, redirectUrl: '/dashboard' }]),
    signal: AbortSignal.timeout(15000),
  });

  const text = await res.text();
  if (text.includes('validationErrors') || text.includes('serverError')) {
    throw new Error(`21online login failed for ${email}`);
  }

  // Extract cookies — Node 18+ supports getSetCookie()
  const rawCookies = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [res.headers.get('set-cookie')].filter(Boolean);

  if (!rawCookies.length) throw new Error('21online login returned no session cookies');

  // Keep only name=value (strip path/domain/etc)
  return rawCookies.map(c => c.split(';')[0]).join('; ');
}

async function getAuthCookies(email, password) {
  const cached = getSession(email);
  if (cached) return cached;
  const cookies = await login21online(email, password);
  saveSession(email, cookies);
  return cookies;
}

// ─── RSC call ─────────────────────────────────────────────────────────────────
// Returns data object (with .id) on success, null on 401, throws on other errors
async function callRSC(path, actionHash, routerTree, payload, cookieStr) {
  const res = await fetch(`https://21online.app${path}`, {
    method: 'POST',
    headers: {
      'Accept': 'text/x-component',
      'Content-Type': 'text/plain;charset=UTF-8',
      'Next-Action': actionHash,
      'Next-Router-State-Tree': routerTree,
      'Origin': 'https://21online.app',
      'Referer': `https://21online.app${path}`,
      'Cookie': cookieStr,
      'User-Agent': 'newcrmlux-api/1.0',
    },
    body: JSON.stringify([payload]),
    signal: AbortSignal.timeout(15000),
  });

  if (res.status === 401) return null;

  const text = await res.text();

  // Parse RSC stream — look for line with {"data":{...}} containing an id
  for (const line of text.split('\n')) {
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const content = line.slice(colon + 1).trim();
    if (!content.startsWith('{')) continue;
    try {
      const obj = JSON.parse(content);
      if (obj?.data?.id || obj?.data?.isSuccess) return obj.data;
    } catch (_) { /* not JSON, skip */ }
  }

  throw new Error(`Unexpected RSC response from ${path}: ${text.slice(0, 300)}`);
}

// ─── Source mapping (portal capitalised → 21online API values) ────────────────
// Portal CRM has 6 fonte values — mapped to 21online source strings
const FONTE_MAP = {
  // Portal values (case-insensitive)
  'idealista':  'idealista',
  'imovirtual': 'imovirtual',
  'site c21':   'agency_website',
  'escala':     'outro',
  'agência':    'outro',
  'agencia':    'outro',
  'outro':      'outro',
  // Pass-through for any 21online values sent directly
  'agency_website': 'agency_website', 'cartel_c21': 'cartel_c21',
  'casayes': 'casayes', 'century_21_es': 'century_21_es',
  'century_21_pt': 'century_21_pt', 'custojusto': 'custojusto',
  'fotocasa': 'fotocasa', 'greenacres': 'greenacres',
  'habitaclia': 'habitaclia', 'idealista_es': 'idealista_es',
  'idealista_pt': 'idealista_pt', 'indomio': 'indomio',
  'jamesedition': 'jamesedition', 'kyero': 'kyero',
  'listglobally': 'listglobally', 'mls': 'mls', 'olx': 'olx',
  'pisos': 'pisos', 'resales': 'resales', 'vistamar': 'vistamar',
};
function mapFonte(fonte) {
  if (!fonte) return 'outro';
  return FONTE_MAP[fonte.toLowerCase().trim()] ?? 'outro';
}

// ─── POST /api/21online/push-lead ─────────────────────────────────────────────
// Called by Lovable Edge Function (trigger on public.leads INSERT)
// Auth: x-internal-api-key header
router.post('/push-lead', async (req, res, next) => {
  const apiKey = req.headers['x-internal-api-key'];
  if (!apiKey || apiKey !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { client_name, client_email, client_phone, crm_id, workspace_id, referencia, fonte, mensagem } = req.body;

  if (!client_name || !crm_id) {
    return res.status(400).json({ error: 'client_name e crm_id são obrigatórios' });
  }

  try {
    // 1. Resolve workspace UUID
    // Primary: look up from c21_agents by consultant's crm_id (external_id)
    // Fallback: derive from workspace_id integer using known mapping
    const WORKSPACE_MAP = {
      2158: '1a7fcf97-c0c5-483c-848b-9477380bf079', // CENTURY 21 Lux II (Estoril)
       316: '8426c13c-6568-4c79-b3ad-d6edbd91d3f4', // CENTURY 21 Lux (Cacém)
    };

    const agentRow = (await pool.query(
      'SELECT workspace_id FROM c21_agents WHERE external_id = $1 LIMIT 1',
      [crm_id]
    )).rows[0];

    const workspaceUuid = agentRow?.workspace_id
      || (workspace_id && WORKSPACE_MAP[Number(workspace_id)])
      || null;

    if (!workspaceUuid) {
      return res.status(404).json({ error: `Workspace não encontrado para crm_id ${crm_id} / workspace_id ${workspace_id}` });
    }

    // 2. Get active 21online credential (there's currently only one — Ana Pinto)
    const credRow = (await pool.query(
      'SELECT email, crm_password FROM c21_credentials WHERE is_active = true ORDER BY created_at LIMIT 1'
    )).rows[0];

    if (!credRow) return res.status(500).json({ error: 'Sem credenciais 21online activas' });

    // 3. Authenticate (uses cache)
    let cookies = await getAuthCookies(credRow.email, credRow.crm_password);

    // Helper: call RSC, re-auth once on 401
    async function rsc(path, hash, tree, payload) {
      let data = await callRSC(path, hash, tree, payload, cookies);
      if (data === null) {
        dropSession(credRow.email);
        cookies = await login21online(credRow.email, credRow.crm_password);
        saveSession(credRow.email, cookies);
        data = await callRSC(path, hash, tree, payload, cookies);
      }
      return data;
    }

    // 4. Create contact in 21online
    const contactPayload = {
      name: client_name,
      topic: crm_id,
      topic_type: 'users',
    };
    if (client_email) contactPayload.email = client_email;
    if (client_phone) contactPayload.phone = client_phone;

    const contactData = await rsc('/contacts', ACTION_CONTACT, TREE_CONTACTS, contactPayload);
    if (!contactData?.id) {
      return res.status(502).json({ error: 'Falha ao criar contacto no 21online — resposta inesperada' });
    }

    // 5. Create lead in 21online
    // Try lead_type "reference" if referencia provided; fall back to "lead" on failure
    const buildLeadPayload = (useRef) => {
      const p = {
        lead_type: useRef ? 'reference' : 'normal_lead',
        contact_id: contactData.id,
        user_id: crm_id,
        workspace_id: workspaceUuid,
        lang: 'pt',
        source: mapFonte(fonte),
      };
      if (useRef && referencia) p.reference = referencia;
      if (mensagem) p.message = mensagem;
      return p;
    };

    let leadData = referencia
      ? await rsc('/leads', ACTION_LEAD, TREE_LEADS, buildLeadPayload(true))
      : null;

    if (!leadData?.id && !leadData?.isSuccess) {
      leadData = await rsc('/leads', ACTION_LEAD, TREE_LEADS, buildLeadPayload(false));
    }

    if (!leadData?.id && !leadData?.isSuccess) {
      return res.status(502).json({
        error: 'Falha ao criar lead no 21online — resposta inesperada',
        contact_id: contactData.id,
      });
    }

    res.json({ success: true, lead_id: leadData.id || null, contact_id: contactData.id });

  } catch (err) {
    next(err);
  }
});

module.exports = router;
