/**
 * Bells Fork Truck & Auto — Admin Auth Edge Function
 *
 * Intercepts requests to admin pages and verifies the bf_admin_token cookie.
 * If the cookie contains a valid JWT (signed with BLOG_JWT_SECRET, not expired),
 * the request passes through. Otherwise, a minimal login page is served.
 */

function base64urlDecode(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function verifyJWT(token, secret) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [headerB64, payloadB64, sigB64] = parts;

    // Import the secret key for HMAC-SHA256 verification
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    // Verify the signature
    const sigBytes = base64urlDecode(sigB64);
    const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, data);

    if (!valid) return null;

    // Decode payload
    const payload = JSON.parse(new TextDecoder().decode(base64urlDecode(payloadB64)));

    // Check expiration
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

function getCookie(cookieHeader, name) {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
  return match ? match[1] : null;
}

const LOGIN_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>Admin Login - Bells Fork Truck &amp; Auto</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f1117; color: #e4e4e7; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { background: #1a1b23; border: 1px solid #2a2b35; border-radius: 12px; padding: 2rem; width: 100%; max-width: 380px; }
    h1 { font-size: 1.25rem; margin-bottom: 0.5rem; }
    p { font-size: 0.875rem; color: #9ca3af; margin-bottom: 1.5rem; }
    label { display: block; font-size: 0.8rem; color: #9ca3af; margin-bottom: 0.25rem; }
    input { width: 100%; padding: 0.6rem 0.75rem; border: 1px solid #2a2b35; border-radius: 6px; background: #0f1117; color: #e4e4e7; font-size: 0.9rem; margin-bottom: 1rem; }
    input:focus { outline: none; border-color: #3b82f6; }
    button { width: 100%; padding: 0.65rem; background: #3b82f6; color: #fff; border: none; border-radius: 6px; font-size: 0.9rem; cursor: pointer; }
    button:hover { background: #2563eb; }
    .error { color: #ef4444; font-size: 0.8rem; margin-top: 0.5rem; display: none; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Admin Login</h1>
    <p>Sign in to access the dashboard.</p>
    <form id="loginForm">
      <label for="user">Username</label>
      <input id="user" type="text" autocomplete="username" required>
      <label for="pass">Password</label>
      <input id="pass" type="password" autocomplete="current-password" required>
      <button type="submit">Sign In</button>
      <p class="error" id="error"></p>
    </form>
  </div>
  <script>
    async function sha256(str) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
      return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
    }
    document.getElementById('loginForm').addEventListener('submit', async function(e) {
      e.preventDefault();
      var errEl = document.getElementById('error');
      errEl.style.display = 'none';
      var user = document.getElementById('user').value.trim();
      var pass = document.getElementById('pass').value;
      if (!user || !pass) return;
      try {
        var hash = await sha256(pass);
        var res = await fetch('/.netlify/functions/blog-auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: user, passwordHash: hash }),
        });
        if (!res.ok) throw new Error('Invalid credentials');
        // Cookie is set by the blog-auth response, reload to pass through edge function
        window.location.reload();
      } catch (err) {
        errEl.textContent = 'Invalid username or password.';
        errEl.style.display = 'block';
      }
    });
  </script>
</body>
</html>`;

export default async function(request, context) {
  const secret = Netlify.env.get('BLOG_JWT_SECRET');

  // If BLOG_JWT_SECRET is not configured, block access entirely
  if (!secret) {
    return new Response('Admin access not configured.', { status: 503 });
  }

  // Check for bf_admin_token cookie
  const cookieHeader = request.headers.get('cookie');
  const token = getCookie(cookieHeader, 'bf_admin_token');

  if (token) {
    const payload = await verifyJWT(token, secret);
    if (payload) {
      // Valid session — pass through to the actual admin page
      return context.next();
    }
  }

  // No valid token — serve login page
  return new Response(LOGIN_PAGE, {
    status: 401,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
