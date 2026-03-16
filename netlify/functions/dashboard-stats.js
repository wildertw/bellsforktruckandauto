/**
 * Bells Fork Truck & Auto — Dashboard Statistics Function
 * GET /.netlify/functions/dashboard-stats?period=day|week|month
 * GET /.netlify/functions/dashboard-stats?action=goals  (read goals)
 * POST /.netlify/functions/dashboard-stats?action=goals (save goals)
 *
 * Requires auth header: Authorization: Basic base64(user:passwordHash)
 * Returns aggregated analytics, inventory counts, lead metrics, and computed KPIs.
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
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin',
  };
}

function validateAuth(user, passwordHash) {
  let usersConfig;
  try {
    const envUsers = process.env.INVENTORY_ADMIN_USERS;
    if (!envUsers) return false;
    usersConfig = JSON.parse(envUsers);
  } catch {
    return false;
  }

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

function parseAuth(headers) {
  const authHeader = headers.authorization || headers.Authorization || '';
  let user = '';
  let hash = '';
  if (authHeader.startsWith('Basic ')) {
    try {
      const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
      const colonIndex = decoded.indexOf(':');
      if (colonIndex > 0) {
        user = decoded.slice(0, colonIndex);
        hash = decoded.slice(colonIndex + 1);
      }
    } catch { /* invalid */ }
  }
  return { user, hash };
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

// Aggregate daily blobs for a range of days ending at `endDate`
async function aggregatePeriod(analyticsStore, endDate, daysBack) {
  const dailyBreakdown = [];
  let totalViews = 0;
  let totalPhoneClicks = 0;
  let totalFormSubmits = 0;
  let totalPrequalifySubmits = 0;
  const allVisitorIds = new Set();

  // Enhanced aggregates
  const devices = { mobile: 0, desktop: 0, tablet: 0 };
  const referrers = { direct: 0, google: 0, facebook: 0, social: 0, other: 0 };
  const allNewVisitors = new Set();
  const allReturningVisitors = new Set();
  let totalBounces = 0;
  let totalSessions = 0;
  let totalSessionDuration = 0;
  const allVehicleViews = {};
  const allPages = {};

  let todayViews = 0;
  let todayUniques = 0;
  let todayPhoneClicks = 0;
  let todayFormSubmits = 0;
  let todayPrequalifySubmits = 0;

  for (let i = 0; i < daysBack; i++) {
    const d = new Date(endDate.getTime() - i * 86400000);
    const key = dateKey(d);
    const daily = await analyticsStore.get(key, { type: 'json' });

    if (daily) {
      const views = daily.pageViews || 0;
      const uniques = (daily.uniqueVisitors || []).length;
      const calls = daily.phoneClicks || 0;
      const forms = daily.formSubmits || 0;
      const prequalify = daily.prequalifySubmits || 0;

      totalViews += views;
      totalPhoneClicks += calls;
      totalFormSubmits += forms;
      totalPrequalifySubmits += prequalify;
      (daily.uniqueVisitors || []).forEach(function (id) { allVisitorIds.add(id); });

      // Enhanced field aggregation (backward compatible)
      if (daily.devices) {
        devices.mobile += daily.devices.mobile || 0;
        devices.desktop += daily.devices.desktop || 0;
        devices.tablet += daily.devices.tablet || 0;
      }
      if (daily.referrers) {
        Object.keys(referrers).forEach(function (k) {
          referrers[k] += (daily.referrers[k] || 0);
        });
      }
      (daily.newVisitors || []).forEach(function (id) { allNewVisitors.add(id); });
      (daily.returningVisitors || []).forEach(function (id) { allReturningVisitors.add(id); });
      totalBounces += daily.bounces || 0;
      totalSessions += daily.totalSessions || 0;
      totalSessionDuration += daily.totalSessionDuration || 0;

      // Merge vehicle views
      if (daily.vehicleViews) {
        Object.keys(daily.vehicleViews).forEach(function (stock) {
          allVehicleViews[stock] = (allVehicleViews[stock] || 0) + daily.vehicleViews[stock];
        });
      }

      // Merge page views
      if (daily.pages) {
        Object.keys(daily.pages).forEach(function (pg) {
          allPages[pg] = (allPages[pg] || 0) + daily.pages[pg];
        });
      }

      dailyBreakdown.push({
        date: dateStr(d),
        views: views,
        uniques: uniques,
        calls: calls,
        forms: forms,
        prequalify: prequalify,
      });

      if (i === 0) {
        todayViews = views;
        todayUniques = uniques;
        todayPhoneClicks = calls;
        todayFormSubmits = forms;
        todayPrequalifySubmits = prequalify;
      }
    } else {
      dailyBreakdown.push({
        date: dateStr(d),
        views: 0,
        uniques: 0,
        calls: 0,
        forms: 0,
        prequalify: 0,
      });
    }
  }

  return {
    totalViews, totalPhoneClicks, totalFormSubmits, totalPrequalifySubmits,
    uniqueVisitorCount: allVisitorIds.size,
    todayViews, todayUniques, todayPhoneClicks, todayFormSubmits, todayPrequalifySubmits,
    devices, referrers,
    newVisitorCount: allNewVisitors.size,
    returningVisitorCount: allReturningVisitors.size,
    totalBounces, totalSessions, totalSessionDuration,
    vehicleViews: allVehicleViews,
    topPages: allPages,
    dailyBreakdown,
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(event), body: '' };
  }

  // Auth check
  const { user: authUser, hash: authHash } = parseAuth(event.headers);
  if (!validateAuth(authUser, authHash)) {
    return { statusCode: 401, headers: corsHeaders(event), body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const params = event.queryStringParameters || {};

  // ─── Goals CRUD ──────────────────────────────────────────────────────────────
  if (params.action === 'goals') {
    try {
      const analyticsStore = blobStore({ name: 'site-analytics', consistency: 'strong' });
      const goalsKey = 'config:goals';

      if (event.httpMethod === 'GET') {
        const goals = await analyticsStore.get(goalsKey, { type: 'json' });
        return {
          statusCode: 200,
          headers: { ...corsHeaders(event), 'Content-Type': 'application/json' },
          body: JSON.stringify(goals || {
            monthlyLeads: 50,
            monthlyVisitors: 500,
            targetDaysOnLot: 30,
            targetConversionRate: 5,
          }),
        };
      }

      if (event.httpMethod === 'POST') {
        let body;
        try { body = JSON.parse(event.body); } catch {
          return { statusCode: 400, headers: corsHeaders(event), body: JSON.stringify({ error: 'Invalid JSON' }) };
        }
        const goals = {
          monthlyLeads: Number(body.monthlyLeads) || 50,
          monthlyVisitors: Number(body.monthlyVisitors) || 500,
          targetDaysOnLot: Number(body.targetDaysOnLot) || 30,
          targetConversionRate: Number(body.targetConversionRate) || 5,
          updatedAt: new Date().toISOString(),
          updatedBy: authUser,
        };
        await analyticsStore.setJSON(goalsKey, goals);
        return {
          statusCode: 200,
          headers: { ...corsHeaders(event), 'Content-Type': 'application/json' },
          body: JSON.stringify(goals),
        };
      }

      return { statusCode: 405, headers: corsHeaders(event), body: JSON.stringify({ error: 'Method not allowed' }) };
    } catch (err) {
      console.error('Goals error:', err);
      return { statusCode: 500, headers: corsHeaders(event), body: JSON.stringify({ error: 'Internal error' }) };
    }
  }

  // ─── Reset Analytics (wipe all daily KPI data, preserve inventory & goals) ──
  if (params.action === 'reset') {
    if (event.httpMethod !== 'POST' && event.httpMethod !== 'DELETE') {
      return { statusCode: 405, headers: corsHeaders(event), body: JSON.stringify({ error: 'Use POST or DELETE for reset' }) };
    }
    try {
      const analyticsStore = blobStore({ name: 'site-analytics', consistency: 'strong' });
      const salesStore = blobStore({ name: 'sales-records', consistency: 'strong' });

      // List and delete all daily:* analytics keys (preserve config:goals)
      let deletedCount = 0;
      const listed = await analyticsStore.list();
      const blobs = (listed && listed.blobs) ? listed.blobs : [];
      for (const blob of blobs) {
        const key = blob.key || blob;
        if (typeof key === 'string' && key.startsWith('daily:')) {
          await analyticsStore.delete(key);
          deletedCount++;
        }
      }

      // Reset sales records (cars sold counter) — inventory is NOT touched
      await salesStore.setJSON('all', []);

      return {
        statusCode: 200,
        headers: { ...corsHeaders(event), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ok: true,
          message: 'Analytics data wiped. Inventory preserved.',
          deletedDailyKeys: deletedCount,
          resetBy: authUser,
          resetAt: new Date().toISOString(),
        }),
      };
    } catch (err) {
      console.error('Reset error:', err);
      return { statusCode: 500, headers: corsHeaders(event), body: JSON.stringify({ error: 'Reset failed: ' + err.message }) };
    }
  }

  // ─── Stats Aggregation ──────────────────────────────────────────────────────
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: corsHeaders(event), body: JSON.stringify({ error: 'Method not allowed' }) };
  }

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
    const now = new Date();

    // Current period aggregation
    const current = await aggregatePeriod(analyticsStore, now, daysBack);

    // Previous period aggregation (for trend comparison)
    const prevEnd = new Date(now.getTime() - daysBack * 86400000);
    const prev = await aggregatePeriod(analyticsStore, prevEnd, daysBack);

    // Inventory counts
    let carsInInventory = 0;
    let carsSold = 0;
    let carsPending = 0;
    let vehicles = [];

    const inventoryStore = blobStore('inventory');
    const currentInventory = await inventoryStore.get('current', { type: 'json' });

    if (currentInventory && currentInventory.vehicles) {
      vehicles = currentInventory.vehicles;
    } else {
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

    if (carsInInventory === 0 && carsSold === 0 && carsPending === 0) {
      carsInInventory = vehicles.length;
    }

    const totalLeads = current.totalFormSubmits + current.totalPhoneClicks + current.totalPrequalifySubmits;
    const prevTotalLeads = prev.totalFormSubmits + prev.totalPhoneClicks + prev.totalPrequalifySubmits;

    // Computed metrics
    const conversionRate = current.uniqueVisitorCount > 0
      ? (totalLeads / current.uniqueVisitorCount) * 100 : 0;
    const bounceRate = current.totalSessions > 0
      ? (current.totalBounces / current.totalSessions) * 100 : 0;
    const avgSessionDuration = current.totalSessions > 0
      ? Math.round(current.totalSessionDuration / current.totalSessions) : 0;

    // Previous period computed metrics for comparison
    const prevConversionRate = prev.uniqueVisitorCount > 0
      ? (prevTotalLeads / prev.uniqueVisitorCount) * 100 : 0;
    const prevBounceRate = prev.totalSessions > 0
      ? (prev.totalBounces / prev.totalSessions) * 100 : 0;

    // Inventory analytics
    const nowMs = Date.now();
    let totalDaysOnLot = 0;
    let daysOnLotCount = 0;
    const categoryBreakdown = {};
    let totalInventoryValue = 0;

    vehicles.forEach(function (v) {
      const status = (v.status || '').toLowerCase();
      const cat = v.type || v.category || 'Other';
      if (!categoryBreakdown[cat]) {
        categoryBreakdown[cat] = { count: 0, available: 0, sold: 0, pending: 0, totalValue: 0, totalViews: 0 };
      }
      categoryBreakdown[cat].count++;
      if (status === 'sold') categoryBreakdown[cat].sold++;
      else if (status === 'pending') categoryBreakdown[cat].pending++;
      else categoryBreakdown[cat].available++;

      const price = Number(v.price) || 0;
      categoryBreakdown[cat].totalValue += price;

      if (status !== 'sold') {
        totalInventoryValue += price;
        if (v.dateAdded) {
          const added = new Date(v.dateAdded).getTime();
          if (added > 0) {
            totalDaysOnLot += Math.floor((nowMs - added) / 86400000);
            daysOnLotCount++;
          }
        }
      }

      // Cross-reference vehicle views
      const stockNum = v.stockNumber || v.sku || '';
      if (stockNum && current.vehicleViews[stockNum]) {
        categoryBreakdown[cat].totalViews += current.vehicleViews[stockNum];
      }
    });

    const avgDaysOnLot = daysOnLotCount > 0 ? Math.round(totalDaysOnLot / daysOnLotCount) : 0;

    // Top viewed vehicles (cross-reference vehicleViews with inventory)
    const topViewedVehicles = Object.entries(current.vehicleViews)
      .sort(function (a, b) { return b[1] - a[1]; })
      .slice(0, 10)
      .map(function (entry) {
        const v = vehicles.find(function (veh) {
          return (veh.stockNumber || veh.sku || '') === entry[0];
        });
        return {
          stockNumber: entry[0],
          views: entry[1],
          name: v ? [v.year, v.make, v.model].filter(Boolean).join(' ') : entry[0],
          price: v ? v.price : null,
          status: v ? v.status : null,
        };
      });

    // Classify leads by page context
    // We approximate using the phone/form counts that occurred on different page types
    // Since we don't have per-lead page data in the aggregate, use vehicleViews as a proxy
    const totalVehiclePageViews = Object.values(current.vehicleViews).reduce(function (s, v) { return s + v; }, 0);
    const inventoryPageViews = (current.topPages['/inventory'] || 0) + (current.topPages['/inventory.html'] || 0);
    const totalPageViews = current.totalViews || 1;
    const vdpPct = totalPageViews > 0 ? totalVehiclePageViews / totalPageViews : 0;
    const invPct = totalPageViews > 0 ? inventoryPageViews / totalPageViews : 0;
    const leadsBySource = {
      hot: Math.round(totalLeads * Math.min(vdpPct, 0.6)),
      warm: Math.round(totalLeads * Math.min(invPct, 0.3)),
      cold: 0,
    };
    leadsBySource.cold = Math.max(0, totalLeads - leadsBySource.hot - leadsBySource.warm);

    // Sort top pages
    const sortedPages = Object.entries(current.topPages)
      .sort(function (a, b) { return b[1] - a[1]; })
      .slice(0, 15);
    const topPagesObj = {};
    sortedPages.forEach(function (entry) { topPagesObj[entry[0]] = entry[1]; });

    const result = {
      // Core metrics (existing)
      visitors: { today: current.todayViews, period: current.totalViews },
      uniqueVisitors: { today: current.todayUniques, period: current.uniqueVisitorCount },
      carsInInventory: carsInInventory,
      carsSold: carsSold,
      carsPending: carsPending,
      totalVehicles: vehicles.length,
      totalLeads: totalLeads,
      leadsFromWebsite: current.totalFormSubmits,
      callsFromWebsite: current.totalPhoneClicks,
      formsSubmitted: current.totalFormSubmits,
      prequalifySubmitted: current.totalPrequalifySubmits,
      todayCalls: current.todayPhoneClicks,
      todayForms: current.todayFormSubmits,
      todayPrequalify: current.todayPrequalifySubmits,
      period: period,
      daysBack: daysBack,
      dailyBreakdown: current.dailyBreakdown.reverse(), // oldest first for chart

      // New computed metrics
      conversionRate: Math.round(conversionRate * 10) / 10,
      bounceRate: Math.round(bounceRate * 10) / 10,
      avgSessionDuration: avgSessionDuration,
      newVsReturning: {
        new: current.newVisitorCount,
        returning: current.returningVisitorCount,
      },
      deviceSplit: current.devices,
      referrerSplit: current.referrers,

      // Lead analytics
      leadsBySource: leadsBySource,

      // Inventory analytics
      avgDaysOnLot: avgDaysOnLot,
      totalInventoryValue: totalInventoryValue,
      categoryBreakdown: categoryBreakdown,
      topViewedVehicles: topViewedVehicles,

      // Top pages (aggregated across period)
      topPages: topPagesObj,

      // Previous period for trend comparison
      previousPeriod: {
        visitors: prev.totalViews,
        uniqueVisitors: prev.uniqueVisitorCount,
        totalLeads: prevTotalLeads,
        conversionRate: Math.round(prevConversionRate * 10) / 10,
        bounceRate: Math.round(prevBounceRate * 10) / 10,
        phoneClicks: prev.totalPhoneClicks,
        formSubmits: prev.totalFormSubmits,
        prequalifySubmits: prev.totalPrequalifySubmits,
      },
    };

    return {
      statusCode: 200,
      headers: { ...corsHeaders(event), 'Content-Type': 'application/json' },
      body: JSON.stringify(result),
    };
  } catch (err) {
    console.error('Dashboard stats error:', err);
    return {
      statusCode: 500,
      headers: corsHeaders(event),
      body: JSON.stringify({ error: 'Internal error' }),
    };
  }
};
