'use strict';

const express  = require('express');
const crypto   = require('crypto');
const pool     = require('../db/pool');
const { verifyToken, requireRole } = require('../middleware/auth');
const https    = require('https');
const http     = require('http');

const router = express.Router();

// ─── Evolution Go config ──────────────────────────────────────────────────────
const EVO_BASE_URL = process.env.EVOLUTION_GO_URL || 'https://lux.webflix.pt';
const EVO_API_KEY  = process.env.EVOLUTION_GO_API_KEY || '';
const PROXY_CONFIG = {
  host:     process.env.WA_PROXY_HOST     || 'gw.dataimpulse.com',
  port:     process.env.WA_PROXY_PORT     || '10000',
  username: process.env.WA_PROXY_USERNAME || '',
  password: process.env.WA_PROXY_PASSWORD || '',
  protocol: process.env.WA_PROXY_PROTOCOL || 'http',
};

// apiKey defaults to global key; pass instance token for instance-scoped endpoints
function evoRequest(method, path, body, apiKey) {
  return new Promise((resolve, reject) => {
    const key = apiKey || EVO_API_KEY;
    const url = new URL(EVO_BASE_URL + path);
    const lib = url.protocol === 'https:' ? https : http;
    const payload = body ? JSON.stringify(body) : null;
    const req = lib.request({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname,
      method,
      headers: {
        'apikey': key,
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

// Generate deterministic instance token from name + secret
function generateInstanceToken(name) {
  const secret = process.env.INTERNAL_API_KEY || 'crmlux_secret';
  const sanitized = name.replace(/-/g, '_');
  const hash = crypto.createHmac('md5', secret).update(name).digest('hex');
  return `${sanitized}_${hash}`;
}

// ─── POST /api/whatsapp/webhook ──────────────────────────────────────────────
// Recebe eventos do Evolution Go (CONNECTION, MESSAGE, QRCODE, etc.)
// Sem autenticacao JWT — chamado directamente pelo Evolution Go
router.post('/webhook', async (req, res) => {
  try {
    const body     = req.body || {};
    const event    = body.event    || body.eventType || null;
    const instance = body.instance || body.instanceId || null;
    const data     = body.data     || null;

    if (!event || !instance) {
      return res.status(400).json({ error: 'Missing event or instance' });
    }

    // Processar evento CONNECTION
    if (event === 'CONNECTION') {
      const connected         = data?.connected ?? false;
      const jid               = data?.jid || null;
      const disconnect_reason = data?.disconnect_reason || null;

      await pool.query(
        `INSERT INTO whatsapp_instances (name, connected, jid, disconnect_reason, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (name) DO UPDATE SET
           connected         = EXCLUDED.connected,
           jid               = EXCLUDED.jid,
           disconnect_reason = EXCLUDED.disconnect_reason,
           qrcode            = CASE WHEN EXCLUDED.connected THEN NULL ELSE whatsapp_instances.qrcode END,
           updated_at        = NOW()`,
        [instance, connected, jid, disconnect_reason]
      );

      // Sincronizar connection_status no Supabase
      const receiverUrl = process.env.SUPABASE_RECEIVER_URL;
      const receiverKey = process.env.SUPABASE_RECEIVER_KEY;
      if (receiverUrl && receiverKey) {
        fetch(receiverUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': receiverKey },
          body: JSON.stringify({ entity: 'whatsapp_connection', instance, connected }),
        }).catch(err => console.warn('[whatsapp:connection-sync]', err.message));
      }
    }

    // Processar evento QRCODE — guarda QR para o portal buscar via polling
    if (event === 'QRCODE') {
      const qrcode = data?.qrcode || data?.Qrcode || data?.base64 || null;
      if (qrcode) {
        await pool.query(
          `INSERT INTO whatsapp_instances (name, connected, qrcode, updated_at)
           VALUES ($1, false, $2, NOW())
           ON CONFLICT (name) DO UPDATE SET
             qrcode     = EXCLUDED.qrcode,
             connected  = false,
             updated_at = NOW()`,
          [instance, qrcode]
        );
        console.log(`[whatsapp] QR code saved for instance: ${instance}`);
      }
    }

    // Processar evento MESSAGE
    if (event === 'MESSAGE') {
      const msg         = data || {};
      const remoteJid   = msg.key?.remoteJid || msg.remoteJid || null;
      const fromMe      = msg.key?.fromMe ?? false;
      const messageId   = msg.key?.id || null;
      const messageType = msg.messageType || msg.type || 'unknown';
      const content     = msg.message || msg.body || null;
      const timestamp   = msg.messageTimestamp
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
    res.json({ status: 'error', message: err.message });
  }
});

// ─── GET /api/whatsapp/instances ─────────────────────────────────────────────
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

// ─── GET /api/whatsapp/status/:name ──────────────────────────────────────────
// Polling endpoint para o portal: retorna connected + qrcode
// Auth: JWT qualquer utilizador OU x-internal-api-key
function authPortal(req, res, next) {
  const internalKey = req.headers['x-internal-api-key'];
  if (internalKey && internalKey === process.env.INTERNAL_API_KEY) return next();
  return verifyToken(req, res, () => next());
}
router.get('/status/:name', authPortal, async (req, res, next) => {
  try {
    const { name } = req.params;

    // Usar token da DB se disponível (instâncias criadas manualmente ou pré-existentes),
    // caso contrário gerar via HMAC (instâncias criadas pelo create-instance)
    const dbRow = await pool.query(`SELECT token, qrcode FROM whatsapp_instances WHERE name = $1`, [name]);
    const token = dbRow.rows[0]?.token || generateInstanceToken(name);

    // Estado actual do Evolution Go
    const evoStatus = await evoRequest('GET', '/instance/status', null, token).catch(() => null);
    const connected = evoStatus?.body?.data?.Connected ?? false;
    const loggedIn  = evoStatus?.body?.data?.LoggedIn  ?? false;

    let qrcode = null;
    if (!connected || !loggedIn) {
      // Tentar QR directo do Evolution Go
      const evoQr = await evoRequest('GET', '/instance/qr', null, token).catch(() => null);
      qrcode = evoQr?.body?.data?.Qrcode || null;

      // Fallback: QR guardado pelo webhook
      if (!qrcode) {
        qrcode = dbRow.rows[0]?.qrcode || null;
      }
    }

    res.json({ name, connected, logged_in: loggedIn, qrcode });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/whatsapp/messages/:instance ────────────────────────────────────
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
// Auth: JWT admin OU x-internal-api-key (Supabase Edge Functions)
function authCreateInstance(req, res, next) {
  const internalKey = req.headers['x-internal-api-key'];
  if (internalKey && internalKey === process.env.INTERNAL_API_KEY) return next();
  return verifyToken(req, res, () => requireRole('admin')(req, res, next));
}
router.post('/create-instance', authCreateInstance, async (req, res, next) => {
  try {
    const { name, webhook, events } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Missing instance name' });

    // Token determinístico baseado no nome da instância
    const token = generateInstanceToken(name);

    // Verificar se a instância já existe no Evolution Go
    const existingStatus = await evoRequest('GET', '/instance/status', null, token).catch(() => null);
    const alreadyExists  = existingStatus?.status === 200;

    let createBody = null;
    let instanceId = null;
    if (!alreadyExists) {
      // Criar instância — token obrigatório no body para Evolution Go
      const createRes = await evoRequest('POST', '/instance/create', {
        name,
        token,
        webhook: webhook || null,
        events:  events  || 'MESSAGE,SEND_MESSAGE,CONNECTION,QRCODE',
      });

      if (createRes.status !== 200 && createRes.status !== 201) {
        return res.status(createRes.status).json({ error: 'Evolution Go error', detail: createRes.body });
      }

      createBody = createRes.body;
      instanceId = createRes.body?.data?.id || createRes.body?.id;
    }

    // Para instâncias já existentes, obter o ID via listagem global
    if (!instanceId) {
      const listRes = await evoRequest('GET', '/instance/all', null).catch(() => null);
      const list = listRes?.body?.data || [];
      const found = list.find(i => i.name === name);
      instanceId = found?.id || null;
    }

    // Aplicar proxy DataImpulse sempre (idempotente)
    if (instanceId) {
      const proxyRes = await evoRequest('POST', `/instance/proxy/${instanceId}`, PROXY_CONFIG);
      console.log(`[whatsapp] proxy set for ${name} (${instanceId}): ${proxyRes.status}`);
    }

    // Registar/actualizar token na DB local
    await pool.query(
      `INSERT INTO whatsapp_instances (name, token, connected, updated_at)
       VALUES ($1, $2, false, NOW())
       ON CONFLICT (name) DO UPDATE SET
         token      = EXCLUDED.token,
         updated_at = NOW()`,
      [name, token]
    );

    res.json({
      data:           createBody,
      already_existed: alreadyExists,
      token,
      proxy_applied:  !alreadyExists,
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/whatsapp/instances/:id/proxy ───────────────────────────────────
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
