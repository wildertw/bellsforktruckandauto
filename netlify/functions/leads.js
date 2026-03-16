/**
 * Bells Fork Truck & Auto — Lead Management Function
 *
 * GET  /.netlify/functions/leads                    — list all leads (with auto-decay)
 * GET  /.netlify/functions/leads?status=hot         — filter by status
 * GET  /.netlify/functions/leads?outcome=active     — filter by outcome
 * POST /.netlify/functions/leads                    — create a new lead
 * PUT  /.netlify/functions/leads?id=xxx             — update lead (status, outcome, notes)
 * DELETE /.netlify/functions/leads?id=xxx           — delete a lead
 *
 * Auth: same as dashboard-stats (Basic base64(user:hash))
 *
 * Auto-decay rules (applied on every read):
 *   Hot  → Warm  after 7 days with no action
 *   Warm → Cold  after 30 days with no action
 */

const crypto = require('crypto');
const { getStore } = require('@netlify/blobs');

function blobStore(nameOrOpts) {
  const siteID = process.env.SITE_ID;
  const token = process.env.NF_API_TOKEN;
  if (!siteID || !token) {
    throw new Error('Blob config missing');
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
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
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
  } catch { return false; }

  const normalized = (user || '').trim().toLowerCase();
  const expected = usersConfig[normalized];
  if (!expected) return false;
  try {
    const provided = Buffer.from(String(passwordHash).toLowerCase());
    const exp = Buffer.from(String(expected).toLowerCase());
    if (provided.length !== exp.length) return false;
    return crypto.timingSafeEqual(provided, exp);
  } catch { return false; }
}

function parseAuth(headers) {
  const authHeader = headers.authorization || headers.Authorization || '';
  let user = '', hash = '';
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

// Generate a short unique ID
function generateId() {
  return 'lead-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
}

// Auto-decay: update status based on time since last status change
// Hot → Warm after 7 days, Warm → Cold after 30 days
function applyDecay(leads) {
  const now = Date.now();
  const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
  const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
  let changed = false;

  leads.forEach(function (lead) {
    if (lead.outcome !== 'active') return; // only decay active leads
    const elapsed = now - (lead.statusChangedAt || lead.createdAt);

    if (lead.status === 'hot' && elapsed >= SEVEN_DAYS) {
      lead.status = 'warm';
      lead.statusChangedAt = now;
      lead.decayedFrom = 'hot';
      changed = true;
    } else if (lead.status === 'warm' && elapsed >= THIRTY_DAYS) {
      lead.status = 'cold';
      lead.statusChangedAt = now;
      lead.decayedFrom = 'warm';
      changed = true;
    }
  });

  return changed;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(event), body: '' };
  }

  const params = event.queryStringParameters || {};

  // Internal lead creation from tracker (no auth required, uses secret token)
  if (event.httpMethod === 'POST' && params.source === 'tracker') {
    const trackerSecret = process.env.TRACKER_LEAD_SECRET || 'bf-tracker-internal';
    const providedSecret = (event.headers['x-tracker-secret'] || '');
    if (providedSecret !== trackerSecret) {
      return { statusCode: 403, headers: corsHeaders(event), body: JSON.stringify({ error: 'Forbidden' }) };
    }
  } else {
    // All other requests require dashboard auth
    const { user, hash } = parseAuth(event.headers);
    if (!validateAuth(user, hash)) {
      return { statusCode: 401, headers: corsHeaders(event), body: JSON.stringify({ error: 'Unauthorized' }) };
    }
  }

  try {
    const store = blobStore({ name: 'leads-db', consistency: 'strong' });
    let leads = await store.get('all', { type: 'json' });
    if (!Array.isArray(leads)) leads = [];

    // ─── GET — List leads ─────────────────────────────────────────────────────
    if (event.httpMethod === 'GET') {
      // Apply auto-decay
      const decayed = applyDecay(leads);
      if (decayed) {
        await store.setJSON('all', leads);
      }

      // Filter
      let filtered = leads;
      if (params.status) {
        filtered = filtered.filter(function (l) { return l.status === params.status; });
      }
      if (params.outcome) {
        filtered = filtered.filter(function (l) { return l.outcome === params.outcome; });
      }

      // Sort: active first, then by createdAt descending
      filtered.sort(function (a, b) {
        if (a.outcome === 'active' && b.outcome !== 'active') return -1;
        if (a.outcome !== 'active' && b.outcome === 'active') return 1;
        return (b.createdAt || 0) - (a.createdAt || 0);
      });

      // Summary counts
      const summary = {
        total: leads.length,
        active: leads.filter(function (l) { return l.outcome === 'active'; }).length,
        converted: leads.filter(function (l) { return l.outcome === 'converted'; }).length,
        lost: leads.filter(function (l) { return l.outcome === 'lost'; }).length,
        hot: leads.filter(function (l) { return l.status === 'hot' && l.outcome === 'active'; }).length,
        warm: leads.filter(function (l) { return l.status === 'warm' && l.outcome === 'active'; }).length,
        cold: leads.filter(function (l) { return l.status === 'cold' && l.outcome === 'active'; }).length,
      };

      return {
        statusCode: 200,
        headers: { ...corsHeaders(event), 'Content-Type': 'application/json' },
        body: JSON.stringify({ leads: filtered, summary: summary }),
      };
    }

    // ─── POST — Create lead ───────────────────────────────────────────────────
    if (event.httpMethod === 'POST') {
      let body;
      try { body = JSON.parse(event.body); } catch {
        return { statusCode: 400, headers: corsHeaders(event), body: JSON.stringify({ error: 'Invalid JSON' }) };
      }

      const now = Date.now();
      const lead = {
        id: generateId(),
        // Vehicle info
        stockNumber: body.stockNumber || '',
        vehicleName: body.vehicleName || '',
        vehiclePrice: body.vehiclePrice || null,
        vehicleUrl: body.vehicleUrl || '',
        // Lead source
        source: body.source || 'general',       // 'phone', 'form', 'prequalify'
        sourcePage: body.sourcePage || '',        // page URL where lead originated
        // Classification
        status: body.status || 'cold',           // 'hot', 'warm', 'cold'
        outcome: 'active',                        // 'active', 'converted', 'lost'
        // Contact info (if available)
        contactName: body.contactName || '',
        contactPhone: body.contactPhone || '',
        contactEmail: body.contactEmail || '',
        // Metadata
        visitorId: body.visitorId || '',
        notes: body.notes || '',
        createdAt: now,
        statusChangedAt: now,
        convertedAt: null,
        lostAt: null,
        updatedBy: body.updatedBy || 'system',
      };

      leads.push(lead);
      await store.setJSON('all', leads);

      return {
        statusCode: 201,
        headers: { ...corsHeaders(event), 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: true, lead: lead }),
      };
    }

    // ─── PUT — Update lead ────────────────────────────────────────────────────
    if (event.httpMethod === 'PUT') {
      const id = params.id;
      if (!id) {
        return { statusCode: 400, headers: corsHeaders(event), body: JSON.stringify({ error: 'Missing lead id' }) };
      }

      let body;
      try { body = JSON.parse(event.body); } catch {
        return { statusCode: 400, headers: corsHeaders(event), body: JSON.stringify({ error: 'Invalid JSON' }) };
      }

      const idx = leads.findIndex(function (l) { return l.id === id; });
      if (idx === -1) {
        return { statusCode: 404, headers: corsHeaders(event), body: JSON.stringify({ error: 'Lead not found' }) };
      }

      const lead = leads[idx];
      const now = Date.now();

      // Update status
      if (body.status && ['hot', 'warm', 'cold'].includes(body.status) && body.status !== lead.status) {
        lead.status = body.status;
        lead.statusChangedAt = now;
      }

      // Update outcome
      if (body.outcome && ['active', 'converted', 'lost'].includes(body.outcome)) {
        lead.outcome = body.outcome;
        if (body.outcome === 'converted') {
          lead.convertedAt = now;
          lead.lostAt = null;
        } else if (body.outcome === 'lost') {
          lead.lostAt = now;
          lead.convertedAt = null;
        } else {
          // Re-activated
          lead.convertedAt = null;
          lead.lostAt = null;
        }
      }

      // Update contact info
      if (body.contactName !== undefined) lead.contactName = body.contactName;
      if (body.contactPhone !== undefined) lead.contactPhone = body.contactPhone;
      if (body.contactEmail !== undefined) lead.contactEmail = body.contactEmail;
      if (body.notes !== undefined) lead.notes = body.notes;

      lead.updatedAt = now;
      lead.updatedBy = body.updatedBy || 'admin';

      leads[idx] = lead;
      await store.setJSON('all', leads);

      return {
        statusCode: 200,
        headers: { ...corsHeaders(event), 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: true, lead: lead }),
      };
    }

    // ─── DELETE — Remove lead ─────────────────────────────────────────────────
    if (event.httpMethod === 'DELETE') {
      const id = params.id;
      if (!id) {
        return { statusCode: 400, headers: corsHeaders(event), body: JSON.stringify({ error: 'Missing lead id' }) };
      }

      const initialLen = leads.length;
      leads = leads.filter(function (l) { return l.id !== id; });

      if (leads.length === initialLen) {
        return { statusCode: 404, headers: corsHeaders(event), body: JSON.stringify({ error: 'Lead not found' }) };
      }

      await store.setJSON('all', leads);

      return {
        statusCode: 200,
        headers: { ...corsHeaders(event), 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: true, deleted: id }),
      };
    }

    return { statusCode: 405, headers: corsHeaders(event), body: JSON.stringify({ error: 'Method not allowed' }) };
  } catch (err) {
    console.error('Leads function error:', err);
    return { statusCode: 500, headers: corsHeaders(event), body: JSON.stringify({ error: 'Internal error' }) };
  }
};
