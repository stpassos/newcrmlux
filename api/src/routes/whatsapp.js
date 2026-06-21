const express = require('express');
const pool = require('../db/pool');
const { verifyToken, requireRole } = require('../middleware/auth');

const router = express.Router();

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

module.exports = router;
