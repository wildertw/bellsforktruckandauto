/**
 * Bells Fork Truck & Auto — Sales Data Function
 * GET  /.netlify/functions/sales-data        → read all sales records
 * POST /.netlify/functions/sales-data        → upsert a sales record
 *
 * Auth: Authorization: Basic base64(user:passwordHash)
 * Storage: Netlify Blobs store "sales-records", key "all"
 */

const crypto = require('crypto');
const { getStore } = require('@netlify/blobs');

function blobStore(nameOrOpts) {
  const siteID = process.env.SITE_ID;
  const token = process.env.NF_API_TOKEN;
  if (!siteID || !token) {
    throw new Error('Blob config missing: SITE_ID=' + (siteID ? 'set' : 'UNSET') + ', NF_API_TOKEN=' + (token ? 'set' : 'UNSET'));
  }
  const cfg = { siteID, token, apiURL: 'https://api.netlify.com' };
  if (typeof nameOrOpts === 'string') return getStore({ name: nameOrOpts, ...cfg });
  return getStore({ ...nameOrOpts, ...cfg });
}

const ALLOWED_ORIGINS = new Set([
  'https://bellsforktruckandauto.com',
  'https://www.bellsforktruckandauto.com',
  'https://bellsforktruckandauto.netlify.app',
]);

function corsHeaders(event) {
  const origin = ((event && event.headers) || {}).origin || '';
  const matched = ALLOWED_ORIGINS.has(origin) ? origin : 'https://bellsforktruckandauto.com';
  return {
    'Access-Control-Allow-Origin': matched,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin',
  };
}

function validateAuth(user, passwordHash) {
  let usersConfig;
  try {
    const envUsers = process.env.INVENTORY_ADMIN_USERS;
    if (!envUsers) return false;
    usersConfig = JSON.parse(envUsers);
  } catch {
    return false;
  }

  const normalized = (user || '').trim().toLowerCase();
  const expected = usersConfig[normalized];
  if (!expected) return false;
  try {
    const provided = Buffer.from(String(passwordHash).toLowerCase());
    const exp = Buffer.from(String(expected).toLowerCase());
    if (provided.length !== exp.length) return false;
    return crypto.timingSafeEqual(provided, exp);
  } catch {
    return false;
  }
}

function parseAuth(headers) {
  const authHeader = headers.authorization || headers.Authorization || '';
  let user = '';
  let hash = '';
  if (authHeader.startsWith('Basic ')) {
    try {
      const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
      const colonIndex = decoded.indexOf(':');
      if (colonIndex > 0) {
        user = decoded.slice(0, colonIndex);
        hash = decoded.slice(colonIndex + 1);
      }
    } catch { /* invalid */ }
  }
  return { user, hash };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(event), body: '' };
  }

  const { user: authUser, hash: authHash } = parseAuth(event.headers);
  if (!validateAuth(authUser, authHash)) {
    return { statusCode: 401, headers: corsHeaders(event), body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const store = blobStore({ name: 'sales-records', consistency: 'strong' });
  const RECORDS_KEY = 'all';

  // ─── GET: Read all sales records ───────────────────────────────────────────
  if (event.httpMethod === 'GET') {
    try {
      const records = await store.get(RECORDS_KEY, { type: 'json' });
      return {
        statusCode: 200,
        headers: { ...corsHeaders(event), 'Content-Type': 'application/json' },
        body: JSON.stringify(records || []),
      };
    } catch (err) {
      console.error('Sales GET error:', err);
      return { statusCode: 500, headers: corsHeaders(event), body: JSON.stringify({ error: 'Failed to read sales records' }) };
    }
  }

  // ─── POST: Upsert a sales record ──────────────────────────────────────────
  if (event.httpMethod === 'POST') {
    let body;
    try {
      body = JSON.parse(event.body);
    } catch {
      return { statusCode: 400, headers: corsHeaders(event), body: JSON.stringify({ error: 'Invalid JSON' }) };
    }

    const record = body.record;
    if (!record || !record.vehicleId) {
      return { statusCode: 400, headers: corsHeaders(event), body: JSON.stringify({ error: 'Missing record or vehicleId' }) };
    }

    try {
      const existing = await store.get(RECORDS_KEY, { type: 'json' }) || [];
      const idx = existing.findIndex(function (r) { return r.vehicleId === record.vehicleId; });
      if (idx >= 0) {
        existing[idx] = { ...existing[idx], ...record, updatedAt: new Date().toISOString() };
      } else {
        record.createdAt = record.createdAt || new Date().toISOString();
        record.updatedAt = new Date().toISOString();
        existing.push(record);
      }
      await store.setJSON(RECORDS_KEY, existing);
      return {
        statusCode: 200,
        headers: { ...corsHeaders(event), 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: true, count: existing.length }),
      };
    } catch (err) {
      console.error('Sales POST error:', err);
      return { statusCode: 500, headers: corsHeaders(event), body: JSON.stringify({ error: 'Failed to write sales record' }) };
    }
  }

  return { statusCode: 405, headers: corsHeaders(event), body: JSON.stringify({ error: 'Method not allowed' }) };
};
