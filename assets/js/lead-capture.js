/**
 * Bells Fork Truck & Auto — Lead Capture Enhancements
 * 1. VDP sticky lead bar (scrolls into view on vehicle detail pages)
 * 2. TECOBI fallback guard for its CTAs
 * 3. Mobile action bar yields while the TECOBI panel is open
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
  // MOBILE ACTION BAR — YIELD TO THE TECOBI PANEL
  // ═══════════════════════════════════════════════════════
  // Call / Text / Directions is pinned to the bottom edge, which is exactly where TECOBI
  // opens its panel — on a phone that panel is nearly full width, so it buries the bar.
  // The vendor's markup cannot be inspected from CI, so instead of hard-coding their
  // class names this hit-tests the bar's own strip: if a fixed layer that isn't ours is
  // painted over most of it, the bar steps aside until that layer goes away. Once the
  // widget collapses back to its corner bubble, only one sample point is covered and the
  // bar returns.
  //
  // It fails open — anything unexpected leaves the bar visible.

  var YIELD_CLASS = 'tecobi-yielded';
  var OUR_FIXED_UI = '.mobile-action-bar, .bf-vdp-sticky, .desktop-cta-bar, .engage-prompt, .back-to-top';
  var SAMPLE_POINTS = 5;

  function isOurs(el) {
    return !!(el && el.closest && el.closest(OUR_FIXED_UI));
  }

  // Page content scrolls underneath a fixed bar, so only another fixed layer can sit on
  // top of it. (elementFromPoint already skips pointer-events:none, so a transparent
  // full-screen wrapper never registers here.)
  function isFixedOverlay(el) {
    var cs = window.getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.opacity === '0') return false;
    for (var node = el; node && node !== document.body; node = node.parentElement) {
      if (window.getComputedStyle(node).position === 'fixed') return true;
    }
    return false;
  }

  function initMobileBarYield() {
    var bar = qs('.mobile-action-bar');
    if (!bar) return;

    function coveredPoints() {
      var r = bar.getBoundingClientRect();
      if (!r.width || !r.height) return 0; // display:none above the mobile breakpoint
      var y = Math.round(r.top + r.height / 2);
      if (y < 0 || y >= window.innerHeight) return 0;

      var covered = 0;
      for (var i = 0; i < SAMPLE_POINTS; i++) {
        var x = Math.round(r.left + (r.width * (i + 0.5)) / SAMPLE_POINTS);
        var el = document.elementFromPoint(x, y);
        if (el && !isOurs(el) && isFixedOverlay(el)) covered++;
      }
      return covered;
    }

    var scheduled = false;
    function update() {
      scheduled = false;
      // Toggling to the value it already has does not touch the attribute, so this
      // cannot feed itself through the observer below.
      bar.classList.toggle(YIELD_CLASS, coveredPoints() > SAMPLE_POINTS / 2);
    }

    function schedule() {
      if (scheduled) return;
      scheduled = true;
      window.requestAnimationFrame(update);
    }

    schedule();
    new MutationObserver(schedule).observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class', 'hidden', 'aria-hidden'],
    });
    window.addEventListener('resize', schedule, { passive: true });
    window.addEventListener('orientationchange', schedule, { passive: true });
    // Backstop: a widget can open inside its own iframe without touching our DOM.
    setInterval(schedule, 600);
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
    initMobileBarYield();
    initTecobiFallback();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
