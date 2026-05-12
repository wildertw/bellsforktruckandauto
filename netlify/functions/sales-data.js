/**
 * Bells Fork Truck & Auto — Sales Data Function
 * GET  /.netlify/functions/sales-data        → read all sales records
 * POST /.netlify/functions/sales-data        → upsert a sales record
 *
 * Auth: Authorization: Basic base64(user:passwordHash)
 * Storage: Netlify Blobs store "sales-records", key "all"
 */

const crypto = require('crypto');
const { blobStore } = require('../lib/blobStore');

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

// Optimistic concurrency: re-read before write to detect concurrent changes
const MAX_RETRIES = 3;
async function withRecordsLock(store, key, mutate) {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    let records = await store.get(key, { type: 'json' }) || [];
    const snapshot = JSON.stringify(records);

    const result = await mutate(records);

    let check = await store.get(key, { type: 'json' }) || [];
    if (JSON.stringify(check) !== snapshot) {
      console.warn(`[sales-data] Concurrent modification detected (attempt ${attempt + 1}/${MAX_RETRIES}), retrying...`);
      continue;
    }

    await store.setJSON(key, records);
    return result;
  }
  throw new Error('Failed to save after ' + MAX_RETRIES + ' retries due to concurrent modifications');
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
      body = JSON.parse(event.body || '{}');
    } catch {
      return { statusCode: 400, headers: corsHeaders(event), body: JSON.stringify({ error: 'Invalid JSON' }) };
    }

    const record = body.record;
    if (!record || !record.vehicleId) {
      return { statusCode: 400, headers: corsHeaders(event), body: JSON.stringify({ error: 'Missing record or vehicleId' }) };
    }

    // Whitelist allowed fields to prevent arbitrary data injection
    const ALLOWED_FIELDS = ['vehicleId', 'stockNumber', 'vehicleName', 'year', 'make', 'model',
      'vin', 'salePrice', 'saleDate', 'buyerName', 'buyerPhone', 'buyerEmail',
      'salesperson', 'notes', 'status', 'type', 'category', 'price', 'mileage'];
    const cleanRecord = {};
    for (const key of ALLOWED_FIELDS) {
      if (record[key] !== undefined) cleanRecord[key] = record[key];
    }
    cleanRecord.vehicleId = record.vehicleId; // ensure required field

    try {
      let finalCount = 0;
      await withRecordsLock(store, RECORDS_KEY, function (existing) {
        const idx = existing.findIndex(function (r) { return r.vehicleId === cleanRecord.vehicleId; });
        if (idx >= 0) {
          existing[idx] = { ...existing[idx], ...cleanRecord, updatedAt: new Date().toISOString() };
        } else {
          cleanRecord.createdAt = cleanRecord.createdAt || new Date().toISOString();
          cleanRecord.updatedAt = new Date().toISOString();
          existing.push(cleanRecord);
        }
        finalCount = existing.length;
      });
      console.log('[sales-data] Upserted:', cleanRecord.vehicleId);
      return {
        statusCode: 200,
        headers: { ...corsHeaders(event), 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: true, count: finalCount }),
      };
    } catch (err) {
      console.error('Sales POST error:', err);
      return { statusCode: 500, headers: corsHeaders(event), body: JSON.stringify({ error: 'Failed to write sales record' }) };
    }
  }

  return { statusCode: 405, headers: corsHeaders(event), body: JSON.stringify({ error: 'Method not allowed' }) };
};
