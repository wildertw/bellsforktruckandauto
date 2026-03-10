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

  // Build blob key
  const idx = String(Number(photoIndex)).padStart(2, '0');
  const ext = (contentType || 'image/png').includes('jpeg') || (contentType || '').includes('jpg') ? 'jpg' : 'png';
  const blobKey = stockNumber.toUpperCase() + '-' + idx + '.' + ext;

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
