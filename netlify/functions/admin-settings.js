/**
 * Bells Fork Truck & Auto — Admin Settings Function
 * GET/POST /.netlify/functions/admin-settings
 *
 * Persists admin settings (OpenAI key, Google Reviews) in Netlify Blobs
 * so they survive across browsers, devices, and cache clears.
 *
 * GET  — returns saved settings (OpenAI key is masked)
 * POST — saves settings
 * Body: { auth: { user, passwordHash }, settings: { openaiKey?, googleKey?, placeId? } }
 */

const crypto = require('crypto');
const { getStore } = require('@netlify/blobs');

function blobStore(name) {
  const siteID = process.env.SITE_ID;
  const token = process.env.NF_API_TOKEN;
  if (!siteID || !token) {
    throw new Error('Blob config missing: SITE_ID=' + (siteID ? 'set' : 'UNSET') + ', NF_API_TOKEN=' + (token ? 'set' : 'UNSET'));
  }
  return getStore({ name, siteID, token, apiURL: 'https://api.netlify.com' });
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

const BLOB_KEY = 'admin-settings';

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(event), body: '' };
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

  // Both GET and POST require auth via query params or body
  let authUser, authHash;

  if (event.httpMethod === 'GET') {
    const params = event.queryStringParameters || {};
    authUser = params.user;
    authHash = params.hash;
  } else if (event.httpMethod === 'POST') {
    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return { statusCode: 400, headers: corsHeaders(event), body: JSON.stringify({ error: 'Invalid JSON' }) };
    }
    authUser = body.auth && body.auth.user;
    authHash = body.auth && body.auth.passwordHash;

    if (!authUser || !authHash) {
      return { statusCode: 401, headers: corsHeaders(event), body: JSON.stringify({ error: 'Authentication required' }) };
    }

    if (!validateAuth(authUser, authHash, usersConfig)) {
      return { statusCode: 403, headers: corsHeaders(event), body: JSON.stringify({ error: 'Invalid credentials' }) };
    }

    // Save settings
    const { settings } = body;
    if (!settings || typeof settings !== 'object') {
      return { statusCode: 400, headers: corsHeaders(event), body: JSON.stringify({ error: 'settings object required' }) };
    }

    try {
      const store = blobStore('admin-config');
      // Load existing settings first so partial updates work
      let existing = {};
      try {
        const raw = await store.get(BLOB_KEY);
        if (raw) existing = JSON.parse(raw);
      } catch { /* first time */ }

      // Merge — only update fields that are provided and non-empty
      if (settings.openaiKey && !settings.openaiKey.startsWith('*')) {
        existing.openaiKey = settings.openaiKey;
      }
      if (settings.googleKey && !settings.googleKey.startsWith('*')) {
        existing.googleKey = settings.googleKey;
      }
      if (settings.placeId) existing.placeId = settings.placeId;

      await store.set(BLOB_KEY, JSON.stringify(existing));

      return {
        statusCode: 200,
        headers: { ...corsHeaders(event), 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: true, message: 'Settings saved.' }),
      };
    } catch (err) {
      return { statusCode: 500, headers: corsHeaders(event), body: JSON.stringify({ error: 'Failed to save: ' + err.message }) };
    }
  } else {
    return { statusCode: 405, headers: corsHeaders(event), body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // GET — load settings
  if (!authUser || !authHash) {
    return { statusCode: 401, headers: corsHeaders(event), body: JSON.stringify({ error: 'Authentication required' }) };
  }
  if (!validateAuth(authUser, authHash, usersConfig)) {
    return { statusCode: 403, headers: corsHeaders(event), body: JSON.stringify({ error: 'Invalid credentials' }) };
  }

  try {
    const store = blobStore('admin-config');
    const raw = await store.get(BLOB_KEY);
    const saved = raw ? JSON.parse(raw) : {};

    // Mask the OpenAI key for display
    return {
      statusCode: 200,
      headers: { ...corsHeaders(event), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        settings: {
          openaiKey: saved.openaiKey ? '********' : '',
          openaiKeySet: !!saved.openaiKey,
          googleKey: saved.googleKey ? '********' : '',
          googleKeySet: !!saved.googleKey,
          placeId: saved.placeId || '',
        },
      }),
    };
  } catch (err) {
    return { statusCode: 500, headers: corsHeaders(event), body: JSON.stringify({ error: 'Failed to load: ' + err.message }) };
  }
};
