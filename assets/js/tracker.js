/**
 * Bells Fork Auto & Truck — Site Analytics Tracker
 * Tracks page views, phone link clicks, form submissions,
 * session lifecycle (start/end), device type, referrer, and new/returning visitors.
 * Sends events to /.netlify/functions/track via navigator.sendBeacon.
 */
(function () {
  'use strict';

  var ENDPOINT = '/.netlify/functions/track';
  var VID_KEY = 'bf_visitor_id';
  var FIRST_VISIT_KEY = 'bf_first_visit';
  var SESSION_KEY = 'bf_session_id';
  var SESSION_START_KEY = 'bf_session_start';
  var SESSION_PAGES_KEY = 'bf_session_pages';

  // Generate or retrieve persistent anonymous visitor ID
  function getVisitorId() {
    var id = null;
    try { id = localStorage.getItem(VID_KEY); } catch (e) { /* private browsing */ }
    if (!id) {
      id = typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : 'v-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      try { localStorage.setItem(VID_KEY, id); } catch (e) { /* ignore */ }
    }
    return id;
  }

  // Generate or retrieve session ID (per browser session via sessionStorage)
  function getSessionId() {
    var id = null;
    try { id = sessionStorage.getItem(SESSION_KEY); } catch (e) { /* ignore */ }
    if (!id) {
      id = typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : 's-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      try { sessionStorage.setItem(SESSION_KEY, id); } catch (e) { /* ignore */ }
    }
    return id;
  }

  // Detect device type from viewport width
  function getDeviceType() {
    var w = window.innerWidth || document.documentElement.clientWidth || 1024;
    if (w < 768) return 'mobile';
    if (w < 1024) return 'tablet';
    return 'desktop';
  }

  // Parse document.referrer into a category
  function getReferrerCategory() {
    var ref = document.referrer || '';
    if (!ref) return 'direct';
    try {
      var host = new URL(ref).hostname.toLowerCase();
      if (host === location.hostname) return 'direct'; // internal navigation
      if (host.indexOf('google') !== -1) return 'google';
      if (host.indexOf('facebook') !== -1 || host.indexOf('fb.com') !== -1) return 'facebook';
      if (host.indexOf('instagram') !== -1 || host.indexOf('twitter') !== -1 ||
          host.indexOf('x.com') !== -1 || host.indexOf('tiktok') !== -1 ||
          host.indexOf('youtube') !== -1 || host.indexOf('linkedin') !== -1) return 'social';
      return 'other';
    } catch (e) {
      return 'other';
    }
  }

  // Check if this is a new or returning visitor
  function isNewVisitor() {
    try {
      var visited = localStorage.getItem(FIRST_VISIT_KEY);
      if (!visited) {
        localStorage.setItem(FIRST_VISIT_KEY, Date.now().toString());
        return true;
      }
      return false;
    } catch (e) {
      return true; // private browsing, treat as new
    }
  }

  // Detect VDP (vehicle detail page) and extract stock number
  function getStockNumber() {
    var path = location.pathname;
    // Pattern: /vdp/STOCK/... or /inventory.html with hash
    var vdpMatch = path.match(/\/vdp\/([^/]+)/);
    if (vdpMatch) return vdpMatch[1];
    // Check for inventory page with hash-based vehicle selection
    if (path.indexOf('/inventory') !== -1 && location.hash) {
      var hashMatch = location.hash.match(/#([A-Z0-9-]+)/i);
      if (hashMatch) return hashMatch[1];
    }
    return null;
  }

  // Track page count within this session
  function incrementPageCount() {
    try {
      var count = parseInt(sessionStorage.getItem(SESSION_PAGES_KEY) || '0', 10);
      count++;
      sessionStorage.setItem(SESSION_PAGES_KEY, String(count));
      return count;
    } catch (e) {
      return 1;
    }
  }

  function getPageCount() {
    try {
      return parseInt(sessionStorage.getItem(SESSION_PAGES_KEY) || '0', 10);
    } catch (e) {
      return 0;
    }
  }

  var visitorId = getVisitorId();
  var sessionId = getSessionId();

  function send(type, extra) {
    var payload = JSON.stringify({
      type: type,
      visitorId: visitorId,
      sessionId: sessionId,
      page: location.pathname,
      ts: Date.now(),
      extra: extra || null,
    });
    if (navigator.sendBeacon) {
      navigator.sendBeacon(ENDPOINT, payload);
    } else {
      var xhr = new XMLHttpRequest();
      xhr.open('POST', ENDPOINT, true);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.send(payload);
    }
  }

  // ─── Session Start (once per session) ──────────────────────────────────────
  var isFirstPageInSession = false;
  try {
    isFirstPageInSession = !sessionStorage.getItem(SESSION_START_KEY);
    if (isFirstPageInSession) {
      sessionStorage.setItem(SESSION_START_KEY, Date.now().toString());
    }
  } catch (e) {
    isFirstPageInSession = true;
  }

  if (isFirstPageInSession) {
    send('session_start', {
      device: getDeviceType(),
      referrer: getReferrerCategory(),
      isNew: isNewVisitor(),
    });
  }

  // ─── Track Page Views ────────────────────────────────────────────────────────
  var pageCount = incrementPageCount();
  var pvExtra = {};
  var stock = getStockNumber();
  if (stock) pvExtra.stockNumber = stock;
  send('page_view', Object.keys(pvExtra).length ? pvExtra : null);

  // ─── Session End (on page unload) ──────────────────────────────────────────
  function sendSessionEnd() {
    var startTime = 0;
    try { startTime = parseInt(sessionStorage.getItem(SESSION_START_KEY) || '0', 10); } catch (e) { /* ignore */ }
    var duration = startTime > 0 ? Math.round((Date.now() - startTime) / 1000) : 0;
    send('session_end', {
      pageCount: getPageCount(),
      duration: duration,
    });
  }

  // Use pagehide (preferred) with visibilitychange fallback
  if ('onpagehide' in window) {
    window.addEventListener('pagehide', sendSessionEnd);
  } else {
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') sendSessionEnd();
    });
  }

  // ─── Track Phone Link Clicks ─────────────────────────────────────────────────
  document.addEventListener('click', function (e) {
    var link = e.target.closest ? e.target.closest('a[href^="tel:"]') : null;
    if (!link) {
      var el = e.target;
      while (el && el.tagName !== 'A') el = el.parentElement;
      if (el && el.getAttribute('href') && el.getAttribute('href').indexOf('tel:') === 0) link = el;
    }
    if (link) {
      send('phone_click', { number: link.getAttribute('href') });
    }
  }, true);

  // ─── Track Form Submissions ──────────────────────────────────────────────────
  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (!form || !form.tagName || form.tagName !== 'FORM') return;
    var action = form.getAttribute('action') || '';
    if (action.indexOf('formspree') !== -1 || form.hasAttribute('data-netlify') || action.indexOf('netlify') !== -1) {
      send('form_submit', { action: action });
    }
  }, true);
})();
