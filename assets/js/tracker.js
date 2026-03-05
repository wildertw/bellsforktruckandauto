/**
 * Bells Fork Auto & Truck — Lightweight Site Analytics Tracker
 * Tracks page views, phone link clicks, and form submissions.
 * Sends events to /.netlify/functions/track via navigator.sendBeacon.
 */
(function () {
  'use strict';

  var ENDPOINT = '/.netlify/functions/track';
  var VID_KEY = 'bf_visitor_id';

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

  var visitorId = getVisitorId();

  function send(type, extra) {
    var payload = JSON.stringify({
      type: type,
      visitorId: visitorId,
      page: location.pathname,
      ts: Date.now(),
      extra: extra || null,
    });
    if (navigator.sendBeacon) {
      navigator.sendBeacon(ENDPOINT, payload);
    } else {
      // Fallback for older browsers
      var xhr = new XMLHttpRequest();
      xhr.open('POST', ENDPOINT, true);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.send(payload);
    }
  }

  // ─── Track Page Views ────────────────────────────────────────────────────────
  send('page_view');

  // ─── Track Phone Link Clicks ─────────────────────────────────────────────────
  document.addEventListener('click', function (e) {
    var link = e.target.closest ? e.target.closest('a[href^="tel:"]') : null;
    if (!link) {
      // Fallback for browsers without closest
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
    // Only track external/contact forms (Formspree, Netlify Forms), not admin forms
    if (action.indexOf('formspree') !== -1 || form.hasAttribute('data-netlify') || action.indexOf('netlify') !== -1) {
      send('form_submit', { action: action });
    }
  }, true);
})();
