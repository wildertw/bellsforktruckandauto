/**
 * Bells Fork Auto & Truck — Inventory Publish Function
 * POST /.netlify/functions/inventory-publish
 *
 * Body: { auth: { user, passwordHash } }
 * Reads staged inventory from Netlify Blobs, commits it to GitHub as inventory.json.
 * The GitHub commit triggers Netlify to auto-rebuild and deploy the site.
 *
 * Required Netlify env vars:
 *   GITHUB_TOKEN       — Personal Access Token with "Contents: Read & Write" on the repo
 *   GITHUB_REPO_OWNER  — GitHub username or org (e.g. wildertw)
 *   GITHUB_REPO_NAME   — Repository name (e.g. bellsforktruckandauto)
 *
 * Optional:
 *   INVENTORY_ADMIN_USERS — JSON: {"frank":"<sha256>","trey":"<sha256>"}
 */

const crypto = require('crypto');
const https  = require('https');
const { getStore } = require('@netlify/blobs');

const FALLBACK_USERS = {
  frank: '8e0a49d96938eca5a973cb170f392fa6e117ac8e0bbae8f281f365d7fd3c4139',
  trey:  '8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918',
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
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
    return { statusCode: 200, headers: CORS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const GITHUB_TOKEN      = process.env.GITHUB_TOKEN;
  const GITHUB_REPO_OWNER = process.env.GH_REPO_OWNER;
  const GITHUB_REPO_NAME  = process.env.GH_REPO_NAME;

  if (!GITHUB_TOKEN || !GITHUB_REPO_OWNER || !GITHUB_REPO_NAME) {
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: 'GitHub env vars not configured. Contact site admin.' }),
    };
  }

  let usersConfig;
  try {
    usersConfig = { ...FALLBACK_USERS, ...JSON.parse(process.env.INVENTORY_ADMIN_USERS || '{}') };
  } catch {
    usersConfig = { ...FALLBACK_USERS };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const { auth } = body;
  if (!auth || !auth.user || !auth.passwordHash) {
    return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Authentication required' }) };
  }
  if (!validateAuth(auth.user, auth.passwordHash, usersConfig)) {
    await new Promise(r => setTimeout(r, 600));
    return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Invalid credentials' }) };
  }

  // Read staged inventory from Blobs
  let staged;
  try {
    const store = getStore({ name: 'inventory', consistency: 'strong' });
    staged = await store.get('staged', { type: 'json' });
  } catch (err) {
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: 'Could not read staged inventory: ' + err.message }),
    };
  }

  if (!staged || !Array.isArray(staged.vehicles)) {
    return {
      statusCode: 404,
      headers: CORS,
      body: JSON.stringify({ error: 'No staged inventory found. Please upload and stage first.' }),
    };
  }

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
      headers: CORS,
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
    committer: { name: 'Bells Fork Admin', email: 'admin@bellsforkautoandtruck.com' },
  });

  if (putResult.status !== 200 && putResult.status !== 201) {
    return {
      statusCode: 502,
      headers: CORS,
      body: JSON.stringify({
        error: 'GitHub commit failed: ' + (putResult.data.message || `HTTP ${putResult.status}`),
      }),
    };
  }

  // Update "current" blob and clear the staged blob
  try {
    const store = getStore({ name: 'inventory', consistency: 'strong' });
    await store.setJSON('current', publishData);
    await store.delete('staged');
  } catch {
    // Non-fatal — the GitHub commit succeeded, site will rebuild
  }

  return {
    statusCode: 200,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ok: true,
      count: publishData.vehicles.length,
      commitSha: putResult.data.commit?.sha,
      message: 'Inventory published! Netlify will rebuild the site in ~30 seconds.',
    }),
  };
};
