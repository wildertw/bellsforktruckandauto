/**
 * Bells Fork Truck & Auto — Inventory Stage Function
 * POST /.netlify/functions/inventory-stage
 *
 * Body: { auth: { user, passwordHash }, inventory: { lastUpdated, vehicles: [...] } }
 * Validates the user, then stores inventory in Netlify Blobs as "staged".
 * Returns a diff summary so the admin can review before publishing.
 *
 * Required env var:
 *   INVENTORY_ADMIN_USERS — JSON: {"frank":"<sha256>","trey":"<sha256>"}
 */

const crypto = require('crypto');
const { getStore } = require('@netlify/blobs');

// V1 function blob config — required for legacy exports.handler functions
function blobStore(nameOrOpts) {
  const siteID = process.env.SITE_ID;
  const token = process.env.NF_API_TOKEN;
  if (!siteID || !token) {
    throw new Error('Blob config missing: SITE_ID=' + (siteID ? 'set' : 'UNSET') + ', NETLIFY_API_TOKEN=' + (token ? 'set' : 'UNSET'));
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
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

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
    return { statusCode: 200, headers: corsHeaders(event), body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders(event), body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let usersConfig;
  try {
    const envUsers = process.env.INVENTORY_ADMIN_USERS;
    if (!envUsers) {
      return { statusCode: 500, headers: corsHeaders(event), body: JSON.stringify({ error: 'Server configuration error: INVENTORY_ADMIN_USERS not set' }) };
    }
    usersConfig = JSON.parse(envUsers);
  } catch {
    return { statusCode: 500, headers: corsHeaders(event), body: JSON.stringify({ error: 'Server configuration error: INVENTORY_ADMIN_USERS invalid' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers: corsHeaders(event), body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const { auth, inventory } = body;

  if (!auth || !auth.user || !auth.passwordHash) {
    return { statusCode: 401, headers: corsHeaders(event), body: JSON.stringify({ error: 'Authentication required' }) };
  }
  if (!validateAuth(auth.user, auth.passwordHash, usersConfig)) {
    await new Promise(r => setTimeout(r, 600));
    return { statusCode: 401, headers: corsHeaders(event), body: JSON.stringify({ error: 'Invalid credentials' }) };
  }

  if (!inventory || !Array.isArray(inventory.vehicles)) {
    return {
      statusCode: 400,
      headers: corsHeaders(event),
      body: JSON.stringify({ error: 'Invalid inventory format. Must have a "vehicles" array.' }),
    };
  }

  // Validate each vehicle has required fields and sane data types
  const validationErrors = [];
  const seenKeys = new Set();
  inventory.vehicles.forEach(function (v, i) {
    const label = v.stockNumber || v.vin || ('index ' + i);
    // Required fields
    if (!v.stockNumber && !v.vin) {
      validationErrors.push(label + ': must have stockNumber or VIN');
    }
    if (!v.make || typeof v.make !== 'string') {
      validationErrors.push(label + ': missing or invalid make');
    }
    if (!v.model || typeof v.model !== 'string') {
      validationErrors.push(label + ': missing or invalid model');
    }
    // Type checks (non-destructive: allow existing data through if loosely valid)
    if (v.year != null && (isNaN(Number(v.year)) || Number(v.year) < 1900 || Number(v.year) > new Date().getFullYear() + 2)) {
      validationErrors.push(label + ': year out of range (1900-' + (new Date().getFullYear() + 2) + ')');
    }
    if (v.price != null && (isNaN(Number(v.price)) || Number(v.price) < 0)) {
      validationErrors.push(label + ': price must be a non-negative number');
    }
    if (v.mileage != null && (isNaN(Number(v.mileage)) || Number(v.mileage) < 0)) {
      validationErrors.push(label + ': mileage must be a non-negative number');
    }
    if (v.images && !Array.isArray(v.images)) {
      validationErrors.push(label + ': images must be an array');
    }
    // Duplicate check
    const key = v.stockNumber || v.vin;
    if (key && seenKeys.has(key)) {
      validationErrors.push(label + ': duplicate stockNumber/VIN in this upload');
    }
    if (key) seenKeys.add(key);
  });

  if (validationErrors.length > 0) {
    return {
      statusCode: 400,
      headers: corsHeaders(event),
      body: JSON.stringify({
        error: 'Vehicle validation failed',
        details: validationErrors.slice(0, 20),
        totalErrors: validationErrors.length,
      }),
    };
  }

  // Load current production inventory from Blobs for diff comparison
  let currentVehicles = [];
  try {
    const store = blobStore({ name: 'inventory', consistency: 'strong' });
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
    const store = blobStore({ name: 'inventory', consistency: 'strong' });
    await store.setJSON('staged', stagedPayload);
  } catch (err) {
    return {
      statusCode: 500,
      headers: corsHeaders(event),
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
