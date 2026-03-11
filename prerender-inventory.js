#!/usr/bin/env node
// prerender-inventory.js — Inject crawlable vehicle cards into inventory.html
// Pre-renders all available vehicles as static HTML so search engines can index them.
// Client-side JS will overwrite on interaction (filtering/sorting).

const fs = require('fs');
const path = require('path');
const {
  escapeHtml, escapeAttr, titleCase, formatMoney, loadAvailableVehicles,
  buildVDPPath, resolveImg,
} = require('./build-utils');

// ── Build a single vehicle card (mirrors client-side buildRow) ──

function buildRow(v) {
  const title = `${v.year} ${v.make} ${v.model}`;
  const trim = v.trim || '';
  const price = v.price ? `$${Number(v.price).toLocaleString('en-US')}` : 'Call for Price';
  const miles = v.mileage ? `${Number(v.mileage).toLocaleString('en-US')} mi` : '\u2014';
  const stock = v.stockNumber ? `Stock #: ${escapeHtml(v.stockNumber)}` : '';
  const engine = escapeHtml(v.engine || '\u2014');
  const trans = escapeHtml(v.transmission || '\u2014');
  const drive = escapeHtml(v.drivetrain || '\u2014');
  const fuel = escapeHtml(v.fuelType || '\u2014');

  // Use resolved color display (from paint code/OEM scan/name), fallback to raw field
  const colorDisplay = v._colorDisplay || {};
  const extColorName = colorDisplay.exterior_color_name || v.exteriorColor || '';
  const extColor = escapeHtml(extColorName || '\u2014');
  const swatchHex = colorDisplay.web_swatch_hex || '';

  const vdpUrl = buildVDPPath(v);

  // Use public images (OEM label photos filtered out)
  const pubImages = v._publicImages || v.images || [];
  const mainImage = pubImages.length > 0 ? String(pubImages[0]).trim() : '';
  const resolvedSrc = resolveImg(mainImage);
  const imgHtml = mainImage
    ? `<img src="${escapeAttr(resolvedSrc)}" alt="${escapeAttr(title)}" width="260" height="200" loading="lazy" decoding="async"${mainImage.startsWith('http') ? '' : ` data-local-image="${escapeAttr(mainImage)}"`}>`
    : `<div class="inv-img-placeholder"><svg width="48" height="48" fill="#bbb" viewBox="0 0 16 16"><rect x="1" y="3" width="15" height="13" rx="1" fill="none" stroke="currentColor" stroke-width="1"/><circle cx="5.5" cy="14.5" r="1.5" fill="currentColor"/><circle cx="12.5" cy="14.5" r="1.5" fill="currentColor"/></svg><span style="font-size:.75rem;">Photo Coming Soon</span></div>`;

  const fullTitle = title + (trim ? ' ' + trim : '');
  const stockParam = encodeURIComponent(v.stockNumber || '');
  const vehicleParam = encodeURIComponent(fullTitle);
  const priceParam = encodeURIComponent(v.price || '');

  return `<div class="inv-row mb-2">
<div class="inv-row-header"></div>
<div class="inv-row-body">
<a href="${vdpUrl}" class="inv-img-col" style="text-decoration:none;">${imgHtml}</a>
<div class="inv-info-col" style="position:relative;">
<a href="${vdpUrl}" class="inv-vehicle-title">${escapeHtml(title)}${trim ? ` <span class="inv-trim-label">${escapeHtml(trim)}</span>` : ''}</a>
<div class="inv-stock-vin">${stock}</div>
<div class="inv-spec-grid">
<div class="inv-spec-row"><span class="inv-spec-label">Mileage:</span><span class="inv-spec-value">${miles}</span></div>
<div class="inv-spec-row"><span class="inv-spec-label">Engine:</span><span class="inv-spec-value">${engine}</span></div>
<div class="inv-spec-row"><span class="inv-spec-label">Trans:</span><span class="inv-spec-value">${trans}</span></div>
<div class="inv-spec-row"><span class="inv-spec-label">Drive:</span><span class="inv-spec-value">${drive}</span></div>
<div class="inv-spec-row"><span class="inv-spec-label">Color:</span><span class="inv-spec-value">${swatchHex ? `<span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${swatchHex};border:1px solid #ccc;vertical-align:middle;margin-right:4px;"></span>` : ''}${extColor}</span></div>
<div class="inv-spec-row"><span class="inv-spec-label">Fuel:</span><span class="inv-spec-value">${fuel}</span></div>
</div>
</div>
<div class="inv-action-col">
<div class="inv-price-retail">Our Price</div>
<div class="inv-price-main${v.price ? '' : ' call-price'}">${price}</div>
<a href="${vdpUrl}" class="inv-btn inv-btn-details">View Details</a>
<a href="financing.html?vehicle=${vehicleParam}&stock=${stockParam}&price=${priceParam}#applications" class="inv-btn inv-btn-financing">Apply for Financing</a>
<a href="contact.html?vehicle=${vehicleParam}&stock=${stockParam}#appointment" class="inv-btn inv-btn-inquiry">Inquiry</a>
</div>
</div>
</div>`;
}

// ── Main ──

function main() {
  const invPath = path.join(__dirname, 'inventory.html');
  if (!fs.existsSync(invPath)) {
    console.error('Error: inventory.html not found');
    process.exit(1);
  }

  const vehicles = loadAvailableVehicles();
  // Sort by dateAdded descending (newest first) — same as default client-side sort
  vehicles.sort((a, b) => new Date(b.dateAdded || 0) - new Date(a.dateAdded || 0));

  console.log(`Pre-rendering inventory page with ${vehicles.length} vehicles...`);

  let html = fs.readFileSync(invPath, 'utf-8');

  // Build all vehicle cards
  const cardsHTML = vehicles.map(v => buildRow(v)).join('\n');

  // Inject into #inventoryList (use function replacement to avoid $1/$2 in prices being interpreted as back-refs)
  html = html.replace(
    /(<div\s+id="inventoryList"[^>]*>)([\s\S]*?)(<\/div>\s*<\/div>\s*<\/section>)/,
    (_match, open, _content, close) => `${open}\n${cardsHTML}\n${close}`
  );

  // Update vehicle count text
  const countText = `${vehicles.length} Vehicle${vehicles.length !== 1 ? 's' : ''} Available`;
  html = html.replace(
    /(<span\s+id="vehicleCount"[^>]*>)([\s\S]*?)(<\/span>)/,
    (_match, open, _content, close) => `${open}${countText}${close}`
  );

  fs.writeFileSync(invPath, html, 'utf-8');
  console.log(`Inventory page pre-rendered: ${vehicles.length} vehicle cards injected`);
}

main();
