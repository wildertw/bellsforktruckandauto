/**
 * Bells Fork Truck & Auto — AI MPG Lookup
 * POST /.netlify/functions/ai-mpg-lookup
 *
 * Body: { auth: { user, passwordHash }, vehicle: { year, make, model, trim, engine, drivetrain } }
 * Uses OpenAI with web search to find EPA City/Highway MPG for the given vehicle configuration.
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

/**
 * Parse and validate MPG values from the AI response.
 * Returns { mpgCity, mpgHighway } with integers, or null if invalid.
 */
function parseMpgValues(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const city = parseInt(raw.mpgCity, 10);
  const highway = parseInt(raw.mpgHighway, 10);

  // Sanity check: MPG should be between 5 and 150 for any real vehicle
  if (isNaN(city) || isNaN(highway)) return null;
  if (city < 5 || city > 150 || highway < 5 || highway > 150) return null;
  // Highway MPG should generally be >= city MPG (with small tolerance)
  if (highway < city - 3) return null;

  return { mpgCity: city, mpgHighway: highway };
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

  // Validate vehicle data — need at minimum year + make + model
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

  // Build the vehicle description string for the search query
  const vehicleParts = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean);
  const extras = [];
  if (vehicle.trim) extras.push(vehicle.trim + ' trim');
  if (vehicle.engine) extras.push(vehicle.engine + ' engine');
  if (vehicle.drivetrain) extras.push(vehicle.drivetrain);
  const vehicleDesc = vehicleParts.join(' ') + (extras.length ? ' ' + extras.join(', ') : '');

  // Build the prompt — instruct the model to search for EPA MPG data
  const systemPrompt = `You are a vehicle specifications lookup assistant. Your job is to find the official EPA fuel economy (MPG) ratings for a specific vehicle configuration. Return ONLY valid JSON — no markdown, no code fences, no explanation.

Rules:
- Search for the exact vehicle configuration specified including trim, engine, and drivetrain when provided.
- Use EPA fuel economy data from fueleconomy.gov or other authoritative automotive sources.
- If the exact trim/engine/drivetrain combination is found, return those MPG values.
- If only a close match is found (e.g., same model but different trim), return those values and set "exact" to false.
- If no reasonable match is found at all, return null values.
- MPG values must be integers representing the EPA combined city/highway ratings (not combined, not adjusted).

Response format (strict JSON, no markdown):
{"mpgCity": <number|null>, "mpgHighway": <number|null>, "exact": <boolean>, "source": "<brief source description>", "note": "<optional note about the match>"}`;

  const userPrompt = `Find the EPA fuel economy ratings (City MPG and Highway MPG) for this vehicle:

Vehicle: ${vehicleDesc}
${vehicle.year ? 'Year: ' + vehicle.year : ''}
Make: ${vehicle.make}
Model: ${vehicle.model}
${vehicle.trim ? 'Trim: ' + vehicle.trim : ''}
${vehicle.engine ? 'Engine: ' + vehicle.engine : ''}
${vehicle.drivetrain ? 'Drivetrain: ' + vehicle.drivetrain : ''}

Search for the most accurate EPA MPG data for this exact configuration. Return strict JSON only.`;

  try {
    // Use OpenAI Responses API with web search tool
    const res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + openaiKey,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        tools: [{ type: 'web_search_preview' }],
        instructions: systemPrompt,
        input: userPrompt,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('[ai-mpg-lookup] OpenAI API error:', res.status, errText);
      if (res.status === 401) {
        return { statusCode: 502, headers: corsHeaders(event), body: JSON.stringify({ error: 'OpenAI API key is invalid. Update the key in admin Settings.' }) };
      }
      if (res.status === 429) {
        return { statusCode: 429, headers: corsHeaders(event), body: JSON.stringify({ error: 'Rate limit exceeded — please wait and try again.' }) };
      }
      return { statusCode: 502, headers: corsHeaders(event), body: JSON.stringify({ error: 'AI service temporarily unavailable (status ' + res.status + ').' }) };
    }

    const data = await res.json();

    // Extract the text content from the Responses API output
    let content = '';
    if (data.output && Array.isArray(data.output)) {
      for (const item of data.output) {
        if (item.type === 'message' && item.content && Array.isArray(item.content)) {
          for (const block of item.content) {
            if (block.type === 'output_text') {
              content += block.text;
            }
          }
        }
      }
    }

    if (!content.trim()) {
      return {
        statusCode: 200,
        headers: { ...corsHeaders(event), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ok: true,
          found: false,
          mpgCity: null,
          mpgHighway: null,
          message: 'MPG data not found for this exact configuration. Please enter manually.',
        }),
      };
    }

    // Parse the JSON response — strip any markdown fences if present
    let cleaned = content.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
    }

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      console.error('[ai-mpg-lookup] Failed to parse AI response:', cleaned);
      return {
        statusCode: 200,
        headers: { ...corsHeaders(event), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ok: true,
          found: false,
          mpgCity: null,
          mpgHighway: null,
          message: 'MPG data not found for this exact configuration. Please enter manually.',
        }),
      };
    }

    // Validate and normalize the parsed values
    const validated = parseMpgValues(parsed);
    if (!validated) {
      return {
        statusCode: 200,
        headers: { ...corsHeaders(event), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ok: true,
          found: false,
          mpgCity: null,
          mpgHighway: null,
          message: 'MPG data not found for this exact configuration. Please enter manually.',
        }),
      };
    }

    return {
      statusCode: 200,
      headers: { ...corsHeaders(event), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        found: true,
        mpgCity: validated.mpgCity,
        mpgHighway: validated.mpgHighway,
        exact: parsed.exact !== false,
        source: parsed.source || 'EPA fuel economy data',
        note: parsed.note || '',
      }),
    };
  } catch (err) {
    console.error('[ai-mpg-lookup] Fetch error:', err.message);
    return {
      statusCode: 502,
      headers: corsHeaders(event),
      body: JSON.stringify({ error: 'MPG lookup service failed: ' + err.message }),
    };
  }
};
