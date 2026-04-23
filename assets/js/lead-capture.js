/**
 * Bells Fork Truck & Auto — Lead Capture Enhancements
 * 1. VDP sticky lead bar (scrolls into view on vehicle detail pages)
 * 2. Click-to-text SMS CTA (floating button)
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
          '<a href="sms:' + DEALER_SMS_TEL + '?body=' + encodeURIComponent('Hi, I\'m interested in the ' + vehicleName + '. Is it still available?') + '" class="bf-vdp-sticky-btn text sms-limited">Text Us</a>' +
          '<a href="/financing.html?vehicle=' + encodeURIComponent(vehicleName) + '" class="bf-vdp-sticky-btn apply">Get Pre-Qualified</a>' +
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
  // FLOATING SMS / TEXT CTA BUTTON
  // ═══════════════════════════════════════════════════════
  function initFloatingSms() {
    // Only on desktop — mobile already has the action bar
    if (window.innerWidth < 768) return;

    var isVdp = !!qs('.vdp-vehicle-title');
    var vehicleName = '';
    if (isVdp) {
      var t = qs('.vdp-vehicle-title');
      vehicleName = t ? t.textContent.trim() : '';
    }

    var smsBody = vehicleName
      ? encodeURIComponent('Hi, I\'m interested in the ' + vehicleName + '. Is it still available?')
      : encodeURIComponent('Hi, I\'m interested in a vehicle. Can you help?');

    var btn = ce('a', 'bf-floating-sms');
    btn.href = 'sms:' + DEALER_SMS_TEL + '?body=' + smsBody;
    btn.setAttribute('aria-label', 'Text us');
    btn.innerHTML =
      '<svg width="22" height="22" fill="currentColor" viewBox="0 0 16 16"><path d="M2.678 11.894a1 1 0 0 1 .287.801 10.97 10.97 0 0 1-.398 2c1.395-.323 2.247-.697 2.634-.893a1 1 0 0 1 .71-.074A8.06 8.06 0 0 0 8 14c3.996 0 7-2.807 7-6 0-3.192-3.004-6-7-6S1 4.808 1 8c0 1.468.617 2.83 1.678 3.894zm-.493 3.905a21.682 21.682 0 0 1-.713.129c-.2.032-.352-.176-.273-.362a9.68 9.68 0 0 0 .244-.637l.003-.01c.248-.72.45-1.548.524-2.319C.743 11.37 0 9.76 0 8c0-3.866 3.582-7 8-7s8 3.134 8 7-3.582 7-8 7a9.06 9.06 0 0 1-2.347-.306c-.52.263-1.639.742-3.468 1.105z"/></svg>' +
      '<span class="bf-floating-sms-label">Text Us</span>';

    document.body.appendChild(btn);

    // Show after short scroll
    window.addEventListener('scroll', function () {
      btn.classList.toggle('visible', (window.scrollY || 0) > 300);
    }, { passive: true });
  }

  // ═══════════════════════════════════════════════════════
  // INIT — run after DOM ready
  // ═══════════════════════════════════════════════════════
  function init() {
    initVdpStickyBar();
    initFloatingSms();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
