/**
 * Bells Fork Truck & Auto — OEM Label Detection & Color Extraction
 * POST /.netlify/functions/oem-label-detect
 *
 * Body: { auth: { user, passwordHash }, imageUrl: string }
 * Sends a single image to GPT-4o Vision to:
 *   1. Classify whether it's an OEM label / door jamb sticker / paint code label
 *   2. If yes, extract paint code, color name, and raw label text
 *
 * Returns:
 *   { ok, is_oem_label_photo, extracted_paint_code, extracted_color_name,
 *     raw_extracted_text, extraction_confidence, classification_reason }
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

const OEM_LABEL_PROMPT = `You are an automotive OEM label analysis expert. Analyze this image and respond with a JSON object.

STEP 1 — CLASSIFY the image:
Determine if this image shows an OEM manufacturer label, door jamb sticker, VIN compliance label, paint code sticker, service parts identification label, or any automotive manufacturer information label typically found on vehicle door jambs, under hoods, or in engine bays.

These labels typically:
- Are rectangular stickers or plates
- Contain text like "MFD BY", "VIN", "GVWR", "COLOR", "PAINT", "EXT", "INT", "TRIM"
- Show barcode(s)
- List vehicle specifications in a structured format
- Have paint/color codes in formats like "PW7", "GBA", "040", "YZ", "NH731P", etc.
- May show the word "COLOR" or "PAINT" or "EXT" followed by a code

Normal vehicle photos (exterior shots, interior shots, wheel close-ups, engine bay overview, dashboard, etc.) are NOT OEM labels.

STEP 2 — If it IS an OEM label, EXTRACT:
- paint_code: The exterior paint/color code (usually 2-4 alphanumeric characters near "EXT", "COLOR", or "PAINT")
- color_name: The exterior color name if printed on the label
- raw_text: All readable text from the label (normalize whitespace)

Return ONLY this JSON (no markdown, no code fences):
{
  "is_oem_label": true or false,
  "classification_reason": "brief explanation of why this is or isn't an OEM label",
  "paint_code": "extracted code or empty string",
  "color_name": "extracted name or empty string",
  "raw_text": "all readable text from label or empty string",
  "confidence": 0.0 to 1.0
}

If NOT an OEM label, set paint_code, color_name, raw_text to "" and confidence to 0.`;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(event), body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders(event), body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // Build users config
  let usersConfig;
  try {
    const envUsers = process.env.INVENTORY_ADMIN_USERS;
    if (!envUsers) {
      return { statusCode: 500, headers: corsHeaders(event), body: JSON.stringify({ error: 'Server configuration error' }) };
    }
    usersConfig = JSON.parse(envUsers);
  } catch {
    return { statusCode: 500, headers: corsHeaders(event), body: JSON.stringify({ error: 'Server configuration error' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers: corsHeaders(event), body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const { auth, imageUrl } = body;

  if (!auth || !auth.user || !auth.passwordHash) {
    return { statusCode: 401, headers: corsHeaders(event), body: JSON.stringify({ error: 'Authentication required' }) };
  }
  if (!validateAuth(auth.user, auth.passwordHash, usersConfig)) {
    return { statusCode: 403, headers: corsHeaders(event), body: JSON.stringify({ error: 'Invalid credentials' }) };
  }

  if (!imageUrl || typeof imageUrl !== 'string') {
    return { statusCode: 400, headers: corsHeaders(event), body: JSON.stringify({ error: 'imageUrl is required (string)' }) };
  }

  // Resolve OpenAI API key
  let openaiKey = process.env.OPENAI_API_KEY || '';
  if (!openaiKey) {
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
    } catch { /* continue */ }
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
      headers: corsHeaders(event),
      body: JSON.stringify({ error: 'No OpenAI API key configured.' }),
    };
  }

  // Call GPT-4o Vision
  const openaiBody = {
    model: 'gpt-4o',
    max_tokens: 600,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: OEM_LABEL_PROMPT },
        { type: 'image_url', image_url: { url: imageUrl, detail: 'high' } },
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
      return {
        statusCode: res.status === 429 ? 429 : 502,
        headers: corsHeaders(event),
        body: JSON.stringify({ error: 'OpenAI API error: ' + res.status, detail: errText }),
      };
    }

    const data = await res.json();
    let content = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
    content = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

    let analysis;
    try {
      analysis = JSON.parse(content);
    } catch {
      return {
        statusCode: 502,
        headers: corsHeaders(event),
        body: JSON.stringify({ error: 'Failed to parse AI response', raw: content }),
      };
    }

    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        is_oem_label_photo: !!analysis.is_oem_label,
        extracted_paint_code: (analysis.paint_code || '').trim(),
        extracted_color_name: (analysis.color_name || '').trim(),
        raw_extracted_text: (analysis.raw_text || '').trim(),
        extraction_confidence: Number(analysis.confidence) || 0,
        classification_reason: (analysis.classification_reason || '').trim(),
      }),
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: corsHeaders(event),
      body: JSON.stringify({ error: 'OEM label detection failed: ' + err.message }),
    };
  }
};
