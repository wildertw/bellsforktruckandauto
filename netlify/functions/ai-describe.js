/**
 * Bells Fork Truck & Auto — AI Description Generation
 * POST /.netlify/functions/ai-describe
 *
 * Body: { auth: { user, passwordHash }, vehicle: { year, make, model, trim, engine, mileage, features } }
 * Generates a short dealership listing description via OpenAI (server-side).
 *
 * OpenAI key resolution (priority order):
 *   1. OPENAI_API_KEY env var
 *   2. admin-settings blob in Netlify Blobs
 */

const crypto = require('crypto');

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
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
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

  // Parse admin users config
  let usersConfig;
  try {
    const envUsers = process.env.INVENTORY_ADMIN_USERS;
    if (!envUsers) {
      return { statusCode: 500, headers: corsHeaders(event), body: JSON.stringify({ error: 'Server config error: INVENTORY_ADMIN_USERS not set' }) };
    }
    usersConfig = JSON.parse(envUsers);
  } catch {
    return { statusCode: 500, headers: corsHeaders(event), body: JSON.stringify({ error: 'Server config error: INVENTORY_ADMIN_USERS invalid' }) };
  }

  // Parse body
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers: corsHeaders(event), body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const { auth, vehicle } = body;

  // Validate auth
  if (!auth || !auth.user || !auth.passwordHash) {
    return { statusCode: 401, headers: corsHeaders(event), body: JSON.stringify({ error: 'Authentication required' }) };
  }
  if (!validateAuth(auth.user, auth.passwordHash, usersConfig)) {
    return { statusCode: 403, headers: corsHeaders(event), body: JSON.stringify({ error: 'Invalid credentials' }) };
  }

  // Validate vehicle data
  if (!vehicle || !vehicle.make || !vehicle.model) {
    return { statusCode: 400, headers: corsHeaders(event), body: JSON.stringify({ error: 'Vehicle make and model are required' }) };
  }

  // Resolve OpenAI API key: env var → blob settings
  let openaiKey = process.env.OPENAI_API_KEY || '';
  if (!openaiKey) {
    try {
      const { blobStore } = require('../lib/blobStore');
      const store = blobStore('admin-config');
      const raw = await store.get('admin-settings');
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved.openaiKey) openaiKey = saved.openaiKey;
      }
    } catch { /* blob read failed */ }
  }
  if (!openaiKey) {
    return {
      statusCode: 500,
      headers: corsHeaders(event),
      body: JSON.stringify({ error: 'No OpenAI API key configured. Set OPENAI_API_KEY env var or save a key in admin Settings.' }),
    };
  }

  // Build prompt
  const titleParts = [vehicle.year, vehicle.make, vehicle.model, vehicle.trim].filter(Boolean);
  let prompt = 'Write a brief 2-sentence used car listing description for a ' + titleParts.join(' ');
  if (vehicle.engine) prompt += ' with ' + vehicle.engine + ' engine';
  if (vehicle.mileage) prompt += ', ' + Number(vehicle.mileage).toLocaleString() + ' miles';
  if (vehicle.features) prompt += '. Features: ' + vehicle.features;
  prompt += '. Keep it professional and appealing for a dealership website.';

  // Call OpenAI
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + openaiKey,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 150,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('[ai-describe] OpenAI API error:', res.status, errText);
      if (res.status === 401) {
        return { statusCode: 502, headers: corsHeaders(event), body: JSON.stringify({ error: 'OpenAI API key is invalid. Update the key in admin Settings.' }) };
      }
      if (res.status === 429) {
        return { statusCode: 429, headers: corsHeaders(event), body: JSON.stringify({ error: 'Rate limit exceeded — please wait and try again.' }) };
      }
      return { statusCode: 502, headers: corsHeaders(event), body: JSON.stringify({ error: 'AI service temporarily unavailable (status ' + res.status + ').' }) };
    }

    const data = await res.json();
    const content = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';

    if (!content.trim()) {
      return { statusCode: 502, headers: corsHeaders(event), body: JSON.stringify({ error: 'AI returned an empty response — please try again.' }) };
    }

    return {
      statusCode: 200,
      headers: { ...corsHeaders(event), 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, description: content.trim() }),
    };
  } catch (err) {
    console.error('[ai-describe] Fetch error:', err.message);
    return {
      statusCode: 502,
      headers: corsHeaders(event),
      body: JSON.stringify({ error: 'AI description service failed: ' + err.message }),
    };
  }
};
