/**
 * Bells Fork Auto & Truck — Analytics Tracking Function
 * POST /.netlify/functions/track
 *
 * Body: { type: "page_view"|"phone_click"|"form_submit", visitorId, page, ts, extra }
 * Stores daily aggregates in Netlify Blobs (site-analytics store).
 */

const { getStore } = require('@netlify/blobs');

// V1 function blob config — required for legacy exports.handler functions
function blobStore(nameOrOpts) {
  const siteID = process.env.SITE_ID;
  const token = process.env.NETLIFY_API_TOKEN;
  if (!siteID || !token) {
    throw new Error('Blob config missing: SITE_ID=' + (siteID ? 'set' : 'UNSET') + ', NETLIFY_API_TOKEN=' + (token ? 'set' : 'UNSET'));
  }
  const cfg = { siteID, token, apiURL: 'https://api.netlify.com' };
  if (typeof nameOrOpts === 'string') return getStore({ name: nameOrOpts, ...cfg });
  return getStore({ ...nameOrOpts, ...cfg });
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const VALID_TYPES = ['page_view', 'phone_click', 'form_submit'];
const MAX_UNIQUE_VISITORS = 10000;

function todayKey() {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return 'daily:' + yyyy + '-' + mm + '-' + dd;
}

function emptyDay() {
  return {
    pageViews: 0,
    uniqueVisitors: [],
    phoneClicks: 0,
    formSubmits: 0,
    pages: {},
  };
}

exports.handler = async (event) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { type, visitorId, page } = body;

  // Validate
  if (!type || !VALID_TYPES.includes(type)) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid event type' }) };
  }
  if (!visitorId || typeof visitorId !== 'string' || visitorId.length > 64) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid visitorId' }) };
  }

  try {
    const store = blobStore({ name: 'site-analytics', consistency: 'strong' });
    const key = todayKey();

    // Read current daily aggregate
    let daily = await store.get(key, { type: 'json' });
    if (!daily) {
      daily = emptyDay();
    }

    // Update based on event type
    switch (type) {
      case 'page_view':
        daily.pageViews++;
        // Track unique visitors
        if (!daily.uniqueVisitors.includes(visitorId) && daily.uniqueVisitors.length < MAX_UNIQUE_VISITORS) {
          daily.uniqueVisitors.push(visitorId);
        }
        // Track page breakdown
        if (page && typeof page === 'string') {
          const cleanPage = page.slice(0, 200); // Limit page path length
          daily.pages[cleanPage] = (daily.pages[cleanPage] || 0) + 1;
        }
        break;
      case 'phone_click':
        daily.phoneClicks++;
        break;
      case 'form_submit':
        daily.formSubmits++;
        break;
    }

    // Write back
    await store.setJSON(key, daily);

    return { statusCode: 204, headers: CORS, body: '' };
  } catch (err) {
    console.error('Track function error:', err);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Internal error' }) };
  }
};
