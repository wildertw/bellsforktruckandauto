import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'module';
import crypto from 'crypto';
const require = createRequire(import.meta.url);

// Helper: compute SHA-256 hex hash (same as client-side)
function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

// The handler is loaded fresh in tests to pick up env vars
let handler;

function makeEvent(method, body, origin) {
  return {
    httpMethod: method,
    headers: { origin: origin || 'https://bellsforktruckandauto.com' },
    body: body ? JSON.stringify(body) : '',
  };
}

describe('blog-auth handler', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.BLOG_JWT_SECRET = 'test-secret-that-is-long-enough-for-jwt-signing-purposes-64chars!';
    process.env.BLOG_ADMIN_USERS = JSON.stringify({
      admin: sha256Hex('correctpassword'),
    });
    handler = require('../netlify/functions/blog-auth').handler;
  });

  it('returns 200 for OPTIONS (CORS preflight)', async () => {
    const res = await handler(makeEvent('OPTIONS'));
    expect(res.statusCode).toBe(200);
    expect(res.headers['Access-Control-Allow-Origin']).toBeTruthy();
  });

  it('returns 405 for GET requests', async () => {
    const res = await handler(makeEvent('GET'));
    expect(res.statusCode).toBe(405);
  });

  it('returns 400 for missing credentials', async () => {
    const res = await handler(makeEvent('POST', {}));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain('required');
  });

  it('returns 401 for wrong password', async () => {
    const res = await handler(
      makeEvent('POST', { username: 'admin', passwordHash: sha256Hex('wrongpassword') })
    );
    expect(res.statusCode).toBe(401);
  });

  it('returns 200 with token for correct credentials', async () => {
    const res = await handler(
      makeEvent('POST', { username: 'admin', passwordHash: sha256Hex('correctpassword') })
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.token).toBeTruthy();
    expect(body.user).toBe('Admin');
    expect(body.expiresAt).toBeGreaterThan(0);
  });

  it('is case-insensitive for username', async () => {
    const res = await handler(
      makeEvent('POST', { username: 'ADMIN', passwordHash: sha256Hex('correctpassword') })
    );
    expect(res.statusCode).toBe(200);
  });

  it('sets HttpOnly cookie on success', async () => {
    const res = await handler(
      makeEvent('POST', { username: 'admin', passwordHash: sha256Hex('correctpassword') })
    );
    expect(res.headers['Set-Cookie']).toContain('bf_admin_token=');
    expect(res.headers['Set-Cookie']).toContain('HttpOnly');
    expect(res.headers['Set-Cookie']).toContain('SameSite=Strict');
  });

  it('returns 500 when BLOG_JWT_SECRET is missing', async () => {
    delete process.env.BLOG_JWT_SECRET;
    vi.resetModules();
    handler = require('../netlify/functions/blog-auth').handler;
    const res = await handler(
      makeEvent('POST', { username: 'admin', passwordHash: sha256Hex('correctpassword') })
    );
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error).toContain('BLOG_JWT_SECRET');
  });

  it('returns 500 when BLOG_ADMIN_USERS is missing', async () => {
    delete process.env.BLOG_ADMIN_USERS;
    vi.resetModules();
    handler = require('../netlify/functions/blog-auth').handler;
    const res = await handler(
      makeEvent('POST', { username: 'admin', passwordHash: sha256Hex('correctpassword') })
    );
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error).toContain('BLOG_ADMIN_USERS');
  });

  it('returns correct CORS header for allowed origins', async () => {
    const res = await handler(
      makeEvent('POST', { username: 'admin', passwordHash: sha256Hex('correctpassword') },
      'https://www.bellsforktruckandauto.com')
    );
    expect(res.headers['Access-Control-Allow-Origin']).toBe('https://www.bellsforktruckandauto.com');
  });

  it('defaults CORS origin for unknown origins', async () => {
    const res = await handler(
      makeEvent('POST', { username: 'admin', passwordHash: sha256Hex('correctpassword') },
      'https://evil-site.com')
    );
    expect(res.headers['Access-Control-Allow-Origin']).toBe('https://bellsforktruckandauto.com');
  });

  it('returns 400 for invalid JSON body', async () => {
    const res = await handler({
      httpMethod: 'POST',
      headers: { origin: 'https://bellsforktruckandauto.com' },
      body: 'not-json{{{',
    });
    expect(res.statusCode).toBe(400);
  });
});
