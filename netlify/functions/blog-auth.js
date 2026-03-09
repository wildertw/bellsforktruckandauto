/**
 * Bells Fork Truck & Auto — Blog Auth Function
 * POST /.netlify/functions/blog-auth
 *
 * Body: { username: string, passwordHash: string }
 * The passwordHash is SHA-256(password) computed client-side (matching existing auth pattern).
 *
 * Required Netlify environment variables:
 *   BLOG_JWT_SECRET   — random 64-char secret for signing JWTs
 *   BLOG_ADMIN_USERS  — JSON string: {"trey":"<sha256hash>","frank":"<sha256hash>"}
 *
 * Returns: { token: string, user: string, expiresAt: number }
 */

const crypto = require('crypto');

const FALLBACK_USERS = {
  trey:  '8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918',
  frank: '8e0a49d96938eca5a973cb170f392fa6e117ac8e0bbae8f281f365d7fd3c4139',
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function createJWT(payload, secret) {
  const header = b64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body   = b64url(Buffer.from(JSON.stringify(payload)));
  const sig    = b64url(crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest());
  return `${header}.${body}.${sig}`;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const secret = process.env.BLOG_JWT_SECRET;
  if (!secret) {
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: 'Server configuration error: BLOG_JWT_SECRET not set' }),
    };
  }

  let usersConfig;
  try {
    usersConfig = JSON.parse(process.env.BLOG_ADMIN_USERS || '{}');
  } catch {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Server configuration error: BLOG_ADMIN_USERS invalid' }) };
  }
  usersConfig = { ...FALLBACK_USERS, ...usersConfig };

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  const { username, passwordHash } = body;

  if (!username || !passwordHash) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Username and passwordHash required' }) };
  }

  const normalized = username.trim().toLowerCase();
  const expectedHash = usersConfig[normalized];

  // Constant-time comparison to prevent timing attacks
  let matches = false;
  if (expectedHash) {
    const provided = Buffer.from(String(passwordHash).toLowerCase());
    const expected = Buffer.from(String(expectedHash).toLowerCase());
    if (provided.length === expected.length) {
      matches = crypto.timingSafeEqual(provided, expected);
    }
  }

  if (!matches) {
    // Artificial delay to slow brute-force attempts
    await new Promise(r => setTimeout(r, 600));
    return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Invalid credentials' }) };
  }

  const displayName = normalized.charAt(0).toUpperCase() + normalized.slice(1);
  const expiresAt   = Math.floor(Date.now() / 1000) + 8 * 60 * 60; // 8 hours

  const token = createJWT(
    { sub: normalized, user: displayName, exp: expiresAt, iat: Math.floor(Date.now() / 1000) },
    secret
  );

  return {
    statusCode: 200,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, user: displayName, expiresAt }),
  };
};
