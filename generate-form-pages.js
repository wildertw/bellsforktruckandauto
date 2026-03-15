#!/usr/bin/env node
// generate-form-pages.js — Generate standalone pages for each financing tab
// Extracts form HTML from financing.html tab panes and creates separate pages:
//   /financing/index.html, /schedule-test-drive/index.html,
//   /make-an-offer/index.html, /trade-in-value/index.html, /consignment/index.html

const fs = require('fs');
const path = require('path');
const {
  SITE_URL, DEALER_NAME, DEALER_PHONE, DEALER_PHONE_TEL, DEALER_SMS_TEL,
  DEALER_ADDRESS, DEALER_STREET, DEALER_CITY, DEALER_STATE, DEALER_ZIP,
  DEALER_LAT, DEALER_LNG, DEALER_FB,
  escapeHtml, escapeAttr,
} = require('./build-utils');

const ASSET_PREFIX = '/';

// ── Form page definitions ──

const FORM_PAGES = [
  {
    slug: 'financing',
    paneId: 'pane-financing',
    title: 'Apply for Auto Financing',
    metaTitle: 'Apply for Auto Financing | Bells Fork Truck & Auto | Greenville, NC',
    metaDesc: 'Apply for auto financing online at Bells Fork Truck & Auto in Greenville, NC. We work with all credit types. Quick approval, competitive rates. Call (252) 496-0005.',
    h1: 'Apply for Auto Financing in Greenville, NC',
    intro: 'Ready to finance your next vehicle? Fill out our secure financing application below. We work with multiple lenders to find the best rate for your situation, regardless of credit history.',
  },
  {
    slug: 'schedule-test-drive',
    paneId: 'pane-testdrive',
    title: 'Schedule a Test Drive',
    metaTitle: 'Schedule a Test Drive | Bells Fork Truck & Auto | Greenville, NC',
    metaDesc: 'Schedule a test drive at Bells Fork Truck & Auto in Greenville, NC. Pick your vehicle and preferred time. No pressure, no obligation. Call (252) 496-0005.',
    h1: 'Schedule a Test Drive in Greenville, NC',
    intro: 'Want to get behind the wheel? Fill out the form below to schedule a test drive at Bells Fork Truck & Auto. Pick your vehicle and preferred date, and we\'ll have it ready for you.',
  },
  {
    slug: 'make-an-offer',
    paneId: 'pane-offer',
    title: 'Make an Offer on a Vehicle',
    metaTitle: 'Make an Offer on a Vehicle | Bells Fork Truck & Auto | Greenville, NC',
    metaDesc: 'Make an offer on any vehicle at Bells Fork Truck & Auto in Greenville, NC. Submit your best price online. Fair, transparent negotiations. Call (252) 496-0005.',
    h1: 'Make an Offer on a Vehicle',
    intro: 'See a vehicle you like? Submit your best offer below and we\'ll get back to you promptly. We believe in fair, transparent pricing and are happy to work with you.',
  },
  {
    slug: 'trade-in-value',
    paneId: 'pane-tradein',
    title: 'Get Your Trade-In Value',
    metaTitle: 'Get Your Trade-In Value | Bells Fork Truck & Auto | Greenville, NC',
    metaDesc: 'Get a free trade-in appraisal at Bells Fork Truck & Auto in Greenville, NC. Find out what your vehicle is worth. Fair market values. Call (252) 496-0005.',
    h1: 'Get Your Trade-In Value',
    intro: 'Thinking about trading in your current vehicle? Fill out the form below for a free, no-obligation trade-in appraisal. We offer fair market values on all trade-ins.',
  },
  {
    slug: 'consignment',
    paneId: 'pane-consignment',
    title: 'Consignment Services',
    metaTitle: 'Vehicle Consignment | Bells Fork Truck & Auto | Greenville, NC',
    metaDesc: 'Sell your vehicle through consignment at Bells Fork Truck & Auto in Greenville, NC. We handle the sale, you get the best price. Call (252) 496-0005.',
    h1: 'Vehicle Consignment Services',
    intro: 'Want to sell your vehicle without the hassle? Our consignment program lets us handle the marketing and sale while you get a fair price. Fill out the form below to get started.',
  },
];

// ── Extract form HTML from financing.html ──

function extractPaneContent(html, paneId) {
  // Find the tab-pane div by its id
  const paneRegex = new RegExp(`<div[^>]*id="${paneId}"[^>]*>([\\s\\S]*?)(?=<div[^>]*class="tab-pane|$)`, 'i');
  const match = html.match(paneRegex);
  if (!match) return '';

  let content = match[1];
  // Remove the trailing </div> that closes the tab-pane
  // The content ends just before the next tab-pane or end of tab-content
  content = content.replace(/\s*<\/div>\s*$/, '');
  return content.trim();
}

// ── Build cross-links ──

function buildCrossLinks(currentSlug) {
  return FORM_PAGES
    .filter(p => p.slug !== currentSlug)
    .map(p => `<a href="/${p.slug}/" class="cross-link-btn">${p.title}</a>`)
    .join('');
}

// ── Generate page HTML ──

function generateFormPage(page, formContent) {
  const crossLinks = buildCrossLinks(page.slug);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(page.metaTitle)}</title>
  <meta name="description" content="${escapeAttr(page.metaDesc)}">
  <link rel="canonical" href="${SITE_URL}/${page.slug}/">
  <link rel="sitemap" type="application/xml" href="/sitemap.xml">
  <meta name="robots" content="index, follow">
  <meta name="geo.region" content="US-NC">
  <meta name="geo.placename" content="${DEALER_CITY}, North Carolina">
  <meta name="geo.position" content="${DEALER_LAT};${DEALER_LNG}">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${escapeAttr(page.metaTitle)}">
  <meta property="og:description" content="${escapeAttr(page.metaDesc)}">
  <meta property="og:url" content="${SITE_URL}/${page.slug}/">
  <meta property="og:image" content="${SITE_URL}/assets/hero/shop-front-og.jpg">
  <meta property="og:site_name" content="${DEALER_NAME}">
  <link rel="icon" type="image/png" href="${ASSET_PREFIX}assets/favicon.png">
  <link href="${ASSET_PREFIX}assets/vendor/bootstrap.min.css" rel="stylesheet">
  <link href="${ASSET_PREFIX}style.min.css" rel="stylesheet">
</head>
<body>

  <!-- IDENTITY BAR -->
  <div class="site-identity-bar" style="background:#f8f8f8;border-bottom:1px solid #eee;">
    <div class="container">
      <div class="d-flex align-items-center justify-content-between flex-wrap py-2">
        <a href="${ASSET_PREFIX}index.html" style="min-width:160px;">
          <span class="fw-bold" style="font-size:1.15rem;color:#111;">${DEALER_NAME}</span>
        </a>
        <a href="${ASSET_PREFIX}index.html" class="d-none d-md-block"
           style="position:absolute;left:50%;transform:translateX(-50%);">
          <img src="${ASSET_PREFIX}assets/logo.png" height="68" alt="${DEALER_NAME} Logo">
        </a>
        <div class="text-end ms-auto" style="min-width:160px;">
          <a href="tel:${DEALER_PHONE_TEL}" class="text-decoration-none fw-bold d-flex align-items-center justify-content-end gap-2" style="font-size:1.2rem;color:#111;">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor" viewBox="0 0 16 16"><path fill-rule="evenodd" d="M1.885.511a1.745 1.745 0 0 1 2.61.163L6.29 2.98c.329.423.445.974.315 1.494l-.547 2.19a.678.678 0 0 0 .178.643l2.457 2.457a.678.678 0 0 0 .644.178l2.189-.547a1.745 1.745 0 0 1 1.494.315l2.306 1.794c.829.645.905 1.87.163 2.611l-1.034 1.034c-.74.74-1.846 1.065-2.877.702a18.634 18.634 0 0 1-7.01-4.42 18.634 18.634 0 0 1-4.42-7.009c-.362-1.03-.037-2.137.703-2.877L1.885.511z"/></svg>
            ${DEALER_PHONE}
          </a>
          <a href="https://maps.google.com/?q=3840+Charles+Blvd+Greenville+NC" target="_blank"
             class="text-decoration-none text-muted d-flex align-items-start justify-content-end gap-1 mt-1" style="font-size:.82rem;line-height:1.5;">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" class="flex-shrink-0 mt-1" viewBox="0 0 16 16"><path d="M8 16s6-5.686 6-10A6 6 0 0 0 2 6c0 4.314 6 10 6 10zm0-7a3 3 0 1 1 0-6 3 3 0 0 1 0 6z"/></svg>
            <span>${DEALER_STREET}<br>${DEALER_CITY}, ${DEALER_STATE} ${DEALER_ZIP}</span>
          </a>
        </div>
      </div>
    </div>
  </div>

  <!-- NAV BAR -->
  <header class="sticky-top" role="banner" style="z-index:1030;">
    <nav class="navbar navbar-expand-lg navbar-dark py-0" style="background:#111111;">
      <div class="container-fluid">
        <button class="navbar-toggler border-0 ms-auto py-3" type="button" data-bs-toggle="collapse" data-bs-target="#navMain"
                aria-controls="navMain" aria-expanded="false" aria-label="Toggle navigation">
          <span class="navbar-toggler-icon"></span>
        </button>
        <div class="collapse navbar-collapse justify-content-center" id="navMain">
          <ul class="navbar-nav align-items-lg-center">
            <li class="nav-item"><a class="nav-link px-4 py-3 fw-semibold text-uppercase bfat-navlink" href="/inventory">Inventory</a></li>
            <li class="nav-item"><a class="nav-link px-4 py-3 fw-semibold text-uppercase bfat-navlink" href="${ASSET_PREFIX}about.html">About</a></li>
            <li class="nav-item"><a class="nav-link px-4 py-3 fw-semibold text-uppercase bfat-navlink" href="${ASSET_PREFIX}reviews.html">Reviews</a></li>
            <li class="nav-item"><a class="nav-link px-4 py-3 fw-semibold text-uppercase bfat-navlink active" href="${ASSET_PREFIX}financing.html">Financing</a></li>
            <li class="nav-item"><a class="nav-link px-4 py-3 fw-semibold text-uppercase bfat-navlink" href="${ASSET_PREFIX}contact.html#visit">Contact</a></li>
            <li class="nav-item"><a class="nav-link px-4 py-3 fw-semibold text-uppercase bfat-navlink" href="${ASSET_PREFIX}blog.html">Blog</a></li>
          </ul>
        </div>
      </div>
    </nav>
  </header>

  <main>
    <!-- Breadcrumb -->
    <nav class="bfat-breadcrumb" aria-label="Breadcrumb">
      <div class="container">
        <a href="${ASSET_PREFIX}index.html">Home</a>
        <span class="separator">&rsaquo;</span>
        <a href="${ASSET_PREFIX}financing.html">Financing</a>
        <span class="separator">&rsaquo;</span>
        <span>${escapeHtml(page.title)}</span>
      </div>
    </nav>

    <!-- Intro -->
    <section class="page-intro">
      <div class="container">
        <h1 class="display-6 fw-bold mb-3">${escapeHtml(page.h1)}</h1>
        <p class="lead text-muted mb-0">${escapeHtml(page.intro)}</p>
      </div>
    </section>

    ${page.slug === 'financing' ? `<!-- Progress Indicator -->
    <ol class="form-progress" aria-label="Application sections">
      <li class="active">Vehicle</li>
      <li>Applicant</li>
      <li>Employment</li>
      <li>Trade-In</li>
      <li>Submit</li>
    </ol>
    <!-- Security Notice -->
    <div class="security-notice">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M8 1a2 2 0 0 1 2 2v4H6V3a2 2 0 0 1 2-2zm3 6V3a3 3 0 0 0-6 0v4a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z"/></svg>
      <span>This form is transmitted securely. Sensitive information like your SSN is optional and only used to pre-qualify you for financing.</span>
    </div>` : ''}

    <!-- Form -->
    <section id="applications" class="py-4 py-md-5">
      <div class="container">
        <div class="row justify-content-center">
          <div class="col-lg-10">
            ${formContent}
          </div>
        </div>
      </div>
    </section>

    <!-- Cross-links -->
    <section class="cross-links-section">
      <div class="container">
        <h2 class="h5 fw-bold mb-3">Other Services</h2>
        <div>${crossLinks}</div>
        <a href="/inventory" class="cross-link-btn" style="border-color:var(--brand-primary);color:var(--brand-primary);">Browse Inventory</a>
      </div>
    </section>
  </main>

  <!-- FOOTER -->
  <footer style="background:#1a1a1a;color:#ccc;">
    <div class="container py-5">
      <div class="row g-5">
        <div class="col-lg-4 col-md-6">
          <h5 class="fw-bold text-white mb-3 pb-2" style="border-bottom:1px solid #444;">Contact Information</h5>
          <div class="d-flex gap-3 align-items-start mb-3">
            <div style="width:38px;height:38px;border-radius:50%;background:#dc3545;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="#fff" viewBox="0 0 16 16"><path d="M8 16s6-5.686 6-10A6 6 0 0 0 2 6c0 4.314 6 10 6 10zm0-7a3 3 0 1 1 0-6 3 3 0 0 1 0 6z"/></svg>
            </div>
            <div>
              <div class="text-white-50 small mb-1">Address</div>
              <a href="https://maps.google.com/?q=3840+Charles+Blvd+Greenville+NC" target="_blank"
                 class="text-white text-decoration-none fw-semibold">${DEALER_STREET}<br>${DEALER_CITY}, ${DEALER_STATE} ${DEALER_ZIP}</a>
            </div>
          </div>
          <div class="d-flex gap-3 align-items-start mb-4">
            <div style="width:38px;height:38px;border-radius:50%;background:#dc3545;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="#fff" viewBox="0 0 16 16"><path fill-rule="evenodd" d="M1.885.511a1.745 1.745 0 0 1 2.61.163L6.29 2.98c.329.423.445.974.315 1.494l-.547 2.19a.678.678 0 0 0 .178.643l2.457 2.457a.678.678 0 0 0 .644.178l2.189-.547a1.745 1.745 0 0 1 1.494.315l2.306 1.794c.829.645.905 1.87.163 2.611l-1.034 1.034c-.74.74-1.846 1.065-2.877.702a18.634 18.634 0 0 1-7.01-4.42 18.634 18.634 0 0 1-4.42-7.009c-.362-1.03-.037-2.137.703-2.877L1.885.511z"/></svg>
            </div>
            <div>
              <div class="text-white-50 small mb-1">Phone</div>
              <a href="tel:${DEALER_PHONE_TEL}" class="text-white text-decoration-none fw-bold" style="font-size:1.15rem;">${DEALER_PHONE}</a>
            </div>
          </div>
        </div>
        <div class="col-lg-4 col-md-6">
          <h5 class="fw-bold text-white mb-3 pb-2" style="border-bottom:1px solid #444;">Store Hours</h5>
          <table class="w-100" style="font-size:.92rem;border-collapse:separate;border-spacing:0 6px;">
            <tr><td class="text-white-50" style="width:45%;">Monday:</td><td class="text-white fw-semibold">8:00 AM \u2013 6:00 PM</td></tr>
            <tr><td class="text-white-50">Tuesday:</td><td class="text-white fw-semibold">8:00 AM \u2013 6:00 PM</td></tr>
            <tr><td class="text-white-50">Wednesday:</td><td class="text-white fw-semibold">8:00 AM \u2013 6:00 PM</td></tr>
            <tr><td class="text-white-50">Thursday:</td><td class="text-white fw-semibold">8:00 AM \u2013 6:00 PM</td></tr>
            <tr><td class="text-white-50">Friday:</td><td class="text-white fw-semibold">8:00 AM \u2013 6:00 PM</td></tr>
            <tr><td class="text-white-50">Saturday:</td><td class="text-white fw-semibold">9:00 AM \u2013 2:00 PM</td></tr>
            <tr><td class="text-white-50">Sunday:</td><td class="text-white fw-semibold">Appointment Only</td></tr>
          </table>
        </div>
        <div class="col-lg-4 col-md-12">
          <h5 class="fw-bold text-white mb-3 pb-2" style="border-bottom:1px solid #444;">Quick Links</h5>
          <ul class="list-unstyled mb-0" style="font-size:.95rem;">
            <li class="mb-2"><a href="/inventory" class="text-white-50 text-decoration-none footer-link">Inventory</a></li>
            <li class="mb-2"><a href="/financing/" class="text-white-50 text-decoration-none footer-link">Financing</a></li>
            <li class="mb-2"><a href="/schedule-test-drive/" class="text-white-50 text-decoration-none footer-link">Test Drive</a></li>
            <li class="mb-2"><a href="/trade-in-value/" class="text-white-50 text-decoration-none footer-link">Trade-In</a></li>
            <li class="mb-2"><a href="${ASSET_PREFIX}contact.html#visit" class="text-white-50 text-decoration-none footer-link">Contact Us</a></li>
          </ul>
        </div>
      </div>
    </div>
    <div style="background:#111;border-top:1px solid #333;padding:1rem 0;">
      <div class="container text-center" style="font-size:.82rem;color:#666;">
        &copy; <span id="year"></span> ${DEALER_NAME} &bull; ${DEALER_ADDRESS} &bull; ${DEALER_PHONE} &bull; Built by <a href="https://workflowefficiency.ai/" target="_blank" rel="noopener" style="color:#aaa;text-decoration:none;">Workflow Efficiency</a>
      </div>
    </div>
  </footer>

  <!-- Mobile Action Bar -->
  <nav class="mobile-action-bar d-md-none" aria-label="Quick actions">
    <a href="tel:${DEALER_PHONE_TEL}" class="mobile-action" aria-label="Call us">
      <svg width="18" height="18" fill="currentColor" viewBox="0 0 16 16" class="me-1"><path fill-rule="evenodd" d="M1.885.511a1.745 1.745 0 0 1 2.61.163L6.29 2.98c.329.423.445.974.315 1.494l-.547 2.19a.678.678 0 0 0 .178.643l2.457 2.457a.678.678 0 0 0 .644.178l2.189-.547a1.745 1.745 0 0 1 1.494.315l2.306 1.794c.829.645.905 1.87.163 2.611l-1.034 1.034c-.74.74-1.846 1.065-2.877.702a18.634 18.634 0 0 1-7.01-4.42 18.634 18.634 0 0 1-4.42-7.009c-.362-1.03-.037-2.137.703-2.877L1.885.511z"/></svg>
      Call
    </a>
    <a href="sms:${DEALER_SMS_TEL}" class="mobile-action sms-limited" aria-label="Text us">
      <svg width="18" height="18" fill="currentColor" viewBox="0 0 16 16" class="me-1"><path d="M2.678 11.894a1 1 0 0 1 .287.801 10.97 10.97 0 0 1-.398 2c1.395-.323 2.247-.697 2.634-.893a1 1 0 0 1 .71-.074A8.06 8.06 0 0 0 8 14c3.996 0 7-2.807 7-6 0-3.192-3.004-6-7-6S1 4.808 1 8c0 1.468.617 2.83 1.678 3.894zm-.493 3.905a21.682 21.682 0 0 1-.713.129c-.2.032-.352-.176-.273-.362a9.68 9.68 0 0 0 .244-.637l.003-.01c.248-.72.45-1.548.524-2.319C.743 11.37 0 9.76 0 8c0-3.866 3.582-7 8-7s8 3.134 8 7-3.582 7-8 7a9.06 9.06 0 0 1-2.347-.306c-.52.263-1.639.742-3.468 1.105z"/></svg>
      Text
    </a>
    <a href="https://maps.google.com/?q=3840+Charles+Blvd+Greenville+NC" target="_blank" class="mobile-action" aria-label="Get directions">
      <svg width="18" height="18" fill="currentColor" viewBox="0 0 16 16" class="me-1"><path d="M8 16s6-5.686 6-10A6 6 0 0 0 2 6c0 4.314 6 10 6 10zm0-7a3 3 0 1 1 0-6 3 3 0 0 1 0 6z"/></svg>
      Directions
    </a>
  </nav>

  <script src="${ASSET_PREFIX}assets/vendor/bootstrap.bundle.min.js" defer></script>
  <script>document.getElementById('year').textContent=new Date().getFullYear();</script>
  <script src="/assets/js/sms-limiter.js" defer></script>
  <script src="/assets/js/tracker.js" defer></script>
  <script>if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js');</script>
</body>
</html>`;
}

// ── Main ──

function main() {
  const financingPath = path.join(__dirname, 'financing.html');
  if (!fs.existsSync(financingPath)) {
    console.error('Error: financing.html not found');
    process.exit(1);
  }

  const financingHTML = fs.readFileSync(financingPath, 'utf-8');
  console.log('Generating standalone form pages...');

  for (const page of FORM_PAGES) {
    const formContent = extractPaneContent(financingHTML, page.paneId);
    if (!formContent) {
      console.warn(`  Warning: Could not extract form content for ${page.paneId}`);
      continue;
    }

    const dirPath = path.join(__dirname, page.slug);
    fs.mkdirSync(dirPath, { recursive: true });

    const html = generateFormPage(page, formContent);
    fs.writeFileSync(path.join(dirPath, 'index.html'), html, 'utf-8');
    console.log(`  ${page.slug}/index.html — generated`);
  }

  console.log(`Done! Generated ${FORM_PAGES.length} form pages.`);
}

main();
