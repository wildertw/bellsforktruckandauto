#!/usr/bin/env node
// prerender-homepage.js — Inject crawlable HTML into index.html
// Pre-renders: popular body styles, popular makes, popular make-models, reviews fallback
// Run AFTER generate-vdp.js (needs inventory.json)

const fs = require('fs');
const path = require('path');
const {
  escapeHtml, titleCase, loadAvailableVehicles,
} = require('./build-utils');

// ── Helpers ──

function countBy(arr, keyFn) {
  const map = new Map();
  arr.forEach(item => {
    const k = keyFn(item);
    if (!k) return;
    map.set(k, (map.get(k) || 0) + 1);
  });
  return map;
}

function topEntries(map, limit = 10) {
  return Array.from(map.entries())
    .sort((a, b) => (b[1] - a[1]) || String(a[0]).localeCompare(String(b[0])))
    .slice(0, limit);
}

function typeLabel(t) {
  const type = String(t || '').toLowerCase();
  if (type === 'truck' || type.includes('pickup')) return 'Pickup Trucks';
  if (type === 'suv' || type.includes('crossover')) return 'SUVs';
  if (type === 'car' || type.includes('sedan')) return 'Cars';
  if (type === 'diesel') return 'Diesel Vehicles';
  return titleCase(type || 'Other');
}

// SVG icons for body styles (matches client-side getVehicleIconSVG)
function vehicleIconSVG(typeKey, size = 28, color = 'currentColor') {
  const s = Number(size);
  const icons = {
    truck: `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 14l1-4h8l2 4"/><path d="M12 14h5l3-3h1a2 2 0 0 1 2 2v3H1v-2"/><circle cx="6" cy="17" r="2"/><circle cx="17" cy="17" r="2"/></svg>`,
    suv: `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 14l2-6h14l2 6"/><path d="M1 14h22v3H1z"/><circle cx="6" cy="17" r="2"/><circle cx="18" cy="17" r="2"/></svg>`,
    car: `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 14l2-5h10l2 5"/><path d="M3 14h18v4H3z"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/></svg>`,
    diesel: `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 14l1-4h8l2 4"/><path d="M12 14h5l3-3h1a2 2 0 0 1 2 2v3H1v-2"/><circle cx="6" cy="17" r="2"/><circle cx="17" cy="17" r="2"/><path d="M15 7v3" stroke-width="2"/></svg>`,
  };
  return icons[typeKey] || icons.car;
}

// ── Build popular sections HTML ──

function buildPopularHTML(vehicles) {
  // Use _inferredType from loadAvailableVehicles
  const typeCounts = countBy(vehicles, v => (v._inferredType || '').toLowerCase().trim() || 'other');
  const makeCounts = countBy(vehicles, v => titleCase(v.make));
  const makeModelCounts = countBy(vehicles, v => {
    const mk = titleCase(v.make);
    const md = titleCase(v.model);
    return (mk && md) ? `${mk}||${md}` : '';
  });

  const topTypes = topEntries(typeCounts, 9).map(([key, count]) => ({
    label: `${typeLabel(key)} (${count})`,
    href: `/inventory?type=${encodeURIComponent(key)}`,
    typeKey: key,
  }));

  const topMakes = topEntries(makeCounts, 12).map(([key, count]) => ({
    label: `${key} (${count})`,
    href: `/inventory?make=${encodeURIComponent(key)}`,
  }));

  const topMakeModels = topEntries(makeModelCounts, 20).map(([key, count]) => {
    const parts = String(key).split('||');
    const mk = parts[0] || '';
    const model = parts[1] || '';
    return {
      label: `${mk} ${model} (${count})`.trim(),
      href: `/inventory?make=${encodeURIComponent(mk)}&model=${encodeURIComponent(model)}`,
    };
  });

  const bodyStylesHTML = topTypes.map(i => {
    const icon = vehicleIconSVG(i.typeKey, 28, 'currentColor');
    return `<a href="${i.href}">${icon} ${escapeHtml(i.label)}</a>`;
  }).join('');

  const makesHTML = topMakes.map(i =>
    `<a href="${i.href}">${escapeHtml(i.label)}</a>`
  ).join('');

  const makeModelsHTML = topMakeModels.map(i =>
    `<a href="${i.href}">${escapeHtml(i.label)}</a>`
  ).join('');

  return { bodyStylesHTML, makesHTML, makeModelsHTML };
}

// ── Build reviews fallback HTML ──

function buildReviewsHTML() {
  const reviews = [
    { author: 'Michael R.', rating: 5, text: 'Found a great F-150 at Bells Fork. The price was fair and they were upfront about everything. No pressure, no games. Highly recommend.' },
    { author: 'Sarah J.', rating: 5, text: 'Bought a used RAV4 here and it was exactly as described. They showed me the inspection report and walked me through everything. Honest dealers are hard to find.' },
    { author: 'David P.', rating: 5, text: 'Picked up a diesel RAM for my business. They had it ready and the whole process was smooth. Best vehicle buying experience I\'ve had.' },
  ];

  return reviews.map(r => {
    let stars = '';
    for (let i = 0; i < 5; i++) stars += i < r.rating ? '\u2605' : '\u2606';
    return `<div class="col-md-4"><div class="card p-4 h-100 border-0 shadow-sm"><div class="text-warning mb-2">${stars}</div><p class="fst-italic text-muted">\u201c${escapeHtml(r.text)}\u201d</p><div class="fw-bold mt-auto">\u2013 ${escapeHtml(r.author)}</div></div></div>`;
  }).join('');
}

// ── Main ──

function main() {
  const indexPath = path.join(__dirname, 'index.html');
  if (!fs.existsSync(indexPath)) {
    console.error('Error: index.html not found');
    process.exit(1);
  }

  const vehicles = loadAvailableVehicles();
  console.log(`Pre-rendering homepage with ${vehicles.length} vehicles...`);

  let html = fs.readFileSync(indexPath, 'utf-8');

  // Inject popular sections
  const { bodyStylesHTML, makesHTML, makeModelsHTML } = buildPopularHTML(vehicles);

  // Use function replacements to avoid $ in content being interpreted as back-refs
  html = html.replace(
    /(<div[^>]*id="popularBodyStyles"[^>]*>)([\s\S]*?)(<\/div>)/,
    (_m, open, _c, close) => `${open}${bodyStylesHTML}${close}`
  );
  html = html.replace(
    /(<div[^>]*id="popularMakes"[^>]*>)([\s\S]*?)(<\/div>)/,
    (_m, open, _c, close) => `${open}${makesHTML}${close}`
  );
  html = html.replace(
    /(<div[^>]*id="popularMakeModels"[^>]*>)([\s\S]*?)(<\/div>)/,
    (_m, open, _c, close) => `${open}${makeModelsHTML}${close}`
  );

  // Inject reviews fallback HTML (client-side JS will overwrite with live data)
  const reviewsHTML = buildReviewsHTML();
  html = html.replace(
    /(<div[^>]*class="row g-4"[^>]*id="homeReviews"[^>]*>)([\s\S]*?)(<\/div>)/,
    (_m, open, _c, close) => `${open}${reviewsHTML}${close}`
  );

  fs.writeFileSync(indexPath, html, 'utf-8');
  console.log('Homepage pre-rendered:');
  console.log(`  - Popular Body Styles: ${bodyStylesHTML ? 'injected' : 'empty'}`);
  console.log(`  - Popular Makes: ${makesHTML ? 'injected' : 'empty'}`);
  console.log(`  - Popular Make Models: ${makeModelsHTML ? 'injected' : 'empty'}`);
  console.log(`  - Reviews fallback: injected`);
}

main();
