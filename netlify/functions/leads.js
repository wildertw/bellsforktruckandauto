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
const { blobStore } = require('../lib/blobStore');

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

// Retry helper for optimistic concurrency on the leads array.
// Reads the array, calls mutate(leads), writes back, and retries if
// a concurrent write happened between read and write.
const MAX_RETRIES = 3;
async function withLeadsLock(store, mutate) {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    let leads = await store.get('all', { type: 'json' });
    if (!Array.isArray(leads)) leads = [];
    const snapshot = JSON.stringify(leads);

    const result = await mutate(leads);

    // Re-read to detect concurrent modification before writing
    let check = await store.get('all', { type: 'json' });
    if (!Array.isArray(check)) check = [];
    if (JSON.stringify(check) !== snapshot) {
      console.warn(`[leads] Concurrent modification detected (attempt ${attempt + 1}/${MAX_RETRIES}), retrying...`);
      continue; // retry with fresh data
    }

    await store.setJSON('all', leads);
    return result;
  }
  throw new Error('Failed to save after ' + MAX_RETRIES + ' retries due to concurrent modifications');
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(event), body: '' };
  }

  const params = event.queryStringParameters || {};

  // Internal lead creation from tracker (no auth required, uses secret token)
  if (event.httpMethod === 'POST' && params.source === 'tracker') {
    const trackerSecret = process.env.TRACKER_LEAD_SECRET;
    if (!trackerSecret) {
      console.error('[leads] TRACKER_LEAD_SECRET env var not set — tracker endpoint disabled');
      return { statusCode: 503, headers: corsHeaders(event), body: JSON.stringify({ error: 'Tracker not configured' }) };
    }
    const providedSecret = (event.headers['x-tracker-secret'] || '');
    // Use timing-safe comparison for the tracker secret
    let secretValid = false;
    try {
      const a = Buffer.from(String(providedSecret));
      const b = Buffer.from(String(trackerSecret));
      secretValid = a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch { secretValid = false; }
    if (!secretValid) {
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

    // ─── GET — Download dealership PDF for a lead ──────────────────────────────
    // GET /.netlify/functions/leads?action=download-pdf&id=lead-xxx
    if (event.httpMethod === 'GET' && params.action === 'download-pdf' && params.id) {
      const lead = leads.find(function (l) { return l.id === params.id; });
      if (!lead) {
        return { statusCode: 404, headers: corsHeaders(event), body: JSON.stringify({ error: 'Lead not found' }) };
      }
      if (!lead.dealershipPdfKey) {
        return { statusCode: 404, headers: corsHeaders(event), body: JSON.stringify({ error: 'No dealership PDF for this lead' }) };
      }
      try {
        const pdfStore = blobStore({ name: 'lead-pdfs', consistency: 'strong' });
        const pdfBuffer = await pdfStore.get(lead.dealershipPdfKey, { type: 'arrayBuffer' });
        if (!pdfBuffer) {
          return { statusCode: 404, headers: corsHeaders(event), body: JSON.stringify({ error: 'PDF file not found in storage' }) };
        }
        const safeName = (lead.contactName || 'application').replace(/[^a-zA-Z0-9-_ ]/g, '').trim().replace(/\s+/g, '-') || 'application';
        return {
          statusCode: 200,
          headers: {
            ...corsHeaders(event),
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="bellsfork-financing-${safeName}.pdf"`,
          },
          body: Buffer.from(pdfBuffer).toString('base64'),
          isBase64Encoded: true,
        };
      } catch (err) {
        console.error('[leads] PDF download error:', err.message);
        return { statusCode: 500, headers: corsHeaders(event), body: JSON.stringify({ error: 'Failed to retrieve PDF' }) };
      }
    }

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
      try { body = JSON.parse(event.body || '{}'); } catch {
        return { statusCode: 400, headers: corsHeaders(event), body: JSON.stringify({ error: 'Invalid JSON' }) };
      }

      // Input validation
      const contactName = String(body.contactName || '').trim().slice(0, 200);
      const contactPhone = String(body.contactPhone || '').trim().slice(0, 30);
      const contactEmail = String(body.contactEmail || '').trim().slice(0, 254);
      const notes = String(body.notes || '').trim().slice(0, 2000);
      const statusVal = ['hot', 'warm', 'cold'].includes(body.status) ? body.status : 'cold';

      const now = Date.now();
      const lead = {
        id: generateId(),
        // Vehicle info
        stockNumber: String(body.stockNumber || '').trim().slice(0, 30),
        vehicleName: String(body.vehicleName || '').trim().slice(0, 200),
        vehiclePrice: body.vehiclePrice || null,
        vehicleUrl: String(body.vehicleUrl || '').trim().slice(0, 500),
        // Lead source
        source: String(body.source || 'general').slice(0, 50),
        sourcePage: String(body.sourcePage || '').trim().slice(0, 500),
        formType: String(body.formType || '').trim().slice(0, 80),
        formDisplayName: String(body.formDisplayName || '').trim().slice(0, 100),
        // Classification
        status: statusVal,
        outcome: 'active',
        // Contact info
        contactName: contactName,
        contactPhone: contactPhone,
        contactEmail: contactEmail,
        // Metadata
        visitorId: String(body.visitorId || '').trim().slice(0, 64),
        notes: notes,
        createdAt: now,
        statusChangedAt: now,
        convertedAt: null,
        lostAt: null,
        updatedBy: String(body.updatedBy || 'system').slice(0, 50),
      };

      try {
        await withLeadsLock(store, function (currentLeads) {
          currentLeads.push(lead);
        });
      } catch (retryErr) {
        // Fallback: append without lock check (better to save the lead than lose it)
        console.warn('[leads] Lock retry failed, saving directly:', retryErr.message);
        leads.push(lead);
        await store.setJSON('all', leads);
      }

      console.log('[leads] Created:', lead.id, contactName || '(no name)');

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
      try { body = JSON.parse(event.body || '{}'); } catch {
        return { statusCode: 400, headers: corsHeaders(event), body: JSON.stringify({ error: 'Invalid JSON' }) };
      }

      let updatedLead;
      try {
        await withLeadsLock(store, function (currentLeads) {
          const idx = currentLeads.findIndex(function (l) { return l.id === id; });
          if (idx === -1) {
            throw Object.assign(new Error('Lead not found'), { statusCode: 404 });
          }

          const lead = currentLeads[idx];
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
              lead.convertedAt = null;
              lead.lostAt = null;
            }
          }

          // Update contact info (with length limits)
          if (body.contactName !== undefined) lead.contactName = String(body.contactName).trim().slice(0, 200);
          if (body.contactPhone !== undefined) lead.contactPhone = String(body.contactPhone).trim().slice(0, 30);
          if (body.contactEmail !== undefined) lead.contactEmail = String(body.contactEmail).trim().slice(0, 254);
          if (body.notes !== undefined) lead.notes = String(body.notes).trim().slice(0, 2000);
          // Update vehicle/source info
          if (body.stockNumber !== undefined) lead.stockNumber = String(body.stockNumber).trim().slice(0, 30);
          if (body.vehicleName !== undefined) lead.vehicleName = String(body.vehicleName).trim().slice(0, 200);
          if (body.vehiclePrice !== undefined) lead.vehiclePrice = body.vehiclePrice;
          if (body.source !== undefined) lead.source = String(body.source).slice(0, 50);

          lead.updatedAt = now;
          lead.updatedBy = String(body.updatedBy || 'admin').slice(0, 50);

          currentLeads[idx] = lead;
          updatedLead = lead;
        });
      } catch (err) {
        if (err.statusCode === 404) {
          return { statusCode: 404, headers: corsHeaders(event), body: JSON.stringify({ error: 'Lead not found' }) };
        }
        throw err;
      }

      console.log('[leads] Updated:', id);

      return {
        statusCode: 200,
        headers: { ...corsHeaders(event), 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: true, lead: updatedLead }),
      };
    }

    // ─── DELETE — Remove lead ─────────────────────────────────────────────────
    if (event.httpMethod === 'DELETE') {
      const id = params.id;
      if (!id) {
        return { statusCode: 400, headers: corsHeaders(event), body: JSON.stringify({ error: 'Missing lead id' }) };
      }

      try {
        await withLeadsLock(store, function (currentLeads) {
          const initialLen = currentLeads.length;
          const filtered = currentLeads.filter(function (l) { return l.id !== id; });
          if (filtered.length === initialLen) {
            throw Object.assign(new Error('Lead not found'), { statusCode: 404 });
          }
          // Replace contents in-place so the reference used by withLeadsLock is updated
          currentLeads.length = 0;
          filtered.forEach(function (l) { currentLeads.push(l); });
        });
      } catch (err) {
        if (err.statusCode === 404) {
          return { statusCode: 404, headers: corsHeaders(event), body: JSON.stringify({ error: 'Lead not found' }) };
        }
        throw err;
      }

      console.log('[leads] Deleted:', id);

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
