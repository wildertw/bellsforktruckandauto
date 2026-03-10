/**
 * Bells Fork Truck & Auto — Photo Upload Function
 * POST /.netlify/functions/photo-upload
 *
 * Body: { auth: { user, passwordHash }, stockNumber, photoIndex, imageData (base64), contentType }
 * Validates the user, decodes base64, stores in Netlify Blobs (vehicle-photos store).
 * Returns the blob key prefixed with "blob:" for inventory.json storage.
 */

const crypto = require('crypto');
const { getStore } = require('@netlify/blobs');

// V1 function blob config — required for legacy exports.handler functions
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

const CORS = {
  'Access-Control-Allow-Origin': process.env.URL || 'https://bellsforkautoandtruck.com',
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
    const envUsers = process.env.INVENTORY_ADMIN_USERS;
    if (!envUsers) {
      return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Server configuration error: INVENTORY_ADMIN_USERS not set' }) };
    }
    usersConfig = JSON.parse(envUsers);
  } catch {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Server configuration error: INVENTORY_ADMIN_USERS invalid' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const { auth, stockNumber, photoIndex, imageData, contentType } = body;

  if (!auth || !auth.user || !auth.passwordHash) {
    return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Authentication required' }) };
  }
  if (!validateAuth(auth.user, auth.passwordHash, usersConfig)) {
    await new Promise(r => setTimeout(r, 600));
    return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Invalid credentials' }) };
  }

  if (!stockNumber || photoIndex == null || !imageData) {
    return {
      statusCode: 400,
      headers: CORS,
      body: JSON.stringify({ error: 'Missing required fields: stockNumber, photoIndex, imageData' }),
    };
  }

  // Validate stockNumber format — alphanumeric + hyphens only, max 20 chars
  const cleanStock = String(stockNumber).replace(/[^A-Za-z0-9\-]/g, '').slice(0, 20);
  if (!cleanStock) {
    return {
      statusCode: 400,
      headers: CORS,
      body: JSON.stringify({ error: 'Invalid stockNumber format.' }),
    };
  }

  // Validate photoIndex is a reasonable number (1-25)
  const photoIdx = Number(photoIndex);
  if (!Number.isInteger(photoIdx) || photoIdx < 0 || photoIdx > 25) {
    return {
      statusCode: 400,
      headers: CORS,
      body: JSON.stringify({ error: 'photoIndex must be an integer between 0 and 25.' }),
    };
  }

  // Validate content type — only allow image MIME types
  const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
  const normalizedType = (contentType || 'image/png').toLowerCase().trim();
  if (!ALLOWED_TYPES.includes(normalizedType)) {
    return {
      statusCode: 400,
      headers: CORS,
      body: JSON.stringify({ error: 'Invalid content type. Allowed: JPEG, PNG, WebP.' }),
    };
  }

  // Quick base64 length check before decoding (avoids memory spike on huge payloads)
  // base64 encodes 3 bytes into 4 chars; 5MB = ~6.67M base64 chars
  if (typeof imageData !== 'string' || imageData.length > 7 * 1024 * 1024) {
    return {
      statusCode: 413,
      headers: CORS,
      body: JSON.stringify({ error: 'Image too large. Maximum 5MB per photo.' }),
    };
  }

  // Build blob key
  const idx = String(photoIdx).padStart(2, '0');
  const EXT_MAP = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
  const ext = EXT_MAP[normalizedType] || 'png';
  const blobKey = cleanStock.toUpperCase() + '-' + idx + '.' + ext;

  try {
    const store = blobStore('vehicle-photos');
    const buffer = Buffer.from(imageData, 'base64');

    if (buffer.length > 5 * 1024 * 1024) {
      return {
        statusCode: 413,
        headers: CORS,
        body: JSON.stringify({ error: 'Image too large. Maximum 5MB per photo.' }),
      };
    }

    // Validate image magic bytes to prevent non-image file uploads
    if (buffer.length < 4) {
      return {
        statusCode: 400,
        headers: CORS,
        body: JSON.stringify({ error: 'File too small to be a valid image.' }),
      };
    }
    const magicJpeg = buffer[0] === 0xFF && buffer[1] === 0xD8;
    const magicPng  = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47;
    const magicWebp = buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46;
    if (!magicJpeg && !magicPng && !magicWebp) {
      return {
        statusCode: 400,
        headers: CORS,
        body: JSON.stringify({ error: 'File does not appear to be a valid image (JPEG, PNG, or WebP).' }),
      };
    }

    await store.set(blobKey, buffer);

    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        key: 'blob:' + blobKey,
        serveUrl: '/photos/' + blobKey,
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: 'Failed to store photo: ' + err.message }),
    };
  }
};
