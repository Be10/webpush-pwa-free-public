const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const STORE = path.join(DATA_DIR, 'subscriptions.json');

function loadEnv(file = path.join(ROOT, '.env')) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx < 1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadEnv();

const PORT = Number(process.env.PORT || 3000);
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const USE_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_SECRET_KEY);

const missing = [
  ['VAPID_PUBLIC_KEY', VAPID_PUBLIC_KEY],
  ['VAPID_PRIVATE_KEY', VAPID_PRIVATE_KEY],
  ['ADMIN_TOKEN', ADMIN_TOKEN]
].filter(([, value]) => !value).map(([key]) => key);

if (missing.length) {
  console.error(`Falta configuracion: ${missing.join(', ')}`);
  console.error('Ejecuta primero: npm run setup');
  process.exit(1);
}

fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(STORE)) fs.writeFileSync(STORE, '[]\n');

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const fromB64url = (value) => Buffer.from(String(value), 'base64url');
const clean = (value, max) => String(value || '').trim().slice(0, max);

function readLocalStore() {
  try { return JSON.parse(fs.readFileSync(STORE, 'utf8')); }
  catch { return []; }
}
function writeLocalStore(items) {
  const temp = `${STORE}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(items, null, 2)}\n`);
  fs.renameSync(temp, STORE);
}

async function supabaseRequest(pathname, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${pathname}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SECRET_KEY,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  if (!response.ok) {
    const error = new Error(`Supabase HTTP ${response.status}: ${text || response.statusText}`);
    error.status = 502;
    throw error;
  }
  return text ? JSON.parse(text) : null;
}

function dbToRecord(row) {
  return {
    id: row.id,
    deviceName: row.device_name,
    subscription: row.subscription,
    userAgent: row.user_agent || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function readStore() {
  if (!USE_SUPABASE) return readLocalStore();
  const rows = await supabaseRequest('push_subscriptions?select=*&order=created_at.asc');
  return (rows || []).map(dbToRecord);
}

async function saveRecord(record) {
  if (!USE_SUPABASE) {
    const items = readLocalStore();
    const index = items.findIndex((item) => item.subscription.endpoint === record.subscription.endpoint);
    if (index >= 0) items[index] = record; else items.push(record);
    writeLocalStore(items);
    return;
  }
  await supabaseRequest('push_subscriptions?on_conflict=endpoint', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      id: record.id,
      endpoint: record.subscription.endpoint,
      device_name: record.deviceName,
      subscription: record.subscription,
      user_agent: record.userAgent,
      created_at: record.createdAt,
      updated_at: record.updatedAt
    })
  });
}

async function removeByEndpoint(endpoint) {
  if (!USE_SUPABASE) {
    const items = readLocalStore();
    const next = items.filter((item) => item.subscription.endpoint !== endpoint);
    writeLocalStore(next);
    return items.length - next.length;
  }
  const rows = await supabaseRequest(`push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}&select=id`, {
    method: 'DELETE',
    headers: { Prefer: 'return=representation' }
  });
  return Array.isArray(rows) ? rows.length : 0;
}

async function removeByIds(ids) {
  if (!ids.size) return;
  if (!USE_SUPABASE) {
    const items = readLocalStore().filter((item) => !ids.has(item.id));
    writeLocalStore(items);
    return;
  }
  await Promise.all([...ids].map((id) =>
    supabaseRequest(`push_subscriptions?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' })
  ));
}

function json(res, status, body) {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': data.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(), camera=(), microphone=()'
  });
  res.end(data);
}

async function readJson(req, limit = 64 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('Payload demasiado grande.'), { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('JSON invalido.'), { status: 400 }); }
}

function isAdmin(req) {
  const supplied = Buffer.from(req.headers['x-admin-token'] || '');
  const expected = Buffer.from(ADMIN_TOKEN);
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

function hkdfExtract(salt, ikm) {
  return crypto.createHmac('sha256', salt).update(ikm).digest();
}
function hkdfExpand(prk, info, length) {
  const blocks = [];
  let previous = Buffer.alloc(0);
  for (let i = 1; Buffer.concat(blocks).length < length; i++) {
    previous = crypto.createHmac('sha256', prk)
      .update(Buffer.concat([previous, info, Buffer.from([i])]))
      .digest();
    blocks.push(previous);
  }
  return Buffer.concat(blocks).subarray(0, length);
}

function vapidKeyObject() {
  const pub = fromB64url(VAPID_PUBLIC_KEY);
  const priv = fromB64url(VAPID_PRIVATE_KEY);
  if (pub.length !== 65 || pub[0] !== 4 || priv.length !== 32) {
    throw new Error('Claves VAPID invalidas. Regenera .env con npm run setup.');
  }
  return crypto.createPrivateKey({
    key: {
      kty: 'EC', crv: 'P-256',
      x: b64url(pub.subarray(1, 33)),
      y: b64url(pub.subarray(33, 65)),
      d: b64url(priv)
    },
    format: 'jwk'
  });
}

function createVapidAuthorization(endpoint) {
  const audience = new URL(endpoint).origin;
  const header = b64url(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = b64url(Buffer.from(JSON.stringify({
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: VAPID_SUBJECT
  })));
  const unsigned = `${header}.${payload}`;
  const signature = crypto.sign('sha256', Buffer.from(unsigned), {
    key: vapidKeyObject(),
    dsaEncoding: 'ieee-p1363'
  });
  return `vapid t=${unsigned}.${b64url(signature)}, k=${VAPID_PUBLIC_KEY}`;
}

function encryptPayload(subscription, payloadText) {
  const userPublic = fromB64url(subscription.keys.p256dh);
  const authSecret = fromB64url(subscription.keys.auth);
  if (userPublic.length !== 65 || userPublic[0] !== 4 || authSecret.length < 16) {
    throw new Error('Claves de suscripcion invalidas.');
  }

  const local = crypto.createECDH('prime256v1');
  const serverPublic = local.generateKeys();
  const sharedSecret = local.computeSecret(userPublic);

  const prkKey = hkdfExtract(authSecret, sharedSecret);
  const keyInfo = Buffer.concat([
    Buffer.from('WebPush: info\0', 'utf8'),
    userPublic,
    serverPublic
  ]);
  const ikm = hkdfExpand(prkKey, keyInfo, 32);

  const salt = crypto.randomBytes(16);
  const prk = hkdfExtract(salt, ikm);
  const cek = hkdfExpand(prk, Buffer.from('Content-Encoding: aes128gcm\0', 'utf8'), 16);
  const nonce = hkdfExpand(prk, Buffer.from('Content-Encoding: nonce\0', 'utf8'), 12);

  const plaintext = Buffer.concat([Buffer.from(payloadText, 'utf8'), Buffer.from([2])]);
  const rs = Math.max(4096, plaintext.length + 17);
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);

  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(rs, 16);
  header[20] = serverPublic.length;

  return Buffer.concat([header, serverPublic, encrypted]);
}

function sendWebPush(subscription, payload) {
  return new Promise((resolve, reject) => {
    const endpoint = new URL(subscription.endpoint);
    const body = encryptPayload(subscription, payload);
    const req = https.request({
      protocol: endpoint.protocol,
      hostname: endpoint.hostname,
      port: endpoint.port || 443,
      path: `${endpoint.pathname}${endpoint.search}`,
      method: 'POST',
      headers: {
        TTL: '3600',
        Urgency: 'normal',
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        'Content-Length': body.length,
        Authorization: createVapidAuthorization(subscription.endpoint)
      },
      timeout: 15000
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const responseBody = Buffer.concat(chunks).toString('utf8');
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve({ statusCode: response.statusCode, body: responseBody });
        } else {
          const err = new Error(responseBody || `Push service HTTP ${response.statusCode}`);
          err.statusCode = response.statusCode;
          reject(err);
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('Timeout al contactar el servicio Push.')));
    req.on('error', reject);
    req.end(body);
  });
}

async function handleApi(req, res, pathname) {
  if (req.method === 'GET' && pathname === '/api/config') {
    return json(res, 200, { publicVapidKey: VAPID_PUBLIC_KEY });
  }

  if (req.method === 'POST' && pathname === '/api/subscribe') {
    const body = await readJson(req);
    const sub = body.subscription;
    if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth || !/^https:\/\//i.test(sub.endpoint)) {
      return json(res, 400, { error: 'Suscripcion push invalida.' });
    }
    const items = await readStore();
    const deviceName = clean(body.deviceName, 60) || 'Dispositivo sin nombre';
    const userAgent = clean(req.headers['user-agent'], 300);
    const existing = items.find((item) => item.subscription.endpoint === sub.endpoint);
    if (existing) {
      existing.deviceName = deviceName;
      existing.subscription = sub;
      existing.userAgent = userAgent;
      existing.updatedAt = new Date().toISOString();
      await saveRecord(existing);
      return json(res, 200, { id: existing.id, deviceName, updated: true });
    }
    const record = {
      id: crypto.randomUUID(), deviceName, subscription: sub, userAgent,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    };
    await saveRecord(record);
    return json(res, 201, { id: record.id, deviceName, created: true });
  }

  if (req.method === 'POST' && pathname === '/api/unsubscribe') {
    const body = await readJson(req);
    const endpoint = String(body.endpoint || '');
    if (!endpoint) return json(res, 400, { error: 'Endpoint requerido.' });
    const items = await readStore();
    const removed = await removeByEndpoint(endpoint);
    return json(res, 200, { removed });
  }

  if (pathname.startsWith('/api/admin/') && !isAdmin(req)) {
    return json(res, 401, { error: 'Token de administrador invalido.' });
  }

  if (req.method === 'GET' && pathname === '/api/admin/subscriptions') {
    const subscriptions = (await readStore()).map(({ id, deviceName, createdAt, updatedAt, userAgent }) => ({
      id, deviceName, createdAt, updatedAt, userAgent
    }));
    return json(res, 200, { subscriptions });
  }

  if (req.method === 'POST' && pathname === '/api/admin/send') {
    const body = await readJson(req);
    const targetId = clean(body.targetId, 80);
    const title = clean(body.title, 90) || 'Nueva notificacion';
    const message = clean(body.body, 240);
    const targetUrl = clean(body.url, 500) || '/';
    const tag = clean(body.tag, 80) || `push-${Date.now()}`;
    if (!targetUrl.startsWith('/') && !/^https:\/\//i.test(targetUrl)) {
      return json(res, 400, { error: 'La URL debe ser relativa o HTTPS.' });
    }

    let items = await readStore();
    const targets = targetId && targetId !== 'all' ? items.filter((item) => item.id === targetId) : items;
    if (!targets.length) return json(res, 404, { error: 'No hay suscripciones para ese destino.' });

    const payload = JSON.stringify({
      title, body: message, url: targetUrl, tag,
      requireInteraction: Boolean(body.requireInteraction),
      icon: '/icons/icon-192.png', badge: '/icons/badge-96.png'
    });

    const results = await Promise.all(targets.map(async (item) => {
      try {
        await sendWebPush(item.subscription, payload);
        return { id: item.id, deviceName: item.deviceName, ok: true };
      } catch (error) {
        const expired = error.statusCode === 404 || error.statusCode === 410;
        return {
          id: item.id, deviceName: item.deviceName, ok: false, expired,
          statusCode: error.statusCode || null,
          message: clean(error.message, 300)
        };
      }
    }));

    const expiredIds = new Set(results.filter((item) => item.expired).map((item) => item.id));
    if (expiredIds.size) {
      await removeByIds(expiredIds);
      items = items.filter((item) => !expiredIds.has(item.id));
    }
    const sent = results.filter((item) => item.ok).length;
    return json(res, 200, { sent, failed: results.length - sent, results });
  }

  return json(res, 404, { error: 'API no encontrada.' });
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8', '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8', '.ico': 'image/x-icon'
};

function serveStatic(req, res, pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const full = path.resolve(PUBLIC, `.${requested}`);
  if (!full.startsWith(PUBLIC + path.sep)) return json(res, 403, { error: 'Ruta invalida.' });
  fs.readFile(full, (error, data) => {
    if (error) {
      if (error.code === 'ENOENT') return json(res, 404, { error: 'Archivo no encontrado.' });
      return json(res, 500, { error: 'No se pudo leer el archivo.' });
    }
    const headers = {
      'Content-Type': MIME[path.extname(full)] || 'application/octet-stream',
      'Content-Length': data.length,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'geolocation=(), camera=(), microphone=()'
    };
    if (full.endsWith('sw.js')) headers['Cache-Control'] = 'no-cache';
    res.writeHead(200, headers);
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname === '/health') return json(res, 200, { ok: true });
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url.pathname);
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Metodo no permitido.' });
    return serveStatic(req, res, decodeURIComponent(url.pathname));
  } catch (error) {
    console.error(error);
    return json(res, error.status || 500, { error: error.message || 'Error interno.' });
  }
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`WebPush PWA: http://localhost:${PORT}`);
    console.log('En produccion debes usar HTTPS.');
    console.log(`Persistencia: ${USE_SUPABASE ? 'Supabase' : 'archivo local'}`);
  });
}

module.exports = {
  server,
  encryptPayload,
  createVapidAuthorization,
  hkdfExtract,
  hkdfExpand,
  b64url,
  fromB64url,
  VAPID_PUBLIC_KEY
};
