/**
 * Bells Fork Truck & Auto — Lead Capture Enhancements
 * 1. VDP sticky lead bar (scrolls into view on vehicle detail pages)
 * 2. TECOBI fallback guard for its CTAs
 *
 * The text CTAs here open TECOBI forms (traceable SMS opt-in + automated follow-up) but
 * keep their legacy sms:/financing href as a fallback, so they still work if the TECOBI
 * widget fails to load. See initTecobiFallback() at the bottom.
 */
(function () {
  'use strict';

  var DEALER_PHONE_TEL = '+12524960005';
  var DEALER_SMS_TEL = '+12529170551';

  // ─── Helpers ───
  function qs(sel) { return document.querySelector(sel); }
  function ce(tag, cls, html) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (html) el.innerHTML = html;
    return el;
  }

  // ═══════════════════════════════════════════════════════
  // 2. VDP STICKY LEAD BAR
  // ═══════════════════════════════════════════════════════
  function initVdpStickyBar() {
    // Only on VDP pages
    var titleEl = qs('.vdp-vehicle-title');
    if (!titleEl) return;

    var priceEl = qs('.vdp-price-tag');
    var vehicleName = titleEl.textContent.trim();
    var vehiclePrice = priceEl ? priceEl.textContent.trim() : '';

    var bar = ce('div', 'bf-vdp-sticky');
    bar.setAttribute('role', 'complementary');
    bar.setAttribute('aria-label', 'Vehicle quick actions');
    bar.innerHTML =
      '<div class="container d-flex align-items-center justify-content-between">' +
        '<div class="bf-vdp-sticky-info d-none d-md-flex align-items-center gap-2">' +
          '<strong>' + vehicleName + '</strong>' +
          (vehiclePrice ? ' <span class="bf-vdp-sticky-price">' + vehiclePrice + '</span>' : '') +
        '</div>' +
        '<div class="bf-vdp-sticky-actions">' +
          '<a href="tel:' + DEALER_PHONE_TEL + '" class="bf-vdp-sticky-btn call">Call Now</a>' +
          '<a href="sms:' + DEALER_SMS_TEL + '?body=' + encodeURIComponent('Hi, I\'m interested in the ' + vehicleName + '. Is it still available?') + '" class="bf-vdp-sticky-btn text tecobi-contact-us-toggle" data-tecobi-fallback>Text Us</a>' +
          '<a href="/financing.html?vehicle=' + encodeURIComponent(vehicleName) + '" class="bf-vdp-sticky-btn apply tecobi-quick-qualify-toggle" data-tecobi-fallback>Get Pre-Qualified</a>' +
        '</div>' +
      '</div>';

    document.body.appendChild(bar);

    // Show after scrolling past the CTA card
    var ctaCard = qs('.vdp-cta-card');
    if (ctaCard && 'IntersectionObserver' in window) {
      var observer = new IntersectionObserver(function (entries) {
        bar.classList.toggle('visible', !entries[0].isIntersecting);
      }, { threshold: 0 });
      observer.observe(ctaCard);
    } else {
      // Fallback: show after 400px scroll
      window.addEventListener('scroll', function () {
        bar.classList.toggle('visible', (window.scrollY || 0) > 400);
      }, { passive: true });
    }
  }

  // ═══════════════════════════════════════════════════════
  // TECOBI FALLBACK GUARD
  // ═══════════════════════════════════════════════════════
  // Every converted CTA carries both a TECOBI toggle class and its legacy href, so the
  // button is never dead if the widget fails to load (CSP, vendor outage, blocker).
  //
  // We assume TECOBI will handle the click and suppress the navigation up front, then
  // follow the legacy href only if the widget never materializes. Doing it the other way
  // round — waiting to detect the widget before suppressing — double-fires when TECOBI
  // builds its modal lazily on first click: the native SMS app and the modal both open.
  //
  // We never call stopPropagation, so TECOBI's own (possibly delegated) handler still runs.
  var TECOBI_FALLBACK_MS = 700;

  // TODO: confirm the real global and overlay selector on a deploy preview — the widget
  // host is unreachable from CI, so this list is a best guess from the vendor's docs.
  function tecobiReady() {
    if (window.TECOBI || window.tecobi) return true;
    return !!document.querySelector(
      'iframe[src*="tecobi.com"], [data-tecobi-widget], .tecobi-widget, .tecobi-widget-frame'
    );
  }

  function initTecobiFallback() {
    // No widget include on the page means these are plain links — stay out of the way.
    if (!document.getElementById('tecobi-widget-include')) return;

    document.addEventListener(
      'click',
      function (e) {
        var t = e.target;
        if (!t || typeof t.closest !== 'function') return;
        var el = t.closest('[data-tecobi-fallback]');
        if (!el) return;

        var href = el.getAttribute('href');
        if (!href) return;

        e.preventDefault();
        if (tecobiReady()) return; // widget is up; it owns this click

        setTimeout(function () {
          if (!tecobiReady()) window.location.href = href;
        }, TECOBI_FALLBACK_MS);
      },
      true
    );
  }

  // ═══════════════════════════════════════════════════════
  // INIT — run after DOM ready
  // ═══════════════════════════════════════════════════════
  function init() {
    initVdpStickyBar();
    initTecobiFallback();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
