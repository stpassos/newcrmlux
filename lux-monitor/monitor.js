/**
 * LUX Server Monitor Agent
 * Corre no VPS-LUX (173.249.49.92) via PM2.
 * Recolhe métricas do sistema a cada 15s e envia para a API.
 *
 * Instalar:
 *   mkdir -p /opt/lux-monitor && cp monitor.js /opt/lux-monitor/
 *   pm2 start /opt/lux-monitor/monitor.js --name lux-monitor
 *   pm2 save
 */

'use strict';

const os    = require('os');
const fs    = require('fs');
const https = require('https');
const http  = require('http');
const { execSync } = require('child_process');

const API_HOST    = 'imodigital.pt';
const API_PATH    = '/api/server-monitor/ingest';
const MONITOR_KEY = process.env.MONITOR_KEY || '4261486c6c977ed56598f47831e0d777199e0ead54e996a0948b2a5815a9c5f5';
const INTERVAL_MS = 15000;
const SERVER_IP   = '173.249.49.92';

// Worker endpoints to check for active jobs
const WORKERS = [
  { name: 'WorkerLux-1', port: 8080, key: process.env.WLUX1_KEY || 'wlux1_a9f3e2c1b4d8f7a6e5c3b2d1f0e9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2' },
  { name: 'WorkerLux-2', port: 8081, key: process.env.WLUX2_KEY || 'wlux2_b8e4d3c2a1f0e9d8c7b6a5f4e3d2c1b0a9f8e7d6c5b4a3f2e1d0c9b8a7f6e5' },
];

// ─── System metrics ───────────────────────────────────────────────────────────

function readCpuTicks() {
  try {
    const line = fs.readFileSync('/proc/stat', 'utf8').split('\n')[0];
    const parts = line.split(/\s+/).slice(1).map(Number);
    const idle  = parts[3] + (parts[4] || 0);
    const total = parts.reduce((a, b) => a + b, 0);
    return { total, idle };
  } catch {
    return { total: 1, idle: 0 };
  }
}

function readNetBytes() {
  try {
    const lines = fs.readFileSync('/proc/net/dev', 'utf8').trim().split('\n').slice(2);
    let rxTotal = 0, txTotal = 0;
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      const iface = parts[0].replace(':', '');
      if (iface === 'lo') continue;
      rxTotal += parseInt(parts[1])  || 0;
      txTotal += parseInt(parts[9])  || 0;
    }
    return { rx: rxTotal, tx: txTotal };
  } catch {
    return { rx: 0, tx: 0 };
  }
}

function getDiskUsage() {
  try {
    const out   = execSync('df -BG / 2>/dev/null', { encoding: 'utf8', timeout: 3000 });
    const parts = out.trim().split('\n')[1].split(/\s+/);
    return {
      used_gb:  parseFloat(parts[2]) || 0,
      total_gb: parseFloat(parts[1]) || 0,
    };
  } catch {
    return { used_gb: 0, total_gb: 0 };
  }
}

// ─── PM2 worker metrics ───────────────────────────────────────────────────────

function getPm2Workers() {
  try {
    const out  = execSync('pm2 jlist 2>/dev/null', { encoding: 'utf8', timeout: 5000 });
    const list = JSON.parse(out);
    return list.map(w => ({
      name:      w.name || '',
      status:    w.pm2_env?.status || 'unknown',
      pid:       w.pid || null,
      cpu_pct:   w.monit?.cpu     || 0,
      ram_mb:    Math.round((w.monit?.memory || 0) / 1024 / 1024),
      restarts:  w.pm2_env?.restart_time || 0,
      uptime_ms: w.pm2_env?.pm_uptime ? Math.max(0, Date.now() - w.pm2_env.pm_uptime) : 0,
      active_jobs: 0,  // filled in below
    }));
  } catch {
    return [];
  }
}

// ─── Active jobs per worker ───────────────────────────────────────────────────

function getActiveJobsForWorker(port, key) {
  return new Promise(resolve => {
    const req = http.get(
      { hostname: 'localhost', port, path: '/api/21online/backfill-status',
        headers: { 'x-internal-api-key': key }, timeout: 3000 },
      res => {
        let body = '';
        res.on('data', d => { body += d; });
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            resolve(data.active ? 1 : 0);
          } catch {
            resolve(0);
          }
        });
      }
    );
    req.on('error', () => resolve(0));
    req.on('timeout', () => { req.destroy(); resolve(0); });
  });
}

// ─── POST to API ──────────────────────────────────────────────────────────────

function postMetrics(payload) {
  return new Promise(resolve => {
    const body = JSON.stringify(payload);
    const opts = {
      hostname: API_HOST,
      path:     API_PATH,
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
        'x-monitor-key':  MONITOR_KEY,
      },
      timeout: 10000,
    };

    const req = https.request(opts, res => {
      res.resume();
      if (res.statusCode !== 200) {
        console.error(`[monitor] API returned ${res.statusCode}`);
      }
      resolve();
    });

    req.on('error',   err => { console.error(`[monitor] POST error: ${err.message}`); resolve(); });
    req.on('timeout', ()  => { req.destroy(); console.error('[monitor] POST timeout'); resolve(); });

    req.write(body);
    req.end();
  });
}

// ─── Main collection loop ─────────────────────────────────────────────────────

let prevCpuTicks = null;
let prevNetBytes = null;
let prevNetTime  = null;

async function collect() {
  // CPU — sample over ~1s
  const cpu1 = readCpuTicks();
  await new Promise(r => setTimeout(r, 1000));
  const cpu2 = readCpuTicks();

  const cpuTotalDiff = cpu2.total - cpu1.total;
  const cpuIdleDiff  = cpu2.idle  - cpu1.idle;
  const cpuPct = cpuTotalDiff > 0
    ? Math.round((1 - cpuIdleDiff / cpuTotalDiff) * 1000) / 10
    : 0;

  // RAM
  const totalMem = os.totalmem();
  const freeMem  = os.freemem();
  const usedMem  = totalMem - freeMem;

  // Disk
  const disk = getDiskUsage();

  // Network delta
  const netNow  = readNetBytes();
  const netNowT = Date.now();
  let netRxKbps = 0, netTxKbps = 0;
  if (prevNetBytes && prevNetTime) {
    const dtSec = (netNowT - prevNetTime) / 1000;
    if (dtSec > 0) {
      netRxKbps = Math.max(0, (netNow.rx - prevNetBytes.rx) / dtSec / 1024);
      netTxKbps = Math.max(0, (netNow.tx - prevNetBytes.tx) / dtSec / 1024);
    }
  }
  prevNetBytes = netNow;
  prevNetTime  = netNowT;

  // Load average
  const load = os.loadavg();

  // PM2 workers
  const pm2Workers = getPm2Workers();

  // Active jobs per worker
  for (const wDef of WORKERS) {
    const pm2W = pm2Workers.find(w => w.name === wDef.name);
    if (pm2W) {
      pm2W.active_jobs = await getActiveJobsForWorker(wDef.port, wDef.key);
    }
  }

  const payload = {
    timestamp: new Date().toISOString(),
    server: {
      ip:           SERVER_IP,
      cpu_pct:      cpuPct,
      ram_used_mb:  Math.round(usedMem  / 1024 / 1024),
      ram_total_mb: Math.round(totalMem / 1024 / 1024),
      disk_used_gb:  disk.used_gb,
      disk_total_gb: disk.total_gb,
      net_rx_kbps:  Math.round(netRxKbps * 10) / 10,
      net_tx_kbps:  Math.round(netTxKbps * 10) / 10,
      load_1: Math.round(load[0] * 100) / 100,
      load_5: Math.round(load[1] * 100) / 100,
    },
    workers: pm2Workers,
    jobs: [],  // job events sent separately via callback endpoint
  };

  await postMetrics(payload);

  console.log(
    `[monitor] cpu=${cpuPct}% ram=${Math.round(usedMem/1024/1024)}MB` +
    ` disk=${disk.used_gb}/${disk.total_gb}GB` +
    ` rx=${netRxKbps.toFixed(1)}KB/s tx=${netTxKbps.toFixed(1)}KB/s` +
    ` workers=${pm2Workers.length}`
  );
}

async function run() {
  console.log(`[monitor] LUX Monitor started — reporting to https://${API_HOST}${API_PATH}`);
  console.log(`[monitor] Interval: ${INTERVAL_MS / 1000}s`);

  while (true) {
    try {
      await collect();
    } catch (err) {
      console.error(`[monitor] Collect error: ${err.message}`);
    }
    // subtract 1s (CPU sample time) from interval
    await new Promise(r => setTimeout(r, INTERVAL_MS - 1000));
  }
}

run();
