/**
 * Bells Fork Auto & Truck — Dashboard Statistics Function
 * GET /.netlify/functions/dashboard-stats?period=day|week|month
 *
 * Requires auth header: Authorization: Basic base64(user:passwordHash)
 * Returns aggregated analytics, inventory counts, and lead metrics.
 */

const crypto = require('crypto');
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

const FALLBACK_USERS = {
  frank: '8e0a49d96938eca5a973cb170f392fa6e117ac8e0bbae8f281f365d7fd3c4139',
  trey:  '8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918',
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function validateAuth(user, passwordHash) {
  let usersConfig = FALLBACK_USERS;
  try {
    const envUsers = process.env.INVENTORY_ADMIN_USERS;
    if (envUsers) usersConfig = JSON.parse(envUsers);
  } catch { /* fallback */ }

  const normalized = (user || '').trim().toLowerCase();
  const expected = usersConfig[normalized];
  if (!expected) return false;
  try {
    const provided = Buffer.from(String(passwordHash).toLowerCase());
    const exp = Buffer.from(String(expected).toLowerCase());
    if (provided.length !== exp.length) return false;
    return crypto.timingSafeEqual(provided, exp);
  } catch {
    return false;
  }
}

function dateKey(date) {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return 'daily:' + yyyy + '-' + mm + '-' + dd;
}

function dateStr(date) {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return yyyy + '-' + mm + '-' + dd;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // Auth check
  const authHeader = event.headers.authorization || event.headers.Authorization || '';
  let authUser = '';
  let authHash = '';
  if (authHeader.startsWith('Basic ')) {
    try {
      const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
      const colonIndex = decoded.indexOf(':');
      if (colonIndex > 0) {
        authUser = decoded.slice(0, colonIndex);
        authHash = decoded.slice(colonIndex + 1);
      }
    } catch { /* invalid */ }
  }

  if (!validateAuth(authUser, authHash)) {
    return {
      statusCode: 401,
      headers: CORS,
      body: JSON.stringify({ error: 'Unauthorized' }),
    };
  }

  // Determine period
  const params = event.queryStringParameters || {};
  const period = params.period || 'week';
  let daysBack;
  switch (period) {
    case 'day':   daysBack = 1;  break;
    case 'month': daysBack = 30; break;
    case 'week':
    default:      daysBack = 7;  break;
  }

  try {
    const analyticsStore = blobStore({ name: 'site-analytics', consistency: 'strong' });

    // Gather daily blobs for the period
    const now = new Date();
    const dailyBreakdown = [];
    let totalViews = 0;
    let totalPhoneClicks = 0;
    let totalFormSubmits = 0;
    const allVisitorIds = new Set();

    // Today's stats separately
    let todayViews = 0;
    let todayUniques = 0;
    let todayPhoneClicks = 0;
    let todayFormSubmits = 0;

    for (let i = 0; i < daysBack; i++) {
      const d = new Date(now.getTime() - i * 86400000);
      const key = dateKey(d);
      const daily = await analyticsStore.get(key, { type: 'json' });

      if (daily) {
        const views = daily.pageViews || 0;
        const uniques = (daily.uniqueVisitors || []).length;
        const calls = daily.phoneClicks || 0;
        const forms = daily.formSubmits || 0;

        totalViews += views;
        totalPhoneClicks += calls;
        totalFormSubmits += forms;
        (daily.uniqueVisitors || []).forEach(function (id) { allVisitorIds.add(id); });

        dailyBreakdown.push({
          date: dateStr(d),
          views: views,
          uniques: uniques,
          calls: calls,
          forms: forms,
        });

        if (i === 0) {
          todayViews = views;
          todayUniques = uniques;
          todayPhoneClicks = calls;
          todayFormSubmits = forms;
        }
      } else {
        dailyBreakdown.push({
          date: dateStr(d),
          views: 0,
          uniques: 0,
          calls: 0,
          forms: 0,
        });
      }
    }

    // Inventory counts — try inventory store first, then fall back to fetching JSON
    let carsInInventory = 0;
    let carsSold = 0;
    let carsPending = 0;
    let vehicles = [];

    const inventoryStore = blobStore('inventory');
    const currentInventory = await inventoryStore.get('current', { type: 'json' });

    if (currentInventory && currentInventory.vehicles) {
      vehicles = currentInventory.vehicles;
    } else {
      // Fall back to fetching inventory.json from the site
      try {
        const siteUrl = process.env.URL || 'https://bellsforktruckandauto.netlify.app';
        const res = await fetch(siteUrl + '/inventory.json');
        if (res.ok) {
          vehicles = await res.json();
          if (!Array.isArray(vehicles)) vehicles = [];
        }
      } catch { /* ignore */ }
    }

    vehicles.forEach(function (v) {
      const status = (v.status || '').toLowerCase();
      if (status === 'sold') carsSold++;
      else if (status === 'pending') carsPending++;
      else carsInInventory++;
    });

    // If no sold/pending, count all as in inventory
    if (carsInInventory === 0 && carsSold === 0 && carsPending === 0) {
      carsInInventory = vehicles.length;
    }

    const totalLeads = totalFormSubmits + totalPhoneClicks;

    const result = {
      visitors: {
        today: todayViews,
        period: totalViews,
      },
      uniqueVisitors: {
        today: todayUniques,
        period: allVisitorIds.size,
      },
      carsInInventory: carsInInventory,
      carsSold: carsSold,
      carsPending: carsPending,
      totalVehicles: vehicles.length,
      totalLeads: totalLeads,
      leadsFromWebsite: totalFormSubmits,
      callsFromWebsite: totalPhoneClicks,
      formsSubmitted: totalFormSubmits,
      todayCalls: todayPhoneClicks,
      todayForms: todayFormSubmits,
      period: period,
      daysBack: daysBack,
      dailyBreakdown: dailyBreakdown.reverse(), // oldest first for chart
    };

    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify(result),
    };
  } catch (err) {
    console.error('Dashboard stats error:', err);
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: 'Internal error' }),
    };
  }
};
