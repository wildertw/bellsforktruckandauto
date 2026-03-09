// build-utils.js — Shared constants and helpers for all build scripts
const fs = require('fs');
const path = require('path');

// ── Dealer constants ──
const SITE_URL = 'https://bellsforkautoandtruck.com';
const DEALER_NAME = 'Bells Fork Truck & Auto';
const DEALER_PHONE = '(252) 496-0005';
const DEALER_PHONE_TEL = '+12524960005';
const DEALER_SMS_TEL = '+12529170551';
const DEALER_ADDRESS = '3840 Charles Blvd, Greenville, NC 27858';
const DEALER_STREET = '3840 Charles Blvd';
const DEALER_CITY = 'Greenville';
const DEALER_STATE = 'NC';
const DEALER_ZIP = '27858';
const DEALER_LAT = '35.5641462';
const DEALER_LNG = '-77.349267';
const DEALER_EMAIL = 'bellsforkautoandtruck@gmail.com';
const DEALER_FB = 'https://www.facebook.com/profile.php?id=61585590120772';
const VEHICLE_ASSET_DIR = path.join(__dirname, 'assets', 'vehicles');

// ── Helpers ──

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/`/g, '&#96;');
}

function titleCase(s) {
  const str = String(s || '').trim();
  if (!str) return '';
  return str.toLowerCase().split(' ').filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function formatMoney(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return 'Call for Price';
  return `$${num.toLocaleString('en-US')}`;
}

function slugify(str) {
  return String(str || '').trim().replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function buildVDPSlug(v) {
  const parts = ['Used', v.year, v.make, v.model, v.trim, 'for-sale-in-Greenville-NC-27858']
    .filter(Boolean)
    .map(p => slugify(String(p)))
    .filter(Boolean);
  return parts.join('-');
}

function buildVDPId(v) {
  return (v.stockNumber || v.vin || v.id || 'NA').toString().replace(/[^a-z0-9]/gi, '');
}

function buildVDPPath(v) {
  return `/vdp/${buildVDPId(v)}/${buildVDPSlug(v)}/`;
}

function todayISO() {
  return new Date().toISOString().split('T')[0];
}

// ── Image resolution ──

function buildLocalImageCandidates(name) {
  const raw = String(name || '').trim();
  if (!raw || raw.startsWith('http') || raw.startsWith('blob:')) return [];

  const out = [];
  const seen = new Set();
  const add = (candidate) => {
    const clean = String(candidate || '').trim();
    if (!clean || seen.has(clean)) return;
    seen.add(clean);
    out.push(clean);
  };

  const extMatch = raw.match(/^(.+?)(?:\.([a-z0-9]+))?$/i);
  const base = extMatch ? extMatch[1] : raw;
  const originalExt = extMatch && extMatch[2] ? extMatch[2].toLowerCase() : '';

  const baseVariants = [];
  const baseSeen = new Set();
  const addBase = (b) => {
    const clean = String(b || '').trim();
    if (!clean || baseSeen.has(clean)) return;
    baseSeen.add(clean);
    baseVariants.push(clean);
  };
  addBase(base);

  const zeroPadMatch = base.match(/^(.*?)([-_])0([1-9]\d*)$/);
  if (zeroPadMatch) {
    const prefix = zeroPadMatch[1];
    const sep = zeroPadMatch[2];
    const num = zeroPadMatch[3];
    const altSep = sep === '-' ? '_' : '-';
    addBase(`${prefix}${sep}${num}`);
    addBase(`${prefix}${altSep}${num}`);
  }

  const plainNumMatch = base.match(/^(.*?)([-_])([1-9]\d*)$/);
  if (plainNumMatch) {
    const prefix = plainNumMatch[1];
    const sep = plainNumMatch[2];
    const num = plainNumMatch[3];
    const altSep = sep === '-' ? '_' : '-';
    const padded = num.padStart(2, '0');
    addBase(`${prefix}${sep}${padded}`);
    addBase(`${prefix}${altSep}${num}`);
    addBase(`${prefix}${altSep}${padded}`);
  }

  const extList = [];
  const extSeen = new Set();
  const addExt = (ext) => {
    const clean = String(ext || '').toLowerCase();
    if (!clean || extSeen.has(clean)) return;
    extSeen.add(clean);
    extList.push(clean);
  };
  addExt(originalExt);
  ['png', 'jpg', 'jpeg', 'webp'].forEach(addExt);

  baseVariants.forEach((b) => {
    extList.forEach((ext) => add(`${b}.${ext}`));
  });

  return out;
}

function resolveInventoryImageName(name) {
  const raw = String(name || '').trim();
  if (!raw || raw.startsWith('http') || raw.startsWith('blob:')) return raw;
  const candidates = buildLocalImageCandidates(raw);
  for (const c of candidates) {
    if (fs.existsSync(path.join(VEHICLE_ASSET_DIR, c))) return c;
  }
  return raw;
}

function resolveImg(img, prefix) {
  if (!img) return '';
  if (img.startsWith('http')) return img;
  if (img.startsWith('blob:')) return `${prefix || ''}photos/${img.slice(5)}`;
  return `${prefix || ''}assets/vehicles/${img}`;
}

function resolveImgAbs(img) {
  if (!img) return `${SITE_URL}/assets/hero/shop-front-og.jpg`;
  if (img.startsWith('http')) return img;
  if (img.startsWith('blob:')) return `${SITE_URL}/photos/${img.slice(5)}`;
  return `${SITE_URL}/assets/vehicles/${img}`;
}

// ── Vehicle type inference ──
// Many vehicles have type "used" instead of a proper category.
// This maps known models to truck/suv/car/diesel based on model name.

function inferVehicleType(v) {
  const raw = String(v.type || '').toLowerCase().trim();
  if (raw && !['used', 'other', ''].includes(raw)) return raw;

  const model = String(v.model || '').toLowerCase();
  const fuel = String(v.fuelType || '').toLowerCase();

  // Diesel check first
  if (fuel.includes('diesel') || raw === 'diesel') return 'diesel';

  // Truck models
  if (/f[-\s]?150|f[-\s]?250|f[-\s]?350|f[-\s]?450|silverado|sierra|ram|tundra|tacoma|colorado|frontier|ranger|titan|gladiator|ridgeline|canyon/i.test(model)) return 'truck';
  if (/\b2500\b|\b3500\b|\b1500\b/.test(model)) return 'truck';

  // SUV models
  if (/tahoe|suburban|expedition|explorer|cherokee|wrangler|4runner|highlander|rav4|escape|equinox|terrain|pathfinder|pilot|bronco|yukon|durango|traverse|blazer|trailblazer|santa\s?fe|tucson|sorento|telluride|qx80|qx60|sequoia|armada/i.test(model)) return 'suv';

  // Car models
  if (/camaro|corvette|mustang|challenger|charger|camry|corolla|accord|civic|altima|maxima|wrx|impreza|legacy|jetta|passat|sonata|elantra|malibu|impala|fusion|focus|xjl|portfolio/i.test(model)) return 'car';

  // Fallback: if make is a truck-heavy brand and we can't determine, default to truck
  return 'car';
}

// ── Load inventory helper ──

function loadAvailableVehicles() {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'inventory.json'), 'utf8'));
  return (data.vehicles || [])
    .filter(v => v.status === 'available' || !v.status)
    .map(v => {
      // Resolve image names and infer type
      if (v.images && v.images.length) {
        v.images = v.images.map(img => resolveInventoryImageName(img));
      }
      v._inferredType = inferVehicleType(v);
      return v;
    });
}

module.exports = {
  SITE_URL, DEALER_NAME, DEALER_PHONE, DEALER_PHONE_TEL, DEALER_SMS_TEL,
  DEALER_ADDRESS, DEALER_STREET, DEALER_CITY, DEALER_STATE, DEALER_ZIP,
  DEALER_LAT, DEALER_LNG, DEALER_EMAIL, DEALER_FB, VEHICLE_ASSET_DIR,
  escapeHtml, escapeAttr, titleCase, formatMoney, slugify,
  buildVDPSlug, buildVDPId, buildVDPPath, todayISO,
  buildLocalImageCandidates, resolveInventoryImageName, resolveImg, resolveImgAbs,
  inferVehicleType, loadAvailableVehicles,
};
