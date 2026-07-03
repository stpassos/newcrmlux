const express = require('express');
const http = require('http');
const https = require('https');
const zlib = require('zlib');

const router = express.Router();

// ─── Proxy config (DataImpulse — mesmo usado pelo Evolution Go) ───────────────
const PROXY_HOST = process.env.WA_PROXY_HOST || 'gw.dataimpulse.com';
const PROXY_PORT = parseInt(process.env.WA_PROXY_PORT || '10000', 10);
const PROXY_USER = process.env.WA_PROXY_USERNAME || '';
const PROXY_PASS = process.env.WA_PROXY_PASSWORD || '';

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'pt-PT,pt;q=0.9,en-GB;q=0.8,en;q=0.7',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'max-age=0',
  'Sec-Ch-Ua': '"Google Chrome";v="125", "Chromium";v="125", "Not.A/Brand";v="24"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
};

// ─── HTTP CONNECT tunnel + HTTPS request through DataImpulse proxy ────────────
function proxyFetch(targetUrl, { cookieHeader, referer } = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(targetUrl); } catch (e) { return reject(e); }

    const targetHost = parsed.hostname;
    const targetPort = parsed.port ? parseInt(parsed.port, 10) : (parsed.protocol === 'https:' ? 443 : 80);
    const proxyAuth = Buffer.from(`${PROXY_USER}:${PROXY_PASS}`).toString('base64');

    const connectReq = http.request({
      host: PROXY_HOST,
      port: PROXY_PORT,
      method: 'CONNECT',
      path: `${targetHost}:${targetPort}`,
      headers: {
        'Host': `${targetHost}:${targetPort}`,
        'Proxy-Authorization': `Basic ${proxyAuth}`,
        'Proxy-Connection': 'Keep-Alive',
      },
    });

    const timeout = setTimeout(() => {
      connectReq.destroy();
      reject(new Error('Proxy CONNECT timeout (30s)'));
    }, 30000);

    connectReq.on('connect', (res, socket) => {
      clearTimeout(timeout);
      if (res.statusCode !== 200) {
        socket.destroy();
        return reject(new Error(`Proxy CONNECT failed: ${res.statusCode}`));
      }

      const reqHeaders = {
        ...BROWSER_HEADERS,
        'Host': targetHost,
      };
      if (cookieHeader) reqHeaders['Cookie'] = cookieHeader;
      if (referer) {
        reqHeaders['Referer'] = referer;
        reqHeaders['Sec-Fetch-Site'] = 'same-origin';
        reqHeaders['Sec-Fetch-Mode'] = 'cors';
        reqHeaders['Sec-Fetch-Dest'] = 'empty';
        delete reqHeaders['Sec-Fetch-User'];
        delete reqHeaders['Upgrade-Insecure-Requests'];
      }

      const req = https.request({
        host: targetHost,
        port: targetPort,
        path: parsed.pathname + (parsed.search || ''),
        method: 'GET',
        socket,
        agent: false,
        headers: reqHeaders,
      }, (innerRes) => {
        const chunks = [];
        let stream = innerRes;
        const enc = (innerRes.headers['content-encoding'] || '').toLowerCase();
        if (enc === 'gzip') stream = innerRes.pipe(zlib.createGunzip());
        else if (enc === 'br') stream = innerRes.pipe(zlib.createBrotliDecompress());
        else if (enc === 'deflate') stream = innerRes.pipe(zlib.createInflate());

        stream.on('data', c => chunks.push(c));
        stream.on('end', () => {
          const setCookie = innerRes.headers['set-cookie'];
          const cookies = Array.isArray(setCookie)
            ? setCookie.map(c => c.split(';')[0]).join('; ')
            : (setCookie ? setCookie.split(';')[0] : '');
          resolve({
            statusCode: innerRes.statusCode,
            html: Buffer.concat(chunks).toString('utf-8'),
            cookies,
          });
        });
        stream.on('error', reject);
      });

      req.on('error', reject);
      req.end();
    });

    connectReq.on('error', (e) => { clearTimeout(timeout); reject(e); });
    connectReq.end();
  });
}

// ─── Auth middleware (internal key only) ─────────────────────────────────────
function authInternal(req, res, next) {
  const key = req.headers['x-internal-api-key'];
  if (key && key === process.env.INTERNAL_API_KEY) return next();
  return res.status(401).json({ error: 'Unauthorized' });
}

// ─── POST /api/scrape/proxy-fetch ─────────────────────────────────────────────
// Faz fetch de uma URL através do proxy DataImpulse (IP residencial PT)
// Body: { url: string, cookies?: string, referer?: string }
// Returns: { html, statusCode, cookies }
router.post('/proxy-fetch', authInternal, async (req, res, next) => {
  try {
    const { url, cookies, referer } = req.body || {};
    if (!url) return res.status(400).json({ error: 'Missing url' });

    console.log(`[scrape] proxy-fetch ${url}`);
    const result = await proxyFetch(url, { cookieHeader: cookies, referer });
    console.log(`[scrape] proxy-fetch status=${result.statusCode} html=${result.html.length}b`);

    res.json(result);
  } catch (err) {
    console.error('[scrape] proxy-fetch error:', err.message);
    next(err);
  }
});

module.exports = router;
