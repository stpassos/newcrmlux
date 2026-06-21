const express = require('express');
const pool = require('../db/pool');
const { verifyToken, requireRole } = require('../middleware/auth');
const https = require('https');
const http = require('http');

const router = express.Router();

// ─── Evolution Go config ──────────────────────────────────────────────────────
const EVO_BASE_URL = process.env.EVOLUTION_GO_URL || 'https://lux.webflix.pt';
const EVO_API_KEY  = process.env.EVOLUTION_GO_API_KEY || '';
const PROXY_CONFIG = {
  host:     process.env.WA_PROXY_HOST     || 'p.webshare.io',
  port:     process.env.WA_PROXY_PORT     || '80',
  username: process.env.WA_PROXY_USERNAME || 'edtvcfal-PT-rotate',
  password: process.env.WA_PROXY_PASSWORD || 'e49i21vl4wna',
  protocol: process.env.WA_PROXY_PROTOCOL || 'http',
};

function evoRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(EVO_BASE_URL + path);
    const lib = url.protocol === 'https:' ? https : http;
    const payload = body ? JSON.stringify(body) : null;
    const req = lib.request({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname,
      method,
      headers: {
        'apikey': EVO_API_KEY,
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ─── POST /api/whatsapp/webhook ──────────────────────────────────────────────
// Recebe eventos do Evolution Go (CONNECTION, MESSAGE, SEND_MESSAGE, etc.)
// Sem autenticação JWT — validado pelo apikey header
router.post('/webhook', async (req, res) => {
  try {
    const { event, instance, data } = req.body || {};

    if (!event || !instance) {
      return res.status(400).json({ error: 'Missing event or instance' });
    }

    // Processar evento CONNECTION — atualiza estado da instância
    if (event === 'CONNECTION') {
      const connected = data?.connected ?? false;
      const jid = data?.jid || null;
      const disconnect_reason = data?.disconnect_reason || null;

      await pool.query(
        `INSERT INTO whatsapp_instances (name, connected, jid, disconnect_reason, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (name) DO UPDATE SET
           connected = EXCLUDED.connected,
           jid = EXCLUDED.jid,
           disconnect_reason = EXCLUDED.disconnect_reason,
           updated_at = NOW()`,
        [instance, connected, jid, disconnect_reason]
      );
    }

    // Processar eventos de MENSAGEM recebida
    if (event === 'MESSAGE') {
      const msg = data || {};
      const remoteJid = msg.key?.remoteJid || msg.remoteJid || null;
      const fromMe = msg.key?.fromMe ?? false;
      const messageId = msg.key?.id || null;
      const messageType = msg.messageType || msg.type || 'unknown';
      const content = msg.message || msg.body || null;
      const timestamp = msg.messageTimestamp
        ? new Date(msg.messageTimestamp * 1000)
        : new Date();

      if (messageId) {
        await pool.query(
          `INSERT INTO whatsapp_messages
             (instance_name, message_id, remote_jid, from_me, message_type, content, received_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (message_id) DO NOTHING`,
          [instance, messageId, remoteJid, fromMe, messageType, JSON.stringify(content), timestamp]
        );
      }
    }

    res.json({ status: 'ok', event, instance });
  } catch (err) {
    console.error('[whatsapp webhook]', err.message);
    // Sempre retornar 200 para o Evolution Go não fazer retry desnecessário
    res.json({ status: 'error', message: err.message });
  }
});

// ─── GET /api/whatsapp/instances ─────────────────────────────────────────────
// Lista instâncias registadas no CRM com estado de conexão
router.get('/instances', verifyToken, requireRole('admin'), async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT name, connected, jid, disconnect_reason, updated_at
       FROM whatsapp_instances
       ORDER BY updated_at DESC`
    );
    res.json({ data: result.rows });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/whatsapp/messages/:instance ────────────────────────────────────
// Lista mensagens recebidas de uma instância
router.get('/messages/:instance', verifyToken, requireRole('admin'), async (req, res, next) => {
  try {
    const { instance } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const result = await pool.query(
      `SELECT * FROM whatsapp_messages
       WHERE instance_name = $1
       ORDER BY received_at DESC
       LIMIT $2`,
      [instance, limit]
    );
    res.json({ data: result.rows });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/whatsapp/create-instance ──────────────────────────────────────
// Cria instância no Evolution Go e aplica o proxy automaticamente
// Aceita: JWT CRM admin  OU  x-internal-api-key (para Supabase Edge Functions)
function authCreateInstance(req, res, next) {
  const internalKey = req.headers['x-internal-api-key'];
  if (internalKey && internalKey === process.env.INTERNAL_API_KEY) return next();
  return verifyToken(req, res, () => requireRole('admin')(req, res, next));
}
router.post('/create-instance', authCreateInstance, async (req, res, next) => {
  try {
    const { name, webhook, events } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Missing instance name' });

    // 1. Criar instância no Evolution Go
    const createRes = await evoRequest('POST', '/instance/create', {
      name,
      webhook: webhook || null,
      events: events || 'MESSAGE,SEND_MESSAGE,CONNECTION,QRCODE',
    });

    if (createRes.status !== 200 && createRes.status !== 201) {
      return res.status(createRes.status).json({ error: 'Evolution Go error', detail: createRes.body });
    }

    const instanceId = createRes.body?.data?.id || createRes.body?.id;

    // 2. Aplicar proxy à nova instância
    if (instanceId) {
      const proxyRes = await evoRequest('POST', `/instance/proxy/${instanceId}`, PROXY_CONFIG);
      console.log(`[whatsapp] proxy set for ${name} (${instanceId}): ${proxyRes.status}`);
    }

    res.json({ data: createRes.body, proxy_applied: !!instanceId });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/whatsapp/instances/:id/proxy ───────────────────────────────────
// Aplica proxy padrão a uma instância existente (por ID Evolution Go)
router.post('/instances/:id/proxy', verifyToken, requireRole('admin'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const proxyRes = await evoRequest('POST', `/instance/proxy/${id}`, PROXY_CONFIG);
    if (proxyRes.status !== 200) {
      return res.status(proxyRes.status).json({ error: 'Evolution Go proxy error', detail: proxyRes.body });
    }
    res.json({ success: true, proxy: proxyRes.body });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
