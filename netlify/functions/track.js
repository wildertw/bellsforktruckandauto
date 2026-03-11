/**
 * Bells Fork Truck & Auto — Analytics Tracking Function
 * POST /.netlify/functions/track
 *
 * Body: { type, visitorId, sessionId, page, ts, extra }
 * Event types: page_view, phone_click, form_submit, session_start, session_end
 * Stores daily aggregates in Netlify Blobs (site-analytics store).
 */

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

const VALID_TYPES = ['page_view', 'phone_click', 'form_submit', 'session_start', 'session_end'];
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
    // Enhanced tracking fields
    devices: { mobile: 0, desktop: 0, tablet: 0 },
    referrers: { direct: 0, google: 0, facebook: 0, social: 0, other: 0 },
    newVisitors: [],
    returningVisitors: [],
    bounces: 0,
    totalSessions: 0,
    totalSessionDuration: 0,
    vehicleViews: {},
  };
}

// Ensure all enhanced fields exist on a daily blob (backward compat with old data)
function ensureFields(daily) {
  if (!daily.devices) daily.devices = { mobile: 0, desktop: 0, tablet: 0 };
  if (!daily.referrers) daily.referrers = { direct: 0, google: 0, facebook: 0, social: 0, other: 0 };
  if (!daily.newVisitors) daily.newVisitors = [];
  if (!daily.returningVisitors) daily.returningVisitors = [];
  if (daily.bounces == null) daily.bounces = 0;
  if (daily.totalSessions == null) daily.totalSessions = 0;
  if (daily.totalSessionDuration == null) daily.totalSessionDuration = 0;
  if (!daily.vehicleViews) daily.vehicleViews = {};
  return daily;
}

exports.handler = async (event) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(event), body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders(event), body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers: corsHeaders(event), body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { type, visitorId, page } = body;
  const extra = body.extra || {};

  // Validate
  if (!type || !VALID_TYPES.includes(type)) {
    return { statusCode: 400, headers: corsHeaders(event), body: JSON.stringify({ error: 'Invalid event type' }) };
  }
  if (!visitorId || typeof visitorId !== 'string' || visitorId.length > 64) {
    return { statusCode: 400, headers: corsHeaders(event), body: JSON.stringify({ error: 'Invalid visitorId' }) };
  }

  try {
    const store = blobStore({ name: 'site-analytics', consistency: 'strong' });
    const key = todayKey();

    // Read current daily aggregate
    let daily = await store.get(key, { type: 'json' });
    if (!daily) {
      daily = emptyDay();
    } else {
      ensureFields(daily);
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
          const cleanPage = page.slice(0, 200);
          daily.pages[cleanPage] = (daily.pages[cleanPage] || 0) + 1;
        }
        // Track vehicle detail page views
        if (extra.stockNumber && typeof extra.stockNumber === 'string') {
          const stockKey = extra.stockNumber.slice(0, 20);
          daily.vehicleViews[stockKey] = (daily.vehicleViews[stockKey] || 0) + 1;
        }
        break;

      case 'phone_click':
        daily.phoneClicks++;
        break;

      case 'form_submit':
        daily.formSubmits++;
        break;

      case 'session_start':
        daily.totalSessions++;
        // Track device type
        if (extra.device && daily.devices.hasOwnProperty(extra.device)) {
          daily.devices[extra.device]++;
        }
        // Track referrer source
        if (extra.referrer && daily.referrers.hasOwnProperty(extra.referrer)) {
          daily.referrers[extra.referrer]++;
        }
        // Track new vs returning
        if (extra.isNew) {
          if (!daily.newVisitors.includes(visitorId) && daily.newVisitors.length < MAX_UNIQUE_VISITORS) {
            daily.newVisitors.push(visitorId);
          }
        } else {
          if (!daily.returningVisitors.includes(visitorId) && daily.returningVisitors.length < MAX_UNIQUE_VISITORS) {
            daily.returningVisitors.push(visitorId);
          }
        }
        break;

      case 'session_end':
        // Bounce detection: session with only 1 page view
        if (extra.pageCount != null && Number(extra.pageCount) <= 1) {
          daily.bounces++;
        }
        // Session duration (in seconds)
        if (extra.duration != null && Number(extra.duration) > 0) {
          daily.totalSessionDuration += Math.min(Number(extra.duration), 3600); // cap at 1 hour
        }
        break;
    }

    // Write back
    await store.setJSON(key, daily);

    return { statusCode: 204, headers: corsHeaders(event), body: '' };
  } catch (err) {
    console.error('Track function error:', err);
    return { statusCode: 500, headers: corsHeaders(event), body: JSON.stringify({ error: 'Internal error' }) };
  }
};
