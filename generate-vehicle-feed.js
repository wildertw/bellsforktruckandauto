#!/usr/bin/env node
// generate-vehicle-feed.js — Vehicle listing feed generator for external platforms
//
// Outputs:
//   feeds/vehicles.xml  — Google Vehicle Listings XML feed (Google Merchant Center)
//   feeds/vehicles.csv  — CARVID/Facebook Marketplace CSV feed
//
// Usage: node generate-vehicle-feed.js
// Add to build: "build:feeds": "node generate-vehicle-feed.js"

'use strict';

const fs = require('fs');
const path = require('path');
const {
  SITE_URL, DEALER_NAME, DEALER_ADDRESS, DEALER_CITY, DEALER_STATE, DEALER_ZIP,
  escapeHtml, titleCase, buildVDPPath, resolveImgAbs, filterPublicImages,
} = require('./build-utils');

const INVENTORY_PATH = path.join(__dirname, 'inventory.json');
const FEEDS_DIR = path.join(__dirname, 'feeds');
const GOOGLE_FEED_PATH = path.join(FEEDS_DIR, 'vehicles.xml');
const CARVID_FEED_PATH = path.join(FEEDS_DIR, 'vehicles.csv');

// Maximum additional images to include per vehicle (Google supports up to 10 total)
const MAX_ADDITIONAL_IMAGES = 9;

// ── Helpers ──

function e(str) {
  return escapeHtml(String(str ?? ''));
}

function vehicleTitle(v) {
  const parts = [v.year, titleCase(v.make), titleCase(v.model)];
  if (v.trim) parts.push(v.trim);
  return parts.join(' ');
}

function normalizeBodyStyle(v) {
  const t = String(v.type || '').toLowerCase();
  if (t === 'truck' || t === 'pickup') return 'Pickup';
  if (t === 'suv' || t === 'crossover') return 'SUV';
  if (t === 'van' || t === 'minivan') return 'Minivan';
  if (t === 'car' || t === 'sedan') return 'Sedan';
  if (t === 'coupe') return 'Coupe';
  if (t === 'convertible') return 'Convertible';
  if (t === 'wagon') return 'Wagon';
  // Fallback: infer from model name
  const model = String(v.model || '').toLowerCase();
  if (/f-?150|f-?250|f-?350|silverado|sierra|tundra|tacoma|ram|ranger|colorado|canyon|titan|frontier/.test(model)) return 'Pickup';
  if (/suburban|tahoe|bronco|explorer|expedition|4runner|highlander|pathfinder|pilot|traverse|blazer|equinox|wrangler|cherokee|durango|sequoia/.test(model)) return 'SUV';
  return 'Car';
}

function normalizeDrivetrain(v) {
  const d = String(v.drivetrain || '').toUpperCase();
  if (d === '4WD' || d === '4X4') return '4WD';
  if (d === 'AWD') return 'AWD';
  if (d === 'FWD') return 'FWD';
  if (d === 'RWD' || d === '2WD') return 'RWD';
  return d || '';
}

function buildVDPUrl(v) {
  return `${SITE_URL}${buildVDPPath(v)}`;
}

function getVehicleImages(v) {
  const raw = Array.isArray(v.images) ? v.images : [];
  const publicImgs = filterPublicImages ? filterPublicImages(raw) : raw;
  return publicImgs.map(resolveImgAbs).filter(Boolean);
}

// ── CSV escaping ──

function csvCell(val) {
  const s = String(val ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function csvRow(cells) {
  return cells.map(csvCell).join(',');
}

// ── Load inventory ──

const raw = JSON.parse(fs.readFileSync(INVENTORY_PATH, 'utf8'));
const vehicles = (raw.vehicles || []).filter(
  v => v.status === 'available' && v.vin && v.price > 0
);

console.log(`Loaded ${vehicles.length} available vehicles from inventory.json`);

// ── Ensure output directory ──

if (!fs.existsSync(FEEDS_DIR)) {
  fs.mkdirSync(FEEDS_DIR, { recursive: true });
}

// ══════════════════════════════════════════════════════════════════
// 1. Google Vehicle Listings XML Feed
//    Spec: https://support.google.com/merchants/answer/10899477
//    Format: RSS 2.0 with Google Base (g:) namespace
// ══════════════════════════════════════════════════════════════════

function buildGoogleFeed(vehicles) {
  const now = new Date().toUTCString();

  const items = vehicles.map(v => {
    const images = getVehicleImages(v);
    const primaryImage = images[0] || `${SITE_URL}/assets/hero/shop-front-og.jpg`;
    const additionalImages = images.slice(1, MAX_ADDITIONAL_IMAGES + 1);
    const vdpUrl = buildVDPUrl(v);
    const bodyStyle = normalizeBodyStyle(v);
    const drivetrain = normalizeDrivetrain(v);
    const transmission = v.transmission || '';
    const fuelType = v.fuelType || v.fuel_type || 'Gasoline';
    const mileage = v.mileage ? `${Number(v.mileage).toLocaleString()} mi` : '';
    const features = Array.isArray(v.features) ? v.features.join(', ') : '';
    const description = v.description || `${vehicleTitle(v)} available at ${DEALER_NAME} in ${DEALER_CITY}, ${DEALER_STATE}.`;

    const addlImgXml = additionalImages
      .map(img => `      <g:additional_image_link>${e(img)}</g:additional_image_link>`)
      .join('\n');

    return `    <item>
      <g:id>${e(v.stockNumber || v.vin)}</g:id>
      <g:title>${e(vehicleTitle(v))}</g:title>
      <g:description>${e(description)}</g:description>
      <g:link>${e(vdpUrl)}</g:link>
      <g:image_link>${e(primaryImage)}</g:image_link>
${addlImgXml ? addlImgXml + '\n' : ''}      <g:condition>used</g:condition>
      <g:availability>in stock</g:availability>
      <g:price>${Number(v.price).toFixed(2)} USD</g:price>
      <g:brand>${e(titleCase(v.make))}</g:brand>
      <g:mpn>${e(v.vin)}</g:mpn>
      <g:vehicle_year>${e(v.year)}</g:vehicle_year>
      <g:vehicle_make>${e(titleCase(v.make))}</g:vehicle_make>
      <g:vehicle_model>${e(titleCase(v.model))}</g:vehicle_model>
${v.trim ? `      <g:vehicle_trim>${e(v.trim)}</g:vehicle_trim>\n` : ''}\
      <g:vehicle_vin>${e(v.vin)}</g:vehicle_vin>
${mileage ? `      <g:vehicle_mileage>${e(mileage)}</g:vehicle_mileage>\n` : ''}\
${bodyStyle ? `      <g:vehicle_body_style>${e(bodyStyle)}</g:vehicle_body_style>\n` : ''}\
${transmission ? `      <g:vehicle_transmission>${e(transmission)}</g:vehicle_transmission>\n` : ''}\
${drivetrain ? `      <g:vehicle_drivetrain>${e(drivetrain)}</g:vehicle_drivetrain>\n` : ''}\
${v.exteriorColor ? `      <g:color>${e(v.exteriorColor)}</g:color>\n` : ''}\
${fuelType ? `      <g:vehicle_fuel_type>${e(fuelType)}</g:vehicle_fuel_type>\n` : ''}\
${features ? `      <g:vehicle_option>${e(features)}</g:vehicle_option>\n` : ''}\
      <g:custom_label_0>${e(titleCase(v.make))}</g:custom_label_0>
      <g:custom_label_1>${e(bodyStyle)}</g:custom_label_1>
      <g:custom_label_2>${e(String(v.year))}</g:custom_label_2>
    </item>`;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>${e(DEALER_NAME)} — Vehicle Inventory</title>
    <link>${SITE_URL}/inventory.html</link>
    <description>Used trucks, SUVs, and cars for sale at ${e(DEALER_NAME)} in ${e(DEALER_CITY)}, ${e(DEALER_STATE)}. ${e(DEALER_ADDRESS)}.</description>
    <lastBuildDate>${now}</lastBuildDate>
${items.join('\n')}
  </channel>
</rss>`;
}

const googleXml = buildGoogleFeed(vehicles);
fs.writeFileSync(GOOGLE_FEED_PATH, googleXml, 'utf8');
console.log(`✓ Google Vehicle Listings feed: feeds/vehicles.xml (${vehicles.length} vehicles)`);

// ══════════════════════════════════════════════════════════════════
// 2. CARVID / Facebook Marketplace CSV Feed
//    Compatible with Facebook Catalog vehicle listings import
//    and CARVID bulk upload format.
// ══════════════════════════════════════════════════════════════════

function buildCarvidCsv(vehicles) {
  // Determine max image columns needed
  let maxImages = 0;
  vehicles.forEach(v => {
    const imgs = getVehicleImages(v);
    if (imgs.length > maxImages) maxImages = imgs.length;
  });
  maxImages = Math.min(maxImages, 10);

  const imageHeaders = Array.from({ length: maxImages }, (_, i) =>
    i === 0 ? 'image_url[0]' : `additional_image_link[${i}]`
  );

  const headers = [
    'id',
    'title',
    'description',
    'url',
    ...imageHeaders,
    'year',
    'make',
    'model',
    'trim',
    'price',
    'mileage',
    'vin',
    'condition',
    'availability',
    'body_style',
    'transmission',
    'drivetrain',
    'fuel_type',
    'exterior_color',
    'interior_color',
    'engine',
    'stock_number',
    'dealer_name',
    'dealer_city',
    'dealer_state',
    'dealer_zip',
    'dealer_phone',
    'date_added',
  ];

  const rows = [headers];

  vehicles.forEach(v => {
    const images = getVehicleImages(v);
    const imageCells = Array.from({ length: maxImages }, (_, i) => images[i] || '');
    const description = v.description || `${vehicleTitle(v)} available at ${DEALER_NAME}.`;

    rows.push([
      v.stockNumber || v.vin,                  // id
      vehicleTitle(v),                          // title
      description,                              // description
      buildVDPUrl(v),                           // url
      ...imageCells,                            // image columns
      v.year,                                   // year
      titleCase(v.make),                        // make
      titleCase(v.model),                       // model
      v.trim || '',                             // trim
      v.price,                                  // price
      v.mileage || '',                          // mileage
      v.vin,                                    // vin
      'used',                                   // condition
      'in stock',                               // availability
      normalizeBodyStyle(v),                    // body_style
      v.transmission || '',                     // transmission
      normalizeDrivetrain(v),                   // drivetrain
      v.fuelType || v.fuel_type || 'Gasoline',  // fuel_type
      v.exteriorColor || '',                    // exterior_color
      v.interiorColor || '',                    // interior_color
      v.engine || '',                           // engine
      v.stockNumber || '',                      // stock_number
      DEALER_NAME,                              // dealer_name
      DEALER_CITY,                              // dealer_city
      DEALER_STATE,                             // dealer_state
      DEALER_ZIP,                               // dealer_zip
      '(252) 496-0005',                         // dealer_phone
      v.dateAdded || '',                        // date_added
    ]);
  });

  return rows.map(csvRow).join('\n');
}

const carvidCsv = buildCarvidCsv(vehicles);
fs.writeFileSync(CARVID_FEED_PATH, carvidCsv, 'utf8');
console.log(`✓ CARVID/Facebook Marketplace CSV: feeds/vehicles.csv (${vehicles.length} vehicles)`);

console.log(`
── Feed Summary ──────────────────────────────────────────────
  Google Merchant Center feed : ${SITE_URL}/feeds/vehicles.xml
  CARVID / FB Marketplace CSV : ${SITE_URL}/feeds/vehicles.csv

── Next Steps ─────────────────────────────────────────────────
  Google Vehicle Listings:
    1. Create a Google Merchant Center account at merchants.google.com
    2. Link your Google Business Profile for Bells Fork Truck & Auto
    3. Add a new feed: Products > Feeds > + > Schedule fetch
    4. Feed URL: ${SITE_URL}/feeds/vehicles.xml
    5. Set fetch frequency to daily

  Facebook Marketplace via CARVID ($9-19/mo):
    1. Sign up at carvidapp.com
    2. Upload feeds/vehicles.csv as your inventory source
    3. Map CSV columns to CARVID fields (match headers exactly)
    4. CARVID will auto-post to Facebook Marketplace with your account

  To regenerate feeds after inventory changes:
    node generate-vehicle-feed.js
──────────────────────────────────────────────────────────────`);
