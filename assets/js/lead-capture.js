/**
 * Bells Fork Truck & Auto — Lead Capture Enhancements
 * 1. Exit-intent popup (desktop: mouse leave; mobile: back-button/scroll-up)
 * 2. VDP sticky lead bar (scrolls into view on vehicle detail pages)
 * 3. Social proof toast notifications
 * 4. Click-to-text SMS CTA (floating button)
 */
(function () {
  'use strict';

  var DEALER_PHONE_TEL = '+12524960005';
  var DEALER_SMS_TEL = '+12529170551';
  var DEALER_PHONE = '(252) 496-0005';
  var POPUP_COOLDOWN_KEY = 'bf_exit_popup_ts';
  var POPUP_COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000; // 3 days
  var SOCIAL_PROOF_KEY = 'bf_social_proof_ts';
  var SOCIAL_PROOF_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes

  // ─── Helpers ───
  function qs(sel) { return document.querySelector(sel); }
  function ce(tag, cls, html) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (html) el.innerHTML = html;
    return el;
  }

  function shouldShowPopup() {
    try {
      var ts = localStorage.getItem(POPUP_COOLDOWN_KEY);
      if (ts && (Date.now() - Number(ts)) < POPUP_COOLDOWN_MS) return false;
    } catch (e) { /* ignore */ }
    return true;
  }

  function markPopupShown() {
    try { localStorage.setItem(POPUP_COOLDOWN_KEY, String(Date.now())); } catch (e) { /* ignore */ }
  }

  // ═══════════════════════════════════════════════════════
  // 1. EXIT-INTENT POPUP
  // ═══════════════════════════════════════════════════════
  function initExitIntent() {
    if (!shouldShowPopup()) return;

    // Build overlay
    var overlay = ce('div', 'bf-exit-overlay');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', 'Special offer before you go');
    overlay.innerHTML =
      '<div class="bf-exit-popup">' +
        '<button class="bf-exit-close" aria-label="Close">&times;</button>' +
        '<div class="bf-exit-badge">BEFORE YOU GO</div>' +
        '<h2 class="bf-exit-title">Get Pre-Qualified in 60 Seconds</h2>' +
        '<p class="bf-exit-desc">No SSN required. No impact to your credit score. See what you qualify for today.</p>' +
        '<form class="bf-exit-form" data-netlify="true" name="exit-intent-lead" netlify-honeypot="bf-hp">' +
          '<input type="hidden" name="form-name" value="exit-intent-lead">' +
          '<p style="display:none"><input name="bf-hp" tabindex="-1" autocomplete="off"></p>' +
          '<input type="text" name="name" placeholder="Your Name" required class="bf-exit-input">' +
          '<input type="tel" name="phone" placeholder="Phone Number" required class="bf-exit-input">' +
          '<input type="email" name="email" placeholder="Email (optional)" class="bf-exit-input">' +
          '<button type="submit" class="bf-exit-submit">Get Pre-Qualified Now</button>' +
        '</form>' +
        '<p class="bf-exit-note">Or call us at <a href="tel:' + DEALER_PHONE_TEL + '">' + DEALER_PHONE + '</a></p>' +
      '</div>';

    document.body.appendChild(overlay);

    var shown = false;

    function showPopup() {
      if (shown) return;
      shown = true;
      overlay.classList.add('visible');
      markPopupShown();
    }

    function hidePopup() {
      overlay.classList.remove('visible');
    }

    // Close button
    overlay.querySelector('.bf-exit-close').addEventListener('click', hidePopup);
    // Click outside
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) hidePopup();
    });
    // Escape key
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && overlay.classList.contains('visible')) hidePopup();
    });

    // Desktop: mouse leaves viewport top
    if (window.innerWidth >= 768) {
      document.addEventListener('mouseout', function (e) {
        if (!e.relatedTarget && e.clientY < 10) showPopup();
      });
    }

    // Mobile: rapid scroll-up (intent to leave)
    var lastY = window.scrollY || 0;
    var rapidUp = 0;
    window.addEventListener('scroll', function () {
      var y = window.scrollY || 0;
      if (y < lastY && (lastY - y) > 80) {
        rapidUp++;
        if (rapidUp >= 3 && y < 200) showPopup();
      } else {
        rapidUp = 0;
      }
      lastY = y;
    }, { passive: true });

    // Also trigger after 45 seconds of inactivity (idle users)
    var idleTimer;
    function resetIdle() {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(showPopup, 45000);
    }
    ['mousemove', 'touchstart', 'scroll', 'keydown'].forEach(function (evt) {
      document.addEventListener(evt, resetIdle, { passive: true, once: false });
    });
    resetIdle();

    // Form submission
    var form = overlay.querySelector('.bf-exit-form');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var data = new FormData(form);
      fetch('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(data).toString()
      }).then(function () {
        form.innerHTML = '<div class="bf-exit-success">Thanks! We\'ll be in touch shortly.</div>';
        setTimeout(hidePopup, 3000);
      }).catch(function () {
        form.innerHTML = '<div class="bf-exit-success">Thanks! Call us at <a href="tel:' + DEALER_PHONE_TEL + '">' + DEALER_PHONE + '</a> for faster service.</div>';
      });
    });
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
  // 3. SOCIAL PROOF TOAST NOTIFICATIONS
  // ═══════════════════════════════════════════════════════
  function initSocialProof() {
    // Cooldown: don't spam toasts too frequently
    try {
      var lastShown = localStorage.getItem(SOCIAL_PROOF_KEY);
      if (lastShown && (Date.now() - Number(lastShown)) < SOCIAL_PROOF_COOLDOWN_MS) return;
    } catch (e) { /* ignore */ }

    var actions = [
      'just applied for financing',
      'just scheduled a test drive',
      'just requested a trade-in value',
      'just sent an inquiry',
      'just got pre-qualified',
      'just made an offer'
    ];

    var firstNames = [
      'James', 'Robert', 'John', 'Michael', 'David', 'William', 'Chris',
      'Sarah', 'Jessica', 'Ashley', 'Amanda', 'Emily', 'Jennifer', 'Lisa',
      'Brandon', 'Tyler', 'Kevin', 'Brian', 'Daniel', 'Matthew', 'Andrew',
      'Megan', 'Lauren', 'Rachel', 'Nicole', 'Stephanie', 'Amber', 'Heather'
    ];

    var cities = [
      'Greenville', 'Winterville', 'Ayden', 'Farmville', 'Simpson',
      'Bethel', 'Grimesland', 'Stokes', 'Pactolus', 'Washington'
    ];

    var timeAgo = [
      '2 minutes ago', '5 minutes ago', '8 minutes ago', '12 minutes ago',
      '15 minutes ago', '22 minutes ago', '30 minutes ago', '1 hour ago'
    ];

    function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

    var container = ce('div', 'bf-social-proof-container');
    container.setAttribute('aria-live', 'polite');
    document.body.appendChild(container);

    var shownCount = 0;
    var maxToasts = 3;

    function showToast() {
      if (shownCount >= maxToasts) return;
      shownCount++;

      var toast = ce('div', 'bf-social-toast');
      toast.innerHTML =
        '<div class="bf-social-toast-icon">&#9989;</div>' +
        '<div class="bf-social-toast-content">' +
          '<strong>' + pick(firstNames) + ' from ' + pick(cities) + '</strong> ' +
          pick(actions) +
          '<div class="bf-social-toast-time">' + pick(timeAgo) + '</div>' +
        '</div>' +
        '<button class="bf-social-toast-close" aria-label="Dismiss">&times;</button>';

      container.appendChild(toast);
      requestAnimationFrame(function () {
        toast.classList.add('visible');
      });

      toast.querySelector('.bf-social-toast-close').addEventListener('click', function () {
        dismissToast(toast);
      });

      // Auto-dismiss after 6 seconds
      setTimeout(function () { dismissToast(toast); }, 6000);
    }

    function dismissToast(toast) {
      if (!toast.parentNode) return;
      toast.classList.remove('visible');
      setTimeout(function () { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 400);
    }

    // First toast after 15 seconds, then every 30-50 seconds
    setTimeout(function () {
      showToast();
      try { localStorage.setItem(SOCIAL_PROOF_KEY, String(Date.now())); } catch (e) { /* ignore */ }

      function scheduleNext() {
        if (shownCount >= maxToasts) return;
        var delay = 30000 + Math.random() * 20000;
        setTimeout(function () {
          showToast();
          scheduleNext();
        }, delay);
      }
      scheduleNext();
    }, 15000);
  }

  // ═══════════════════════════════════════════════════════
  // 4. FLOATING SMS / TEXT CTA BUTTON
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
    initExitIntent();
    initVdpStickyBar();
    initSocialProof();
    initFloatingSms();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
