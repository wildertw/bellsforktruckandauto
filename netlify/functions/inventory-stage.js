/**
 * Bells Fork Auto & Truck — Inventory Stage Function
 * POST /.netlify/functions/inventory-stage
 *
 * Body: { auth: { user, passwordHash }, inventory: { lastUpdated, vehicles: [...] } }
 * Validates the user, then stores inventory in Netlify Blobs as "staged".
 * Returns a diff summary so the admin can review before publishing.
 *
 * Optional env var:
 *   INVENTORY_ADMIN_USERS — JSON: {"frank":"<sha256>","trey":"<sha256>"}
 *   (falls back to the hashes from admin-login.html if not set)
 */

const crypto = require('crypto');
const { getStore } = require('@netlify/blobs');

const FALLBACK_USERS = {
  frank: '8e0a49d96938eca5a973cb170f392fa6e117ac8e0bbae8f281f365d7fd3c4139',
  trey:  '8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918',
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function validateAuth(user, passwordHash, usersConfig) {
  const normalized = (user || '').trim().toLowerCase();
  const expected = usersConfig[normalized];
  if (!expected) return false;
  try {
    const provided = Buffer.from(String(passwordHash).toLowerCase());
    const exp     = Buffer.from(String(expected).toLowerCase());
    if (provided.length !== exp.length) return false;
    return crypto.timingSafeEqual(provided, exp);
  } catch {
    return false;
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let usersConfig;
  try {
    usersConfig = { ...FALLBACK_USERS, ...JSON.parse(process.env.INVENTORY_ADMIN_USERS || '{}') };
  } catch {
    usersConfig = { ...FALLBACK_USERS };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const { auth, inventory } = body;

  if (!auth || !auth.user || !auth.passwordHash) {
    return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Authentication required' }) };
  }
  if (!validateAuth(auth.user, auth.passwordHash, usersConfig)) {
    await new Promise(r => setTimeout(r, 600));
    return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Invalid credentials' }) };
  }

  if (!inventory || !Array.isArray(inventory.vehicles)) {
    return {
      statusCode: 400,
      headers: CORS,
      body: JSON.stringify({ error: 'Invalid inventory format. Must have a "vehicles" array.' }),
    };
  }

  // Load current production inventory from Blobs for diff comparison
  let currentVehicles = [];
  try {
    const store = getStore({ name: 'inventory', consistency: 'strong' });
    const current = await store.get('current', { type: 'json' });
    if (current && Array.isArray(current.vehicles)) {
      currentVehicles = current.vehicles;
    }
  } catch {
    // No current blob yet — first upload
  }

  const currentKeys = new Set(currentVehicles.map(v => v.stockNumber || v.vin));
  const newKeys     = new Set(inventory.vehicles.map(v => v.stockNumber || v.vin));

  const added = inventory.vehicles
    .filter(v => !currentKeys.has(v.stockNumber || v.vin))
    .map(v => `${v.year} ${v.make} ${v.model} (${v.stockNumber || v.vin})`);

  const removed = currentVehicles
    .filter(v => !newKeys.has(v.stockNumber || v.vin))
    .map(v => `${v.year} ${v.make} ${v.model} (${v.stockNumber || v.vin})`);

  const stagedAt = new Date().toISOString();
  const stagedPayload = {
    vehicles: inventory.vehicles,
    lastUpdated: stagedAt,
    _stagedBy: auth.user,
    _stagedAt: stagedAt,
  };

  try {
    const store = getStore({ name: 'inventory', consistency: 'strong' });
    await store.setJSON('staged', stagedPayload);
  } catch (err) {
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: 'Failed to save staged inventory: ' + err.message }),
    };
  }

  return {
    statusCode: 200,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ok: true,
      count: inventory.vehicles.length,
      stagedAt,
      stagedBy: auth.user,
      diff: { added, removed },
    }),
  };
};
