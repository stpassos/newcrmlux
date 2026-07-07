'use strict';
const pool = require('../db/pool');

const SMS_URL  = process.env.SMS_GATEWAY_URL  || 'https://sms.century21lux.pt/api/3rdparty/v1';
const SMS_USER = process.env.SMS_GATEWAY_USER || '';
const SMS_PASS = process.env.SMS_GATEWAY_PASS || '';

async function sendSms(phoneNumber, text) {
  if (!SMS_USER || !SMS_PASS) throw new Error('SMS gateway credentials not configured');
  const auth = Buffer.from(`${SMS_USER}:${SMS_PASS}`).toString('base64');
  const res = await fetch(`${SMS_URL}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify({ phoneNumbers: [phoneNumber], textMessage: { text } }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`SMS error ${res.status}: ${body}`);
  }
  return res.json();
}

async function getConfig() {
  const { rows } = await pool.query('SELECT * FROM notification_config LIMIT 1');
  return rows[0] || null;
}

async function isOnCooldown(type, cooldownMinutes) {
  const { rows } = await pool.query(
    `SELECT 1 FROM notification_log
     WHERE type = $1 AND success = true
     AND sent_at > now() - ($2 || ' minutes')::interval
     LIMIT 1`,
    [type, cooldownMinutes]
  );
  return rows.length > 0;
}

async function logNotification(type, details, phoneNumber, success, errorMsg) {
  await pool.query(
    `INSERT INTO notification_log (type, details, phone_number, success, error_msg)
     VALUES ($1, $2, $3, $4, $5)`,
    [type, details, phoneNumber, success, errorMsg || null]
  );
}

function formatMessage(template, vars) {
  return template.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? vars[k] : `{${k}}`));
}

async function checkAndNotify(serverMetrics) {
  try {
    const config = await getConfig();
    if (!config || !config.enabled || !config.phone_number) return;

    const { phone_number, cooldown_minutes = 15 } = config;

    // ── CPU ──────────────────────────────────────────────────────────────────
    if (config.cpu_threshold != null && serverMetrics.cpu_pct >= config.cpu_threshold) {
      if (!(await isOnCooldown('cpu', cooldown_minutes))) {
        const text = formatMessage(config.cpu_message, {
          value: Math.round(serverMetrics.cpu_pct),
          threshold: config.cpu_threshold,
        });
        try {
          await sendSms(phone_number, text);
          await logNotification('cpu', `CPU ${Math.round(serverMetrics.cpu_pct)}%`, phone_number, true, null);
        } catch (e) {
          await logNotification('cpu', `CPU ${Math.round(serverMetrics.cpu_pct)}%`, phone_number, false, e.message);
        }
      }
    }

    // ── RAM ──────────────────────────────────────────────────────────────────
    if (config.ram_threshold != null && serverMetrics.ram_total_mb > 0) {
      const ramPct = (serverMetrics.ram_used_mb / serverMetrics.ram_total_mb) * 100;
      if (ramPct >= config.ram_threshold) {
        if (!(await isOnCooldown('ram', cooldown_minutes))) {
          const text = formatMessage(config.ram_message, {
            value: Math.round(ramPct),
            threshold: config.ram_threshold,
          });
          try {
            await sendSms(phone_number, text);
            await logNotification('ram', `RAM ${Math.round(ramPct)}%`, phone_number, true, null);
          } catch (e) {
            await logNotification('ram', `RAM ${Math.round(ramPct)}%`, phone_number, false, e.message);
          }
        }
      }
    }

    // ── Disk ─────────────────────────────────────────────────────────────────
    if (config.disk_threshold != null && serverMetrics.disk_total_gb > 0) {
      const diskPct = (serverMetrics.disk_used_gb / serverMetrics.disk_total_gb) * 100;
      if (diskPct >= config.disk_threshold) {
        if (!(await isOnCooldown('disk', cooldown_minutes))) {
          const text = formatMessage(config.disk_message, {
            value: Math.round(diskPct),
            threshold: config.disk_threshold,
          });
          try {
            await sendSms(phone_number, text);
            await logNotification('disk', `Disco ${Math.round(diskPct)}%`, phone_number, true, null);
          } catch (e) {
            await logNotification('disk', `Disco ${Math.round(diskPct)}%`, phone_number, false, e.message);
          }
        }
      }
    }

    // ── Job failures / cancellations ─────────────────────────────────────────
    const monitoredEndpoints = config.monitored_endpoints || [];
    if (monitoredEndpoints.length > 0) {
      const lookbackMin = Math.max(cooldown_minutes * 2, 30);
      const { rows: failedJobs } = await pool.query(
        `SELECT j.id, j.entity, j.workspace_name, j.status, j.error_msg,
                e.endpoint_name
         FROM c21_pipeline_jobs j
         LEFT JOIN c21_pipeline_endpoints e ON e.id = j.endpoint_id
         WHERE j.status IN ('error', 'cancelled')
           AND j.finished_at > now() - ($1 || ' minutes')::interval
           AND e.endpoint_name = ANY($2::text[])
         ORDER BY j.finished_at DESC
         LIMIT 20`,
        [lookbackMin, monitoredEndpoints]
      );

      for (const job of failedJobs) {
        // Each job is only notified once — key by job id
        const { rows: alreadySent } = await pool.query(
          `SELECT 1 FROM notification_log WHERE details LIKE $1 LIMIT 1`,
          [`%job:${job.id}%`]
        );
        if (alreadySent.length > 0) continue;

        const isError = job.status === 'error';
        const template = isError ? config.job_fail_message : config.job_cancel_message;
        const text = formatMessage(template, {
          endpoint: job.endpoint_name || job.entity || 'N/A',
          workspace: job.workspace_name || 'N/A',
          error: job.error_msg ? job.error_msg.slice(0, 100) : '',
        });

        try {
          await sendSms(phone_number, text);
          await logNotification(
            isError ? 'job_fail' : 'job_cancel',
            `job:${job.id} endpoint:${job.endpoint_name || job.entity}`,
            phone_number, true, null
          );
        } catch (e) {
          await logNotification(
            isError ? 'job_fail' : 'job_cancel',
            `job:${job.id} endpoint:${job.endpoint_name || job.entity}`,
            phone_number, false, e.message
          );
        }
      }
    }
  } catch (err) {
    console.error('[notifications] checkAndNotify error:', err.message);
  }
}

module.exports = { sendSms, checkAndNotify, logNotification };
