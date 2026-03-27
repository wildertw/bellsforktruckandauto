/**
 * Bells Fork Truck & Auto — GA4 + Facebook Pixel
 *
 * Configuration:
 *   Set your IDs below before deploying:
 *   - GA4_MEASUREMENT_ID: Your Google Analytics 4 measurement ID (e.g., 'G-XXXXXXXXXX')
 *   - FB_PIXEL_ID: Your Facebook Pixel ID (e.g., '1234567890')
 *
 *   Leave as empty string '' to disable either integration.
 */
(function () {
  'use strict';

  // ══════════════════════════════════════════════════
  // CONFIGURE YOUR IDS HERE
  // ══════════════════════════════════════════════════
  var GA4_MEASUREMENT_ID = ''; // e.g. 'G-XXXXXXXXXX'
  var FB_PIXEL_ID = '';        // e.g. '1234567890'
  // ══════════════════════════════════════════════════

  // ── Google Analytics 4 (gtag.js) ──
  if (GA4_MEASUREMENT_ID) {
    var gtagScript = document.createElement('script');
    gtagScript.async = true;
    gtagScript.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA4_MEASUREMENT_ID;
    document.head.appendChild(gtagScript);

    window.dataLayer = window.dataLayer || [];
    function gtag() { window.dataLayer.push(arguments); }
    window.gtag = gtag;
    gtag('js', new Date());
    gtag('config', GA4_MEASUREMENT_ID, {
      send_page_view: true,
      cookie_flags: 'SameSite=None;Secure'
    });

    // Track key conversion events
    // Phone call clicks
    document.addEventListener('click', function (e) {
      var link = e.target.closest('a[href^="tel:"]');
      if (link) {
        gtag('event', 'phone_call_click', {
          event_category: 'engagement',
          event_label: link.href,
          page_location: window.location.href
        });
      }
    });

    // SMS/text clicks
    document.addEventListener('click', function (e) {
      var link = e.target.closest('a[href^="sms:"]');
      if (link) {
        gtag('event', 'sms_click', {
          event_category: 'engagement',
          event_label: link.href,
          page_location: window.location.href
        });
      }
    });

    // Form submissions
    document.addEventListener('submit', function (e) {
      var form = e.target;
      var formName = form.getAttribute('name') || form.getAttribute('data-netlify') || 'unknown';
      gtag('event', 'form_submission', {
        event_category: 'lead',
        event_label: formName,
        page_location: window.location.href
      });
    });

    // VDP views (vehicle detail pages)
    if (window.location.pathname.indexOf('/vdp/') === 0) {
      var titleEl = document.querySelector('.vdp-vehicle-title');
      var priceEl = document.querySelector('.vdp-price-tag');
      gtag('event', 'view_item', {
        currency: 'USD',
        value: priceEl ? parseFloat(priceEl.textContent.replace(/[^0-9.]/g, '')) || 0 : 0,
        items: [{
          item_name: titleEl ? titleEl.textContent.trim() : document.title,
          item_category: 'vehicle'
        }]
      });
    }
  }

  // ── Facebook Pixel ──
  if (FB_PIXEL_ID) {
    !function (f, b, e, v, n, t, s) {
      if (f.fbq) return;
      n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
      if (!f._fbq) f._fbq = n;
      n.push = n; n.loaded = !0; n.version = '2.0';
      n.queue = [];
      t = b.createElement(e); t.async = !0;
      t.src = v;
      s = b.getElementsByTagName(e)[0];
      s.parentNode.insertBefore(t, s);
    }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');

    window.fbq('init', FB_PIXEL_ID);
    window.fbq('track', 'PageView');

    // Track key conversion events for retargeting
    // Form submissions → Lead event
    document.addEventListener('submit', function (e) {
      var form = e.target;
      var formName = form.getAttribute('name') || 'unknown';
      window.fbq('track', 'Lead', {
        content_name: formName,
        content_category: 'form_submission'
      });
    });

    // VDP views → ViewContent event
    if (window.location.pathname.indexOf('/vdp/') === 0) {
      var titleEl = document.querySelector('.vdp-vehicle-title');
      var priceEl = document.querySelector('.vdp-price-tag');
      window.fbq('track', 'ViewContent', {
        content_name: titleEl ? titleEl.textContent.trim() : document.title,
        content_type: 'vehicle',
        content_category: 'VDP',
        value: priceEl ? parseFloat(priceEl.textContent.replace(/[^0-9.]/g, '')) || 0 : 0,
        currency: 'USD'
      });
    }

    // Phone clicks → Contact event
    document.addEventListener('click', function (e) {
      var link = e.target.closest('a[href^="tel:"], a[href^="sms:"]');
      if (link) {
        window.fbq('track', 'Contact', {
          content_name: link.href.indexOf('sms:') === 0 ? 'sms_click' : 'phone_call',
          content_category: 'engagement'
        });
      }
    });

    // Financing page → InitiateCheckout
    if (window.location.pathname.indexOf('/financing') === 0 ||
        window.location.pathname.indexOf('/pre-qualify') === 0) {
      window.fbq('track', 'InitiateCheckout', {
        content_category: 'financing'
      });
    }

    // Noscript fallback pixel (for users with JS disabled)
    var noscriptImg = document.createElement('img');
    noscriptImg.height = 1;
    noscriptImg.width = 1;
    noscriptImg.style.display = 'none';
    noscriptImg.src = 'https://www.facebook.com/tr?id=' + FB_PIXEL_ID + '&ev=PageView&noscript=1';
    noscriptImg.alt = '';
    document.body.appendChild(noscriptImg);
  }
})();
