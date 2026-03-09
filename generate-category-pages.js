#!/usr/bin/env node
// generate-category-pages.js — Generate static category landing pages
// Creates: /used-trucks-greenville-nc/, /used-suvs-greenville-nc/,
//          /used-cars-greenville-nc/, /used-diesel-trucks-greenville-nc/

const fs = require('fs');
const path = require('path');
const {
  SITE_URL, DEALER_NAME, DEALER_PHONE, DEALER_PHONE_TEL, DEALER_SMS_TEL,
  DEALER_ADDRESS, DEALER_STREET, DEALER_CITY, DEALER_STATE, DEALER_ZIP,
  DEALER_LAT, DEALER_LNG, DEALER_EMAIL, DEALER_FB,
  escapeHtml, escapeAttr, titleCase, formatMoney, todayISO,
  buildVDPPath, resolveImg, loadAvailableVehicles,
} = require('./build-utils');

const ASSET_PREFIX = '../';

// ── Category definitions ──

const CATEGORIES = [
  {
    slug: 'used-trucks-greenville-nc',
    filterType: 'truck',
    title: 'Used Trucks for Sale in Greenville, NC',
    metaTitle: 'Used Trucks for Sale in Greenville, NC | Bells Fork Truck & Auto',
    metaDesc: 'Browse our selection of used trucks for sale at Bells Fork Truck & Auto in Greenville, NC. F-150, Silverado, RAM, Tundra and more. Fair prices, no pressure.',
    h1: 'Used Trucks for Sale in Greenville, NC',
    intro: 'Looking for a dependable used truck in the Greenville, NC area? Bells Fork Truck & Auto carries a wide selection of pre-owned pickup trucks from Ford, Chevrolet, RAM, Toyota, and more. Every truck on our lot is inspected, fairly priced, and ready to work. Browse our current inventory below or call us to schedule a test drive.',
    whyBuyH2: 'Why Buy a Used Truck from Bells Fork?',
    whyBuyContent: `<p>Bells Fork Truck & Auto is one of the most trusted used truck dealers in the Greenville, NC area. Whether you need a heavy-duty work truck for hauling and towing, a reliable half-ton pickup for daily driving, or a diesel-powered rig built for Pitt County farms and job sites, our lot has options that fit your needs and your budget.</p>
<p>Every truck we sell goes through a multi-point inspection before it reaches the lot. We check the engine, transmission, frame, brakes, and drivetrain so you can drive away with confidence. Our pricing is based on current market data\u2014no hidden fees, no last-minute add-ons.</p>
<p>We carry popular models including Ford F-150, F-250, and F-350 Super Duty trucks, Chevrolet Silverado 1500 and 2500HD, RAM 1500 and 2500, Toyota Tundra and Tacoma, and GMC Sierra. Many of our trucks are 4x4 and ready for off-road or work conditions common across Eastern North Carolina.</p>
<p>We also offer in-house financing options for all credit situations, trade-in appraisals, and a straightforward buying process. Visit us at 3840 Charles Blvd, Greenville, NC 27858 or call <a href="tel:+12524960005">(252) 496-0005</a> to schedule a test drive.</p>`,
    faqs: [
      { q: 'What brands of used trucks do you carry?', a: 'We regularly stock Ford F-150, F-250, and F-350 trucks, Chevrolet Silverado 1500 and 2500, RAM 1500 and 2500, Toyota Tundra and Tacoma, and other popular models.' },
      { q: 'Do you offer financing on used trucks?', a: 'Yes. We work with multiple lenders to get you approved regardless of credit history. Apply online or visit us at 3840 Charles Blvd, Greenville, NC 27858.' },
      { q: 'Can I trade in my current vehicle?', a: 'Absolutely. We accept trade-ins on all purchases and offer fair market appraisals. Bring your vehicle in for a free evaluation.' },
      { q: 'Do your trucks come with a warranty?', a: 'Many of our trucks still carry remaining manufacturer warranty. Ask about extended warranty options available at the time of purchase.' },
    ],
  },
  {
    slug: 'used-suvs-greenville-nc',
    filterType: 'suv',
    title: 'Used SUVs for Sale in Greenville, NC',
    metaTitle: 'Used SUVs for Sale in Greenville, NC | Bells Fork Truck & Auto',
    metaDesc: 'Shop used SUVs at Bells Fork Truck & Auto in Greenville, NC. Tahoe, Explorer, 4Runner, Wrangler and more. Family-friendly, inspected, and priced right.',
    h1: 'Used SUVs for Sale in Greenville, NC',
    intro: 'Need a spacious, family-friendly SUV? Bells Fork Truck & Auto in Greenville, NC has a great selection of pre-owned SUVs including Chevrolet Tahoe, Ford Explorer, Toyota 4Runner, Jeep Wrangler, and more. All vehicles are inspected and priced competitively. Browse below or give us a call.',
    whyBuyH2: 'Why Buy a Used SUV from Bells Fork?',
    whyBuyContent: `<p>If you are looking for a versatile, family-friendly vehicle in Eastern North Carolina, a used SUV from Bells Fork Truck & Auto is a smart choice. SUVs offer the cargo space, passenger room, and capability that Pitt County drivers need\u2014whether it is school drop-offs in Winterville, weekend trips to the coast, or navigating unpaved roads around Farmville and Ayden.</p>
<p>Our SUV inventory includes popular models like the Chevrolet Tahoe, Suburban, and Equinox, Ford Explorer and Expedition, Toyota 4Runner and Highlander, Jeep Wrangler and Grand Cherokee, and GMC Yukon. We stock both two-wheel drive and four-wheel drive options to match your lifestyle.</p>
<p>Every SUV is inspected before listing. We verify the engine, transmission, suspension, brakes, and safety systems so you know exactly what you are getting. Our transparent pricing means no surprises at the register.</p>
<p>Financing is available for all credit profiles. Stop by our lot at 3840 Charles Blvd, Greenville, NC 27858, browse online, or call <a href="tel:+12524960005">(252) 496-0005</a> to learn more.</p>`,
    faqs: [
      { q: 'What SUV models do you have available?', a: 'Our inventory frequently includes Chevrolet Tahoe, Suburban, Equinox, Ford Explorer, Expedition, Toyota 4Runner, Highlander, Jeep Wrangler, Cherokee, and more.' },
      { q: 'Are your SUVs inspected before sale?', a: 'Yes. Every vehicle goes through a thorough inspection before it hits our lot. We want you to drive away with confidence.' },
      { q: 'Do you offer 4WD and AWD SUVs?', a: 'We carry both 4-wheel drive and all-wheel drive models. Use our inventory filters to find the drivetrain that fits your needs.' },
      { q: 'Can I schedule a test drive online?', a: 'Yes. Use our online scheduling form or call us at (252) 496-0005 to book a test drive at your convenience.' },
    ],
  },
  {
    slug: 'used-cars-greenville-nc',
    filterType: 'car',
    title: 'Used Cars for Sale in Greenville, NC',
    metaTitle: 'Used Cars for Sale in Greenville, NC | Bells Fork Truck & Auto',
    metaDesc: 'Find quality used cars for sale at Bells Fork Truck & Auto in Greenville, NC. Sedans, coupes, and more. Honest pricing, no hidden fees. Call (252) 496-0005.',
    h1: 'Used Cars for Sale in Greenville, NC',
    intro: 'Searching for a reliable used car in Greenville, NC? Bells Fork Truck & Auto offers a hand-picked selection of pre-owned sedans, coupes, and other passenger cars. From fuel-efficient commuters to sporty performers, every car we sell is inspected and priced transparently. Take a look at our inventory below.',
    whyBuyH2: 'Why Buy a Used Car from Bells Fork?',
    whyBuyContent: `<p>Bells Fork Truck & Auto offers a curated selection of pre-owned cars in Greenville, NC. Whether you need an affordable daily commuter, a fuel-efficient sedan for highway miles, or a sporty coupe, our inventory has vehicles to match your driving needs and budget.</p>
<p>We stock cars from manufacturers including Chevrolet, Ford, Toyota, Honda, Hyundai, Nissan, Subaru, and more. From practical sedans to performance-oriented models like the Chevrolet Camaro and Dodge Challenger, our selection covers a wide range of styles and price points.</p>
<p>Every car on our lot is inspected before sale. We check the engine, brakes, tires, fluid levels, and electronics to make sure it is road-ready. Our pricing is based on current market values with no hidden fees or last-minute charges.</p>
<p>We also offer financing for buyers in all credit situations, plus trade-in appraisals for your current vehicle. Visit us at 3840 Charles Blvd, Greenville, NC 27858 or call <a href="tel:+12524960005">(252) 496-0005</a> to get started.</p>`,
    faqs: [
      { q: 'What types of used cars do you sell?', a: 'We carry a variety of sedans, coupes, and sports cars from brands like Chevrolet, Ford, Toyota, Honda, Nissan, Hyundai, and more.' },
      { q: 'Are your prices negotiable?', a: 'Our vehicles are priced competitively from the start based on market data. We believe in transparent, fair pricing with no hidden fees.' },
      { q: 'Do you offer financing for used cars?', a: 'Yes. We work with a network of lenders to help you get approved. Fill out our online financing application to get started.' },
      { q: 'Where are you located?', a: 'We are located at 3840 Charles Blvd, Greenville, NC 27858. Open Monday through Friday 8 AM to 6 PM, Saturday 9 AM to 2 PM.' },
    ],
  },
  {
    slug: 'used-diesel-trucks-greenville-nc',
    filterType: 'diesel',
    title: 'Used Diesel Trucks for Sale in Greenville, NC',
    metaTitle: 'Used Diesel Trucks for Sale in Greenville, NC | Bells Fork Truck & Auto',
    metaDesc: 'Shop used diesel trucks at Bells Fork Truck & Auto in Greenville, NC. Powerstroke, Duramax, Cummins diesels. Built for towing and work. Call (252) 496-0005.',
    h1: 'Used Diesel Trucks for Sale in Greenville, NC',
    intro: 'Need a diesel truck that can handle heavy towing and hard work? Bells Fork Truck & Auto in Greenville, NC stocks pre-owned diesel pickups including Ford Powerstroke, Chevy Duramax, and RAM Cummins models. Our diesels are inspected, competitively priced, and ready for the job site or the farm.',
    whyBuyH2: 'Why Buy a Used Diesel Truck from Bells Fork?',
    whyBuyContent: `<p>Diesel trucks are built for serious work, and Bells Fork Truck & Auto in Greenville, NC is the place to find them. Our diesel inventory includes heavy-duty pickups from Ford, Chevrolet, RAM, and GMC\u2014trucks designed for towing, hauling, and commercial applications across Pitt County and Eastern North Carolina.</p>
<p>We carry popular diesel powertrains including the Ford Power Stroke, Chevrolet/GMC Duramax, and RAM Cummins. These engines are known for their torque, durability, and long service life\u2014making a used diesel truck an excellent investment for farmers, contractors, and business owners in the Greenville area.</p>
<p>Every diesel truck on our lot is inspected with special attention to the engine, turbo system, exhaust after-treatment, transmission, and drivetrain. We look for trucks that still have plenty of working life ahead of them so you can put them to use right away.</p>
<p>We offer financing options for all credit situations. Whether you are a first-time diesel buyer or adding to a fleet, we can help. Visit us at 3840 Charles Blvd, Greenville, NC 27858 or call <a href="tel:+12524960005">(252) 496-0005</a>.</p>`,
    faqs: [
      { q: 'What diesel truck brands do you carry?', a: 'We stock Ford Super Duty with Powerstroke, Chevrolet Silverado with Duramax, RAM with Cummins, and other diesel models as they become available.' },
      { q: 'Are your diesel trucks inspected?', a: 'Every diesel goes through a comprehensive inspection. We check the engine, turbo system, emissions equipment, and drivetrain before listing.' },
      { q: 'Do you offer financing on diesel trucks?', a: 'Yes. Diesel trucks are a bigger investment, and we work with lenders who understand that. Apply online or visit us to discuss your options.' },
      { q: 'Can I use my diesel truck for commercial work?', a: 'Many of our diesel trucks are well-suited for commercial and agricultural use. Ask us about specific towing capacities and work-ready options.' },
    ],
  },
];

// ── Build a vehicle card (matches inventory page format) ──

function buildCard(v) {
  const title = `${v.year} ${v.make} ${v.model}`;
  const trim = v.trim || '';
  const price = v.price ? `$${Number(v.price).toLocaleString('en-US')}` : 'Call for Price';
  const miles = v.mileage ? `${Number(v.mileage).toLocaleString('en-US')} mi` : '\u2014';
  const stock = v.stockNumber ? `Stock #: ${escapeHtml(v.stockNumber)}` : '';
  const engine = escapeHtml(v.engine || '\u2014');
  const trans = escapeHtml(v.transmission || '\u2014');
  const drive = escapeHtml(v.drivetrain || '\u2014');
  const extColor = escapeHtml(v.exteriorColor || '\u2014');
  const fuel = escapeHtml(v.fuelType || '\u2014');
  const vdpUrl = buildVDPPath(v);
  const mainImage = v.images && v.images.length > 0 ? String(v.images[0]).trim() : '';
  const resolvedSrc = resolveImg(mainImage, ASSET_PREFIX);
  const imgHtml = mainImage
    ? `<img src="${escapeAttr(resolvedSrc)}" alt="${escapeAttr(title)}" loading="lazy" decoding="async">`
    : `<div class="inv-img-placeholder"><svg width="48" height="48" fill="#bbb" viewBox="0 0 16 16"><rect x="1" y="3" width="15" height="13" rx="1" fill="none" stroke="currentColor" stroke-width="1"/></svg><span style="font-size:.75rem;">Photo Coming Soon</span></div>`;

  const fullTitle = title + (trim ? ' ' + trim : '');

  return `<div class="inv-row mb-2">
<div class="inv-row-header"></div>
<div class="inv-row-body">
<a href="${vdpUrl}" class="inv-img-col" style="text-decoration:none;">${imgHtml}</a>
<div class="inv-info-col">
<a href="${vdpUrl}" class="inv-vehicle-title">${escapeHtml(title)}${trim ? ` <span class="inv-trim-label">${escapeHtml(trim)}</span>` : ''}</a>
<div class="inv-stock-vin">${stock}</div>
<div class="inv-spec-grid">
<div class="inv-spec-row"><span class="inv-spec-label">Mileage:</span><span class="inv-spec-value">${miles}</span></div>
<div class="inv-spec-row"><span class="inv-spec-label">Engine:</span><span class="inv-spec-value">${engine}</span></div>
<div class="inv-spec-row"><span class="inv-spec-label">Trans:</span><span class="inv-spec-value">${trans}</span></div>
<div class="inv-spec-row"><span class="inv-spec-label">Drive:</span><span class="inv-spec-value">${drive}</span></div>
<div class="inv-spec-row"><span class="inv-spec-label">Color:</span><span class="inv-spec-value">${extColor}</span></div>
<div class="inv-spec-row"><span class="inv-spec-label">Fuel:</span><span class="inv-spec-value">${fuel}</span></div>
</div>
</div>
<div class="inv-action-col">
<div class="inv-price-retail">Our Price</div>
<div class="inv-price-main${v.price ? '' : ' call-price'}">${price}</div>
<a href="${vdpUrl}" class="inv-btn inv-btn-details">View Details</a>
<a href="${ASSET_PREFIX}financing.html?vehicle=${encodeURIComponent(fullTitle)}&stock=${encodeURIComponent(v.stockNumber||'')}&price=${encodeURIComponent(v.price||'')}#applications" class="inv-btn inv-btn-financing">Apply for Financing</a>
<a href="${ASSET_PREFIX}contact.html?vehicle=${encodeURIComponent(fullTitle)}&stock=${encodeURIComponent(v.stockNumber||'')}#appointment" class="inv-btn inv-btn-inquiry">Inquiry</a>
</div>
</div>
</div>`;
}

// ── Build FAQ schema ──

function buildFAQSchema(faqs) {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map(f => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  }, null, 2);
}

// ── Build ItemList schema ──

function buildItemListSchema(vehicles, category) {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: category.title,
    numberOfItems: vehicles.length,
    itemListElement: vehicles.slice(0, 20).map((v, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: `${SITE_URL}${buildVDPPath(v)}`,
      name: `${v.year} ${titleCase(v.make)} ${titleCase(v.model)}${v.trim ? ' ' + v.trim : ''}`,
    })),
  }, null, 2);
}

// ── Generate full page HTML ──

function generateCategoryPage(cat, vehicles, allCategories) {
  const filtered = vehicles.filter(v => v._inferredType === cat.filterType);
  filtered.sort((a, b) => new Date(b.dateAdded || 0) - new Date(a.dateAdded || 0));

  const cardsHTML = filtered.map(v => buildCard(v)).join('\n');
  const crossLinks = allCategories
    .filter(c => c.slug !== cat.slug)
    .map(c => `<a href="/${c.slug}/" class="btn btn-outline-secondary btn-sm me-2 mb-2">${c.title.replace(' in Greenville, NC', '')}</a>`)
    .join('');

  const faqHTML = cat.faqs.map(f =>
    `<div class="mb-4"><h3 class="h6 fw-bold">${escapeHtml(f.q)}</h3><p class="text-muted mb-0">${escapeHtml(f.a)}</p></div>`
  ).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(cat.metaTitle)}</title>
  <meta name="description" content="${escapeAttr(cat.metaDesc)}">
  <link rel="canonical" href="${SITE_URL}/${cat.slug}/">
  <link rel="sitemap" type="application/xml" href="/sitemap.xml">
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">
  <meta name="geo.region" content="US-NC">
  <meta name="geo.placename" content="${DEALER_CITY}, North Carolina">
  <meta name="geo.position" content="${DEALER_LAT};${DEALER_LNG}">
  <meta name="ICBM" content="${DEALER_LAT}, ${DEALER_LNG}">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${escapeAttr(cat.metaTitle)}">
  <meta property="og:description" content="${escapeAttr(cat.metaDesc)}">
  <meta property="og:url" content="${SITE_URL}/${cat.slug}/">
  <meta property="og:image" content="${SITE_URL}/assets/hero/shop-front-og.jpg">
  <meta property="og:site_name" content="${DEALER_NAME}">
  <link rel="icon" type="image/png" href="${ASSET_PREFIX}assets/favicon.png">
  <link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet"
        integrity="sha384-QWTKZyjpPEjISv5WaRU9OFeRpok6YctnYmDr5pNlyT2bRjXh0JMhjY6hW+ALEwIH" crossorigin="anonymous">
  <link href="${ASSET_PREFIX}style.min.css" rel="stylesheet">
  <script type="application/ld+json">
${buildItemListSchema(filtered, cat)}
  </script>
  <script type="application/ld+json">
${buildFAQSchema(cat.faqs)}
  </script>
  <style>
    .bfat-navlink{font-size:.88rem;letter-spacing:.07em;color:#ffffff!important;transition:background .18s,color .18s}
    .bfat-navlink:hover,.bfat-navlink:focus,.bfat-navlink.active{background:#dc3545!important;color:#ffffff!important}
    .footer-link:hover{color:#fff!important}
    .site-identity-bar{position:relative}
    @media(max-width:576px){.site-identity-bar .ms-auto{margin-left:0!important}.site-identity-bar a[style*="position:absolute"]{position:static!important;transform:none!important;display:block;text-align:center;margin:.5rem auto}}
  </style>
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
            <li class="nav-item"><a class="nav-link px-4 py-3 fw-semibold text-uppercase bfat-navlink active" href="/inventory">Inventory</a></li>
            <li class="nav-item"><a class="nav-link px-4 py-3 fw-semibold text-uppercase bfat-navlink" href="${ASSET_PREFIX}about.html">About</a></li>
            <li class="nav-item"><a class="nav-link px-4 py-3 fw-semibold text-uppercase bfat-navlink" href="${ASSET_PREFIX}reviews.html">Reviews</a></li>
            <li class="nav-item"><a class="nav-link px-4 py-3 fw-semibold text-uppercase bfat-navlink" href="${ASSET_PREFIX}financing.html">Financing</a></li>
            <li class="nav-item"><a class="nav-link px-4 py-3 fw-semibold text-uppercase bfat-navlink" href="${ASSET_PREFIX}contact.html#visit">Contact</a></li>
            <li class="nav-item"><a class="nav-link px-4 py-3 fw-semibold text-uppercase bfat-navlink" href="${ASSET_PREFIX}blog.html">Blog</a></li>
          </ul>
        </div>
      </div>
    </nav>
  </header>

  <main>
    <!-- Breadcrumb -->
    <nav class="vdp-breadcrumb" aria-label="Breadcrumb" style="background:#f9f9f9;border-bottom:1px solid #eee;padding:.6rem 0;font-size:.85rem;">
      <div class="container">
        <a href="${ASSET_PREFIX}index.html">Home</a>
        <span class="sep">&rsaquo;</span>
        <a href="/inventory">Inventory</a>
        <span class="sep">&rsaquo;</span>
        <span>${escapeHtml(cat.title.replace(' in Greenville, NC', ''))}</span>
      </div>
    </nav>

    <!-- Hero / Intro -->
    <section class="py-4 py-md-5" style="background:#f1f1f1;">
      <div class="container">
        <h1 class="display-6 fw-bold mb-3">${escapeHtml(cat.h1)}</h1>
        <p class="lead text-muted mb-2">${escapeHtml(cat.intro)}</p>
        <p class="text-muted mb-0"><strong>${filtered.length}</strong> vehicle${filtered.length !== 1 ? 's' : ''} available</p>
      </div>
    </section>

    <!-- Vehicle Listings -->
    <section class="py-4" style="background:#f1f1f1;">
      <div class="container">
        ${cardsHTML || '<p class="text-center text-muted py-5">No vehicles currently available in this category. Check back soon or <a href="/inventory">browse all inventory</a>.</p>'}
      </div>
    </section>

    <!-- Why Buy Content (SEO depth) -->
    ${cat.whyBuyContent ? `<section class="py-5 bg-white">
      <div class="container" style="max-width:800px;">
        <h2 class="h4 fw-bold mb-4">${escapeHtml(cat.whyBuyH2 || 'Why Buy from Bells Fork?')}</h2>
        ${cat.whyBuyContent}
      </div>
    </section>` : ''}

    <!-- Cross-links to other categories -->
    <section class="py-4 bg-white">
      <div class="container">
        <h2 class="h5 fw-bold mb-3">Browse Other Categories</h2>
        <div>${crossLinks}</div>
        <a href="/inventory" class="btn btn-outline-dark btn-sm mt-2">View All Inventory</a>
      </div>
    </section>

    <!-- FAQ -->
    <section class="py-5" style="background:#f9f9f9;">
      <div class="container">
        <h2 class="h4 fw-bold mb-4">Frequently Asked Questions</h2>
        ${faqHTML}
      </div>
    </section>

    <!-- Financing CTA -->
    <div class="text-center my-4">
      <a href="${ASSET_PREFIX}financing.html" class="btn btn-primary btn-lg">Apply for Financing</a>
      <p class="text-muted small mt-2 mb-0">All credit situations welcome. Quick online application.</p>
    </div>

    <!-- Areas Served -->
    <section class="py-4 bg-light">
      <div class="container">
        <h2 class="h6 fw-bold mb-2">Serving Eastern North Carolina</h2>
        <p class="small text-muted mb-0">${DEALER_NAME} proudly serves Greenville, Winterville, Ayden, Farmville, Washington, Kinston, New Bern, Jacksonville, and all of Pitt County. Visit us at ${DEALER_STREET}, ${DEALER_CITY}, ${DEALER_STATE} ${DEALER_ZIP} or call <a href="tel:${DEALER_PHONE_TEL}">${DEALER_PHONE}</a>.</p>
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
          <h5 class="fw-bold text-white mb-3 pb-2" style="border-bottom:1px solid #444;">Browse Inventory</h5>
          <ul class="list-unstyled mb-0" style="font-size:.95rem;">
            <li class="mb-2"><a href="/used-trucks-greenville-nc/" class="text-white-50 text-decoration-none footer-link">Used Trucks</a></li>
            <li class="mb-2"><a href="/used-suvs-greenville-nc/" class="text-white-50 text-decoration-none footer-link">Used SUVs</a></li>
            <li class="mb-2"><a href="/used-cars-greenville-nc/" class="text-white-50 text-decoration-none footer-link">Used Cars</a></li>
            <li class="mb-2"><a href="/used-diesel-trucks-greenville-nc/" class="text-white-50 text-decoration-none footer-link">Diesel Trucks</a></li>
            <li class="mb-2"><a href="/inventory" class="text-white-50 text-decoration-none footer-link">All Inventory</a></li>
            <li class="mb-2"><a href="${ASSET_PREFIX}financing.html" class="text-white-50 text-decoration-none footer-link">Financing</a></li>
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
  <div class="mobile-action-bar d-lg-none">
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
  </div>

  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>
  <script>document.getElementById('year').textContent=new Date().getFullYear();</script>
  <script src="/assets/js/sms-limiter.js" defer></script>
  <script src="/assets/js/tracker.js" defer></script>
  <script>if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js');</script>
</body>
</html>`;
}

// ── Main ──

function main() {
  const vehicles = loadAvailableVehicles();
  console.log(`Generating category pages for ${vehicles.length} vehicles...`);

  for (const cat of CATEGORIES) {
    const dirPath = path.join(__dirname, cat.slug);
    fs.mkdirSync(dirPath, { recursive: true });

    const html = generateCategoryPage(cat, vehicles, CATEGORIES);
    const filePath = path.join(dirPath, 'index.html');
    fs.writeFileSync(filePath, html, 'utf-8');

    const count = vehicles.filter(v => v._inferredType === cat.filterType).length;
    console.log(`  ${cat.slug}/index.html — ${count} vehicles`);
  }

  console.log(`Done! Generated ${CATEGORIES.length} category pages.`);
}

main();
