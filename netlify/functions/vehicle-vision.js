/**
 * Bells Fork Truck & Auto — Vehicle Vision Analysis Function
 * POST /.netlify/functions/vehicle-vision
 *
 * Body: { auth: { user, passwordHash }, imageUrls: string[] }
 * Sends vehicle photos to GPT-4o Vision and returns structured vehicle data
 * (colors, body style, features, etc.).
 *
 * OpenAI key resolution (priority order):
 *   1. OPENAI_API_KEY env var (server-side, secure)
 *   2. Authorization: Bearer sk-... header (fallback from client localStorage)
 */

const crypto = require('crypto');

const CORS = {
  'Access-Control-Allow-Origin': process.env.URL || 'https://bellsforkautoandtruck.com',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
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

const VEHICLE_ANALYSIS_PROMPT = `You are a vehicle identification expert for an auto dealership. Analyze these vehicle photos and return a JSON object with the following fields. Only include fields where you are confident in the value. If you cannot determine a field, omit it entirely. Do not guess.

{
  "exteriorColor": "the primary exterior color (e.g., White, Black, Silver, Red, Blue, Gray, Green, Oxford White, Magnetic Gray, etc.)",
  "interiorColor": "the interior color if visible (e.g., Black, Tan, Gray, Brown, Beige, etc.)",
  "interiorMaterial": "if visible: Leather, Cloth, Vinyl, Leatherette",
  "bodyStyle": "one of: Truck, SUV, Sedan, Coupe, Van, Convertible, Wagon, Hatchback, Crossover",
  "make": "vehicle manufacturer if identifiable from badges, grille, or styling (e.g., Ford, Chevrolet, Toyota, GMC, RAM, Jeep)",
  "model": "vehicle model if identifiable from badges (e.g., F-150, Silverado, Tacoma, Sierra)",
  "approximateYear": "approximate model year or range if determinable from body style generation (e.g., 2018 or 2018-2021)",
  "condition": "one of: Excellent, Good, Fair, Poor",
  "cabType": "for trucks only: Regular Cab, Extended Cab, Crew Cab, SuperCab, SuperCrew, Double Cab, Quad Cab",
  "bedLength": "for trucks only: Short Bed, Standard Bed, Long Bed",
  "features": ["array of notable visible features such as: sunroof, panoramic roof, roof rack, running boards, tonneau cover, bed liner, spray-in bed liner, aftermarket wheels, chrome package, tow hitch, LED headlights, fog lights, alloy wheels, tinted windows, leather seats, heated seats, navigation screen, backup camera, third row seating, bull bar, light bar, leveling kit, lift kit, etc."],
  "driveType": "if visible from badges (e.g., 4WD, AWD, 4x4, 2WD)",
  "trimLevel": "if visible from badges (e.g., SLT, Lariat, Limited, LT, XLT, SR5, TRD, Denali, High Country, King Ranch, Platinum)"
}

Return ONLY the JSON object. No markdown formatting, no code fences, no explanation.`;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // Build users config
  let usersConfig;
  try {
    const envUsers = process.env.INVENTORY_ADMIN_USERS;
    if (!envUsers) {
      return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Server configuration error: INVENTORY_ADMIN_USERS not set' }) };
    }
    usersConfig = JSON.parse(envUsers);
  } catch {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Server configuration error: INVENTORY_ADMIN_USERS invalid' }) };
  }

  // Parse body
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const { auth, imageUrls } = body;

  // Validate auth
  if (!auth || !auth.user || !auth.passwordHash) {
    return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Authentication required' }) };
  }
  if (!validateAuth(auth.user, auth.passwordHash, usersConfig)) {
    return { statusCode: 403, headers: CORS, body: JSON.stringify({ error: 'Invalid credentials' }) };
  }

  // Validate imageUrls
  if (!Array.isArray(imageUrls) || imageUrls.length === 0) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'imageUrls must be a non-empty array' }) };
  }
  const validUrls = imageUrls
    .filter(url => typeof url === 'string' && url.startsWith('https://'))
    .slice(0, 5);
  if (validUrls.length === 0) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'No valid HTTPS image URLs provided' }) };
  }

  // Resolve OpenAI API key: env var → blob settings → Authorization header
  let openaiKey = process.env.OPENAI_API_KEY || '';
  if (!openaiKey) {
    // Try loading from saved admin settings in Netlify Blobs
    try {
      const { getStore } = require('@netlify/blobs');
      const siteID = process.env.SITE_ID;
      const token = process.env.NF_API_TOKEN;
      if (siteID && token) {
        const store = getStore({ name: 'admin-config', siteID, token, apiURL: 'https://api.netlify.com' });
        const raw = await store.get('admin-settings');
        if (raw) {
          const saved = JSON.parse(raw);
          if (saved.openaiKey) openaiKey = saved.openaiKey;
        }
      }
    } catch { /* blob read failed, try header next */ }
  }
  if (!openaiKey) {
    const authHeader = (event.headers['authorization'] || event.headers['Authorization'] || '');
    if (authHeader.startsWith('Bearer ')) {
      openaiKey = authHeader.slice(7).trim();
    }
  }
  if (!openaiKey) {
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: 'No OpenAI API key configured. Set OPENAI_API_KEY env var or provide key in Settings.' }),
    };
  }

  // Build GPT-4o Vision request
  const imageContent = validUrls.map(url => ({
    type: 'image_url',
    image_url: { url: url, detail: 'low' },
  }));

  const openaiBody = {
    model: 'gpt-4o',
    max_tokens: 800,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: VEHICLE_ANALYSIS_PROMPT },
        ...imageContent,
      ],
    }],
  };

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + openaiKey,
      },
      body: JSON.stringify(openaiBody),
    });

    if (!res.ok) {
      const errText = await res.text();
      const status = res.status === 429 ? 429 : 502;
      return {
        statusCode: status,
        headers: CORS,
        body: JSON.stringify({ error: 'OpenAI API error: ' + res.status, detail: errText }),
      };
    }

    const data = await res.json();
    let content = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';

    // Strip markdown code fences if present
    content = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

    let analysis;
    try {
      analysis = JSON.parse(content);
    } catch {
      return {
        statusCode: 502,
        headers: CORS,
        body: JSON.stringify({ error: 'Failed to parse AI response as JSON', raw: content }),
      };
    }

    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        analysis: analysis,
        imagesAnalyzed: validUrls.length,
      }),
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: CORS,
      body: JSON.stringify({ error: 'Vision API call failed: ' + err.message }),
    };
  }
};
