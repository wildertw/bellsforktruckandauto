/**
 * Bells Fork Truck & Auto — Inventory Publish Function
 * POST /.netlify/functions/inventory-publish
 *
 * Body: { auth: { user, passwordHash } }
 * Reads staged inventory from Netlify Blobs, commits it to GitHub as inventory.json.
 * The GitHub commit triggers Netlify to auto-rebuild and deploy the site.
 *
 * Required Netlify env vars (set for ALL deploy contexts):
 *   GITHUB_TOKEN       — Personal Access Token with "Contents: Read & Write" on the repo
 *   GH_REPO_OWNER      — GitHub username or org (e.g. wildertw)
 *   GH_REPO_NAME       — Repository name (e.g. bellsforktruckandauto)
 *
 * Optional:
 *   INVENTORY_ADMIN_USERS — JSON: {"frank":"<sha256>","trey":"<sha256>"}
 */

const crypto = require('crypto');
const https  = require('https');
const { getStore } = require('@netlify/blobs');

// V1 function blob config — required for legacy exports.handler functions
function blobStore(nameOrOpts) {
  const siteID = process.env.SITE_ID;
  const token = process.env.NF_API_TOKEN;
  if (!siteID || !token) {
    throw new Error('Blob config missing: SITE_ID=' + (siteID ? 'set' : 'UNSET') + ', NETLIFY_API_TOKEN=' + (token ? 'set' : 'UNSET'));
  }
  const cfg = { siteID, token, apiURL: 'https://api.netlify.com' };
  if (typeof nameOrOpts === 'string') return getStore({ name: nameOrOpts, ...cfg });
  return getStore({ ...nameOrOpts, ...cfg });
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
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

function githubRequest(method, urlPath, token, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'api.github.com',
      path: urlPath,
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'BellsFork-Inventory-Bot/1.0',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(data
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
          : {}),
      },
    };
    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, data: raw }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(event), body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders(event), body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const GITHUB_TOKEN      = process.env.GITHUB_TOKEN;
  const GITHUB_REPO_OWNER = process.env.GH_REPO_OWNER;
  const GITHUB_REPO_NAME  = process.env.GH_REPO_NAME;

  if (!GITHUB_TOKEN || !GITHUB_REPO_OWNER || !GITHUB_REPO_NAME) {
    return {
      statusCode: 500,
      headers: corsHeaders(event),
      body: JSON.stringify({ error: 'GitHub env vars not configured. Contact site admin.' }),
    };
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

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers: corsHeaders(event), body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const { auth } = body;
  if (!auth || !auth.user || !auth.passwordHash) {
    return { statusCode: 401, headers: corsHeaders(event), body: JSON.stringify({ error: 'Authentication required' }) };
  }
  if (!validateAuth(auth.user, auth.passwordHash, usersConfig)) {
    await new Promise(r => setTimeout(r, 600));
    return { statusCode: 401, headers: corsHeaders(event), body: JSON.stringify({ error: 'Invalid credentials' }) };
  }

  // Read staged inventory from Blobs
  let staged;
  const store = blobStore({ name: 'inventory', consistency: 'strong' });
  try {
    staged = await store.get('staged', { type: 'json' });
  } catch (err) {
    return {
      statusCode: 500,
      headers: corsHeaders(event),
      body: JSON.stringify({ error: 'Could not read staged inventory: ' + err.message }),
    };
  }

  if (!staged || !Array.isArray(staged.vehicles)) {
    return {
      statusCode: 404,
      headers: corsHeaders(event),
      body: JSON.stringify({ error: 'No staged inventory found. Please upload and stage first.' }),
    };
  }

  // Guard: reject stale staged data (older than 1 hour)
  if (staged._stagedAt) {
    const stagedAge = Date.now() - new Date(staged._stagedAt).getTime();
    if (stagedAge > 60 * 60 * 1000) {
      return {
        statusCode: 409,
        headers: corsHeaders(event),
        body: JSON.stringify({
          error: 'Staged inventory is stale (staged ' + Math.round(stagedAge / 60000) + ' minutes ago). Please re-stage before publishing.',
        }),
      };
    }
  }

  // Concurrent publish lock — use a simple blob lock with TTL
  const lockKey = 'publish-lock';
  try {
    const existingLock = await store.get(lockKey, { type: 'json' });
    if (existingLock) {
      const lockAge = Date.now() - new Date(existingLock.lockedAt).getTime();
      if (lockAge < 120000) { // Lock is still valid (2 minute TTL)
        return {
          statusCode: 409,
          headers: corsHeaders(event),
          body: JSON.stringify({
            error: 'Another publish is in progress (by ' + (existingLock.user || 'unknown') + '). Please wait and try again.',
          }),
        };
      }
      // Lock expired — safe to proceed
    }
  } catch {
    // No lock exists — safe to proceed
  }

  // Acquire lock
  try {
    await store.setJSON(lockKey, { user: auth.user, lockedAt: new Date().toISOString() });
  } catch {
    // Non-fatal — proceed anyway, lock is a best-effort guard
  }

  try {
    // Build the clean inventory.json to commit (strip staging metadata)
    const publishData = {
      lastUpdated: new Date().toISOString(),
      vehicles: staged.vehicles,
    };
    const jsonContent   = JSON.stringify(publishData, null, 2);
    const base64Content = Buffer.from(jsonContent).toString('base64');

    const filePath = `/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/contents/inventory.json`;

    // Get the current file SHA (required by GitHub API to update a file)
    const getResult = await githubRequest('GET', filePath, GITHUB_TOKEN);
    if (getResult.status !== 200) {
      return {
        statusCode: 502,
        headers: corsHeaders(event),
        body: JSON.stringify({
          error: `Could not fetch inventory.json from GitHub (HTTP ${getResult.status}). Check GITHUB_TOKEN and repo settings.`,
        }),
      };
    }
    const currentSHA = getResult.data.sha;

    // Commit the new inventory.json
    const commitMessage = `Update inventory — ${publishData.vehicles.length} vehicles (via admin by ${auth.user})`;
    const putResult = await githubRequest('PUT', filePath, GITHUB_TOKEN, {
      message: commitMessage,
      content: base64Content,
      sha: currentSHA,
      committer: { name: 'Bells Fork Admin', email: 'admin@bellsforktruckandauto.com' },
    });

    if (putResult.status !== 200 && putResult.status !== 201) {
      // GitHub SHA conflict means someone else committed in between — a race condition
      const isConflict = putResult.status === 409 || (putResult.data.message || '').includes('sha');
      return {
        statusCode: 502,
        headers: corsHeaders(event),
        body: JSON.stringify({
          error: isConflict
            ? 'Conflict: inventory.json was modified by another process. Please re-stage and try again.'
            : 'GitHub commit failed: ' + (putResult.data.message || `HTTP ${putResult.status}`),
        }),
      };
    }

    // Update "current" blob and clear the staged blob
    try {
      await store.setJSON('current', publishData);
      await store.delete('staged');
    } catch {
      // Non-fatal — the GitHub commit succeeded, site will rebuild
    }

    return {
      statusCode: 200,
      headers: { ...corsHeaders(event), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        count: publishData.vehicles.length,
        commitSha: putResult.data.commit?.sha,
        message: 'Inventory published! Netlify will rebuild the site in ~30 seconds.',
      }),
    };
  } finally {
    // Release the publish lock
    try {
      await store.delete(lockKey);
    } catch {
      // Best-effort — lock will expire naturally after TTL
    }
  }
};
