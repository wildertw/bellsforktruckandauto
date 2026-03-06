#!/usr/bin/env node
// generate-vdp.js — Static VDP (Vehicle Detail Page) generator
// Reads inventory.json and generates SEO-optimized HTML pages for each vehicle.
// Output: vdp/{stockNumber}/{slug}/index.html
// Usage: node generate-vdp.js

const fs = require('fs');
const path = require('path');

const SITE_URL = 'https://bellsforkautoandtruck.com';
const DEALER_NAME = 'Bells Fork Auto & Truck';
const DEALER_PHONE = '(252) 496-0005';
const DEALER_PHONE_TEL = '+12524960005';
const DEALER_ADDRESS = '3840 Charles Blvd, Greenville, NC 27858';
const DEALER_STREET = '3840 Charles Blvd';
const DEALER_CITY = 'Greenville';
const DEALER_STATE = 'NC';
const DEALER_ZIP = '27858';
const DEALER_LAT = '35.6123';
const DEALER_LNG = '-77.3712';
const DEALER_EMAIL = 'bellsforkautoandtruck@gmail.com';
const DEALER_FB = 'https://www.facebook.com/profile.php?id=61585590120772';
const VEHICLE_ASSET_DIR = path.join(__dirname, 'assets', 'vehicles');

// ── Helpers ──

// Resolve an image value — full cloud URL or local assets/vehicles/ path
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

function resolveImg(img, prefix = '') {
  if (!img) return '';
  if (img.startsWith('http')) return img;
  if (img.startsWith('blob:')) return `${prefix}photos/${img.slice(5)}`;
  return `${prefix}assets/vehicles/${img}`;
}
function resolveImgAbs(img) {
  if (!img) return `${SITE_URL}/assets/hero/shop-front-og.jpg`;
  if (img.startsWith('http')) return img;
  if (img.startsWith('blob:')) return `${SITE_URL}/photos/${img.slice(5)}`;
  return `${SITE_URL}/assets/vehicles/${img}`;
}

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
  return `$${num.toLocaleString()}`;
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

// ── Vehicle description generator (Enhanced) ──
function generateDescription(v) {
  const parts = [];

  // Type-specific opening hook for more engaging copy
  const typeHookMap = {
    'truck':    'a capable, hard-working truck',
    'pickup':   'a capable, hard-working pickup truck',
    'suv':      'a spacious and versatile SUV',
    'car':      'a refined and reliable car',
    'sedan':    'a refined and reliable sedan',
    'sports car': 'a thrilling performance machine',
    'coupe':    'a stylish performance coupe',
    'van':      'a practical and spacious van',
    'minivan':  'a comfortable, family-ready minivan',
  };
  const typeHook = typeHookMap[(v.type || '').toLowerCase()] || 'a dependable pre-owned vehicle';

  parts.push(`The ${v.year} ${titleCase(v.make)} ${titleCase(v.model)}${v.trim ? ' ' + v.trim : ''} is ${typeHook} now available at ${DEALER_NAME} in ${DEALER_CITY}, ${DEALER_STATE}.`);

  // Mileage with contextual framing
  if (v.mileage) {
    const miles = Number(v.mileage);
    let ctx = '';
    if (miles < 30000)       ctx = 'keeping plenty of road life ahead';
    else if (miles < 75000)  ctx = 'representing excellent pre-owned value';
    else if (miles < 125000) ctx = 'priced right for the budget-conscious buyer';
    else                     ctx = 'offered at an outstanding value price';
    parts.push(`With ${miles.toLocaleString()} miles on the odometer — ${ctx}.`);
  }

  // Powertrain details
  const powerParts = [];
  if (v.engine) {
    powerParts.push(v.cylinders
      ? `${v.engine} ${v.cylinders}-cylinder engine`
      : `${v.engine} engine`);
  }
  if (v.transmission) powerParts.push(`${v.transmission} transmission`);
  if (v.drivetrain) {
    const driveLabels = {
      RWD: 'rear-wheel drive', '4WD': '4-wheel drive',
      AWD: 'all-wheel drive',  FWD: 'front-wheel drive', '2WD': '2-wheel drive'
    };
    powerParts.push(driveLabels[v.drivetrain] || v.drivetrain);
  }
  if (powerParts.length) {
    parts.push(`It's equipped with a ${powerParts.join(', paired with a ')}.`);
  }

  // Appearance — exterior + interior with optional interior type
  if (v.exteriorColor && v.interiorColor) {
    const intDetail = v.interiorType
      ? `${v.interiorColor} ${v.interiorType}`
      : `${v.interiorColor} interior`;
    parts.push(`Finished in ${v.exteriorColor} on the outside with a comfortable ${intDetail}.`);
  } else if (v.exteriorColor) {
    parts.push(`Finished in ${v.exteriorColor}.`);
  }

  // Fuel economy
  if (v.mpgCity && v.mpgHighway) {
    parts.push(`EPA-estimated fuel economy of ${v.mpgCity} MPG city and ${v.mpgHighway} MPG highway helps keep running costs in check.`);
  }

  // Warranty (if present)
  if (v.warranty) {
    parts.push(`${v.warranty}.`);
  }

  // Title status (skip generic/N/A values)
  if (v.titleStatus && !['n/a', 'na', '—'].includes(String(v.titleStatus).toLowerCase())) {
    parts.push(`${v.titleStatus} title.`);
  }

  // Closing CTA
  parts.push(`Call ${DEALER_PHONE} or visit us at ${DEALER_STREET}, ${DEALER_CITY}, ${DEALER_STATE} ${DEALER_ZIP} to schedule your test drive today.`);

  return parts.join(' ');
}

function vehicleTitle(v) {
  return `${v.year} ${titleCase(v.make)} ${titleCase(v.model)}${v.trim ? ' ' + v.trim : ''}`.trim();
}

function metaTitle(v) {
  return `${vehicleTitle(v)} for Sale | ${DEALER_NAME} | ${DEALER_CITY}, ${DEALER_STATE}`;
}

function metaDescription(v) {
  const title = vehicleTitle(v);
  const price = v.price ? formatMoney(v.price) : 'Call for price';
  const miles = v.mileage ? `${Number(v.mileage).toLocaleString()} mi` : '';
  return `${title} for sale at ${DEALER_NAME} in ${DEALER_CITY}, ${DEALER_STATE}. ${price}${miles ? ` · ${miles}` : ''}. ${v.drivetrain || ''} ${v.transmission || ''}. Inspected, priced fairly, and ready to drive. Call ${DEALER_PHONE}.`.replace(/\s+/g, ' ').trim();
}

// ── Schema.org structured data ──
function buildSchema(v) {
  const title = vehicleTitle(v);
  const vdpUrl = `${SITE_URL}${buildVDPPath(v)}`;
  const mainImage = v.images && v.images.length > 0
    ? resolveImgAbs(v.images[0])
    : `${SITE_URL}/assets/logo.png`;

  const schema = {
    '@context': 'https://schema.org',
    '@graph': [
      // Vehicle/Car product
      {
        '@type': 'Car',
        '@id': `${vdpUrl}#vehicle`,
        name: title,
        description: generateDescription(v),
        url: vdpUrl,
        image: (v.images || []).map(img => resolveImgAbs(img)),
        brand: { '@type': 'Brand', name: titleCase(v.make) },
        manufacturer: { '@type': 'Organization', name: titleCase(v.make) },
        model: titleCase(v.model),
        vehicleModelDate: String(v.year),
        modelDate: String(v.year),
        ...(v.vin ? { vehicleIdentificationNumber: v.vin } : {}),
        ...(v.mileage ? {
          mileageFromOdometer: {
            '@type': 'QuantitativeValue',
            value: v.mileage,
            unitCode: 'SMI'
          }
        } : {}),
        ...(v.drivetrain ? { driveWheelConfiguration: v.drivetrain } : {}),
        ...(v.transmission ? { vehicleTransmission: v.transmission } : {}),
        ...(v.engine ? { vehicleEngine: { '@type': 'EngineSpecification', name: v.engine } } : {}),
        ...(v.fuelType ? { fuelType: v.fuelType } : {}),
        ...(v.exteriorColor ? { color: v.exteriorColor } : {}),
        ...(v.interiorColor ? { vehicleInteriorColor: v.interiorColor } : {}),
        ...(v.mpgCity && v.mpgHighway ? {
          fuelEfficiency: `${v.mpgCity} city / ${v.mpgHighway} highway MPG`
        } : {}),
        vehicleConfiguration: v.trim || undefined,
        itemCondition: 'https://schema.org/UsedCondition',
        offers: {
          '@type': 'Offer',
          ...(v.price ? { price: v.price, priceCurrency: 'USD' } : {}),
          availability: 'https://schema.org/InStock',
          itemCondition: 'https://schema.org/UsedCondition',
          seller: { '@id': `${SITE_URL}/#business` },
          url: vdpUrl
        }
      },
      // Breadcrumb
      {
        '@type': 'BreadcrumbList',
        '@id': `${vdpUrl}#breadcrumb`,
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE_URL}/` },
          { '@type': 'ListItem', position: 2, name: 'Inventory', item: `${SITE_URL}/inventory.html` },
          { '@type': 'ListItem', position: 3, name: title, item: vdpUrl }
        ]
      },
      // Dealer (reference)
      {
        '@type': ['AutoDealer', 'LocalBusiness'],
        '@id': `${SITE_URL}/#business`,
        name: DEALER_NAME,
        url: `${SITE_URL}/`,
        telephone: `+1-252-496-0005`,
        address: {
          '@type': 'PostalAddress',
          streetAddress: DEALER_STREET,
          addressLocality: DEALER_CITY,
          addressRegion: DEALER_STATE,
          postalCode: DEALER_ZIP,
          addressCountry: 'US'
        },
        geo: {
          '@type': 'GeoCoordinates',
          latitude: DEALER_LAT,
          longitude: DEALER_LNG
        }
      }
    ]
  };

  return JSON.stringify(schema, null, 2);
}

// ── Image path depth calculation ──
// VDP pages live at /vdp/{id}/{slug}/index.html — 3 levels deep from root
const ASSET_PREFIX = '../../../';

// ── HTML Template ──
function generateVDPHtml(v, allVehicles) {
  const title = vehicleTitle(v);
  const vdpUrl = `${SITE_URL}${buildVDPPath(v)}`;
  const price = v.price ? formatMoney(v.price) : 'Call for Price';
  const miles = v.mileage ? `${Number(v.mileage).toLocaleString()} mi` : '';
  const stock = v.stockNumber ? `Stock #${v.stockNumber}` : '';
  const vin = v.vin || '';
  const vinB64 = vin ? Buffer.from(vin).toString('base64') : '';
  const mainImage = v.images && v.images.length > 0
    ? resolveImg(v.images[0], ASSET_PREFIX)
    : '';
  const mainImageAbs = v.images && v.images.length > 0
    ? resolveImgAbs(v.images[0])
    : `${SITE_URL}/assets/hero/shop-front-og.jpg`;

  const applyHref = `${ASSET_PREFIX}financing.html?tab=financing&vehicle=${encodeURIComponent(title)}&vin=${encodeURIComponent(vin)}&price=${encodeURIComponent(String(v.price ?? ''))}#applications`;
  const inquireHref = `${ASSET_PREFIX}contact.html?vehicle=${encodeURIComponent(title)}&vin=${encodeURIComponent(vin)}#appointment`;

  // Similar vehicles (same make or same type, exclude current)
  const similar = allVehicles
    .filter(sv => sv !== v && sv.status !== 'sold' && (
      (sv.make && sv.make.toLowerCase() === (v.make || '').toLowerCase()) ||
      (sv.type && sv.type.toLowerCase() === (v.type || '').toLowerCase())
    ))
    .slice(0, 6);

  // ── Drivetrain label helper ──
  const driveLabel = (() => {
    if (!v.drivetrain) return '—';
    const map = { RWD: 'RWD – Rear Wheel Drive', '4WD': '4WD – 4-Wheel Drive', AWD: 'AWD – All-Wheel Drive', FWD: 'FWD – Front Wheel Drive', '2WD': '2WD – 2-Wheel Drive' };
    return map[v.drivetrain] || v.drivetrain;
  })();

  // ── Section 2: Technical Specifications ──
  const techSpecs = [
    { label: 'Engine',        value: v.engine        || '—' },
    { label: 'Cylinders',     value: v.cylinders     ? String(v.cylinders) : '—' },
    { label: 'Transmission',  value: v.transmission  || '—' },
    { label: 'Drivetrain',    value: driveLabel },
    { label: 'Fuel Type',     value: v.fuelType      || '—' },
    ...(v.transmissionDetail ? [{ label: 'Trans. Detail', value: v.transmissionDetail }] : []),
    ...(v.doors              ? [{ label: 'Doors',         value: String(v.doors) }] : []),
    ...(v.bodyStyle          ? [{ label: 'Body Style',    value: v.bodyStyle }] : []),
  ];

  // ── Section 3: Appearance ──
  const appearSpecs = [
    { label: 'Exterior Color', value: v.exteriorColor  || '—' },
    { label: 'Interior Color', value: v.interiorColor  || '—' },
    { label: 'Interior Type',  value: v.interiorType   || '—' },
  ];

  // ── Section 4: Performance & Efficiency ──
  const perfSpecs = [
    { label: 'Mileage',       value: miles             || '—' },
    { label: 'Vehicle Type',  value: titleCase(v.type) || '—' },
    { label: 'City MPG',      value: v.mpgCity         ? String(v.mpgCity)    : '—' },
    { label: 'Highway MPG',   value: v.mpgHighway      ? String(v.mpgHighway) : '—' },
  ];

  // ── Section 5: Administrative Details ──
  const adminSpecs = [
    { label: 'VIN',          value: vin               || '—' },
    { label: 'Stock #',      value: v.stockNumber     || '—' },
    { label: 'Condition',    value: v.condition       || '—' },
    { label: 'Title Status', value: v.titleStatus     || '—' },
    { label: 'Warranty',     value: v.warranty        || '—' },
  ];

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">

  <!-- Primary SEO -->
  <title>${escapeHtml(metaTitle(v))}</title>
  <meta name="description" content="${escapeAttr(metaDescription(v))}">
  <meta name="keywords" content="used ${escapeAttr((v.make||'').toLowerCase())} ${escapeAttr((v.model||'').toLowerCase())} ${DEALER_CITY} ${DEALER_STATE}, ${escapeAttr(title.toLowerCase())} for sale, used ${escapeAttr((v.type||'vehicles').toLowerCase())} ${DEALER_CITY} ${DEALER_STATE}, ${DEALER_NAME.toLowerCase()}, used cars ${DEALER_ZIP}">
  <link rel="canonical" href="${escapeAttr(vdpUrl)}">

  <!-- Sitemap -->
  <link rel="sitemap" type="application/xml" href="/sitemap.xml">

  <!-- GEO Meta Tags -->
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1">
  <meta name="googlebot" content="index, follow, max-snippet:-1, max-image-preview:large">
  <meta name="bingbot" content="index, follow">
  <meta name="subject" content="${escapeAttr(title)} for Sale in ${DEALER_CITY}, ${DEALER_STATE}">
  <meta name="topic" content="Used ${escapeAttr(titleCase(v.make))} ${escapeAttr(titleCase(v.model))} for Sale">
  <meta name="classification" content="Automotive, Used Car Dealer, Vehicle Detail">
  <meta name="category" content="Automotive">
  <meta name="coverage" content="Eastern North Carolina">
  <meta name="distribution" content="global">
  <meta name="rating" content="general">
  <meta name="geo.region" content="US-NC">
  <meta name="geo.placename" content="${DEALER_CITY}, North Carolina">
  <meta name="geo.position" content="${DEALER_LAT};${DEALER_LNG}">
  <meta name="ICBM" content="${DEALER_LAT}, ${DEALER_LNG}">
  <meta name="author" content="${DEALER_NAME}">
  <meta name="contact" content="${DEALER_PHONE}">

  <!-- Open Graph -->
  <meta property="og:type" content="product">
  <meta property="og:title" content="${escapeAttr(title)} for Sale | ${DEALER_NAME}">
  <meta property="og:description" content="${escapeAttr(metaDescription(v))}">
  <meta property="og:url" content="${escapeAttr(vdpUrl)}">
  <meta property="og:image" content="${escapeAttr(mainImageAbs)}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="${escapeAttr(title)} for sale at ${DEALER_NAME}">
  <meta property="og:locale" content="en_US">
  <meta property="og:site_name" content="${DEALER_NAME}">
  <meta property="product:price:amount" content="${v.price || ''}">
  <meta property="product:price:currency" content="USD">
  <meta property="product:condition" content="used">

  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeAttr(title)} | ${DEALER_NAME}">
  <meta name="twitter:description" content="${escapeAttr(metaDescription(v))}">
  <meta name="twitter:image" content="${escapeAttr(mainImageAbs)}">

  <!-- Favicon -->
  <link rel="icon" type="image/png" href="${ASSET_PREFIX}assets/favicon.png">

  <!-- Preconnect -->
  <link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>

  <!-- Bootstrap 5 CSS -->
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet"
        integrity="sha384-QWTKZyjpPEjISv5WaRU9OFeRpok6YctnYmDr5pNlyT2bRjXh0JMhjY6hW+ALEwIH" crossorigin="anonymous">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swiper@11/swiper-bundle.min.css">

  <!-- Custom Styles -->
  <link href="${ASSET_PREFIX}style.min.css" rel="stylesheet">

  <!-- Schema.org Structured Data -->
  <script type="application/ld+json">
${buildSchema(v)}
  </script>

  <style>
    /* Nav hover: red background on hover */
    .bfat-navlink {
      font-size: .88rem;
      letter-spacing: .07em;
      color: #ffffff !important;
      transition: background .18s, color .18s;
    }
    .bfat-navlink:hover,
    .bfat-navlink:focus,
    .bfat-navlink.active {
      background: #dc3545 !important;
      color: #ffffff !important;
    }
    .footer-link:hover { color: #fff !important; }
    .site-identity-bar { position: relative; }
    @media (max-width: 576px) {
      .site-identity-bar .ms-auto { margin-left: 0 !important; }
      .site-identity-bar a[style*="position:absolute"] {
        position: static !important;
        transform: none !important;
        display: block;
        text-align: center;
        margin: .5rem auto;
      }
    }

    /* ═══ VDP Styles ═══ */
    .vdp-main { background: #f1f1f1; padding-bottom: 3rem; }

    /* ── Spec Section Cards ── */
    .vdp-section {
      background: #fff;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 1px 5px rgba(0,0,0,.06);
    }
    .vdp-section-header {
      display: flex;
      align-items: center;
      gap: .55rem;
      padding: .8rem 1.25rem;
      font-weight: 700;
      font-size: .9rem;
      color: #fff;
      letter-spacing: .06em;
      text-transform: uppercase;
    }
    /* Each section has its own accent color */
    .vdp-section-header.tech   { background: #dc3545; }
    .vdp-section-header.appear { background: #6f42c1; }
    .vdp-section-header.perf   { background: #e87722; }
    .vdp-section-header.admin  { background: #0d6efd; }
    .vdp-section-header.desc   { background: #198754; }

    /* 2-column spec grid within each card */
    .vdp-spec-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
    }
    .vdp-spec-item {
      padding: .65rem 1.25rem;
      border-bottom: 1px solid #f2f2f2;
      border-right: 1px solid #f2f2f2;
    }
    .vdp-spec-item:nth-child(2n) { border-right: none; }
    /* Last row — remove bottom border for clean finish */
    .vdp-spec-item:last-child,
    .vdp-spec-item:nth-last-child(2):nth-child(odd) { border-bottom: none; }
    .vdp-spec-label {
      font-size: .7rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: .07em;
      color: #999;
      margin-bottom: .2rem;
    }
    .vdp-spec-value {
      font-size: .93rem;
      font-weight: 600;
      color: #1a1a1a;
      line-height: 1.35;
    }
    .vdp-spec-value.missing { color: #ccc; font-weight: 400; font-style: italic; }

    /* MPG display strip */
    .vdp-mpg-strip {
      display: flex;
      align-items: stretch;
      background: #fff;
      border-top: 1px solid #f2f2f2;
    }
    .vdp-mpg-box {
      flex: 1;
      text-align: center;
      padding: 1.1rem .5rem .9rem;
      border-right: 1px solid #f2f2f2;
    }
    .vdp-mpg-box:last-child { border-right: none; }
    .vdp-mpg-num  { font-size: 2.2rem; font-weight: 800; color: #111; line-height: 1; }
    .vdp-mpg-unit { font-size: .7rem; text-transform: uppercase; letter-spacing: .07em; color: #999; margin-top: .3rem; }
    .vdp-mpg-note { font-size: .7rem; color: #bbb; text-align: center; padding: .45rem 1.25rem .55rem; background: #fff; border-top: 1px solid #f2f2f2; }

    /* VIN reveal in admin section */
    .vin-field { font-family: monospace; font-size: .85rem; letter-spacing: .05em; }

    /* Breadcrumb */
    .vdp-breadcrumb {
      background: #e9e9e9;
      padding: .6rem 0;
      font-size: .82rem;
    }
    .vdp-breadcrumb a { color: #555; text-decoration: none; }
    .vdp-breadcrumb a:hover { color: #dc3545; text-decoration: underline; }
    .vdp-breadcrumb .sep { color: #999; margin: 0 .4rem; }

    /* Photo gallery */
    .vdp-gallery { position: relative; background: #000; }
    .vdp-main-img {
      width: 100%;
      max-height: 520px;
      object-fit: contain;
      display: block;
      margin: 0 auto;
      background: #111;
      cursor: pointer;
    }
    .vdp-thumbs {
      display: flex;
      gap: 4px;
      overflow-x: auto;
      padding: 6px 0;
      background: #111;
    }
    .vdp-thumb {
      width: 90px;
      height: 64px;
      object-fit: cover;
      cursor: pointer;
      border: 2px solid transparent;
      opacity: .65;
      transition: opacity .15s, border-color .15s;
      flex-shrink: 0;
    }
    .vdp-thumb:hover,
    .vdp-thumb.active { opacity: 1; border-color: #dc3545; }
    .vdp-photo-count {
      position: absolute;
      top: 12px;
      right: 12px;
      background: rgba(0,0,0,.7);
      color: #fff;
      padding: .3rem .7rem;
      border-radius: 4px;
      font-size: .82rem;
      font-weight: 600;
    }

    /* Title row */
    .vdp-title-row {
      background: #fff;
      border-bottom: 3px solid #dc3545;
      padding: 1.25rem 0;
    }
    .vdp-vehicle-title {
      font-size: 1.6rem;
      font-weight: 700;
      color: #111;
      margin: 0;
    }
    .vdp-trim { font-weight: 400; color: #666; font-size: 1.2rem; }
    .vdp-stock-vin { font-size: .82rem; color: #888; margin-top: .25rem; }
    .vin-reveal-btn { background:none; border:1px dashed #ccc; border-radius:4px; color:#888; cursor:pointer; font-size:.75rem; padding:1px 7px; vertical-align:middle; }
    .vin-reveal-btn:hover { background:#f5f5f5; border-color:#aaa; color:#333; }
    .vdp-price-tag {
      font-size: 2rem;
      font-weight: 800;
      color: #28a745;
    }
    .vdp-price-label {
      font-size: .75rem;
      text-transform: uppercase;
      color: #888;
      letter-spacing: .05em;
    }

    /* Specs table */
    .vdp-specs { background: #fff; border-radius: 6px; overflow: hidden; }
    .vdp-specs-title {
      background: #dc3545;
      color: #fff;
      padding: .75rem 1.25rem;
      font-weight: 700;
      font-size: 1rem;
      margin: 0;
    }
    .vdp-specs-table {
      width: 100%;
      border-collapse: collapse;
    }
    .vdp-specs-table td {
      padding: .6rem 1.25rem;
      border-bottom: 1px solid #eee;
      font-size: .92rem;
    }
    .vdp-specs-table tr:last-child td { border-bottom: none; }
    .vdp-specs-table td:first-child {
      font-weight: 700;
      color: #333;
      width: 42%;
      background: #fafafa;
    }
    .vdp-specs-table td:last-child { color: #555; }

    /* Features */
    .vdp-features { background: #fff; border-radius: 6px; overflow: hidden; }
    .vdp-features-title {
      background: #444;
      color: #fff;
      padding: .75rem 1.25rem;
      font-weight: 700;
      font-size: 1rem;
      margin: 0;
    }
    .vdp-features-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: .1rem;
      padding: 1rem 1.25rem;
    }
    .vdp-feature-item {
      font-size: .88rem;
      color: #444;
      padding: .35rem 0;
      padding-left: 1.4rem;
      position: relative;
    }
    .vdp-feature-item::before {
      content: '\\2713';
      position: absolute;
      left: 0;
      color: #28a745;
      font-weight: 700;
    }

    /* CTA sidebar */
    .vdp-cta-card {
      background: #fff;
      border-radius: 6px;
      overflow: hidden;
      box-shadow: 0 2px 8px rgba(0,0,0,.08);
    }
    .vdp-cta-card .vdp-cta-header {
      background: #1a1d23;
      color: #fff;
      padding: 1rem 1.25rem;
      font-weight: 700;
      font-size: 1rem;
    }
    .vdp-cta-card .vdp-cta-body { padding: 1rem 1.25rem; }
    .vdp-cta-btn {
      display: block;
      width: 100%;
      padding: .75rem 1rem;
      text-align: center;
      font-weight: 700;
      text-decoration: none;
      border-radius: 4px;
      margin-bottom: .6rem;
      font-size: .92rem;
      transition: background .15s, color .15s;
    }
    .vdp-cta-btn.primary { background: #dc3545; color: #fff; }
    .vdp-cta-btn.primary:hover { background: #bb2d3b; }
    .vdp-cta-btn.secondary { background: #28a745; color: #fff; }
    .vdp-cta-btn.secondary:hover { background: #218838; }
    .vdp-cta-btn.outline { background: #fff; color: #dc3545; border: 2px solid #dc3545; }
    .vdp-cta-btn.outline:hover { background: #dc3545; color: #fff; }
    .vdp-cta-btn.dark { background: #333; color: #fff; }
    .vdp-cta-btn.dark:hover { background: #111; }

    /* Description */
    .vdp-desc {
      background: #fff;
      border-radius: 6px;
      padding: 1.25rem;
      margin-top: 1.5rem;
    }
    .vdp-desc h2 { font-size: 1.15rem; font-weight: 700; margin-bottom: .75rem; }
    .vdp-desc p { font-size: .92rem; color: #444; line-height: 1.7; }

    /* Similar vehicles */
    .vdp-similar { margin-top: 2rem; }
    .vdp-similar h2 { font-size: 1.3rem; font-weight: 700; margin-bottom: 1rem; }
    .vdp-similar-card {
      background: #fff;
      border: 1px solid #ddd;
      border-radius: 6px;
      overflow: hidden;
      text-decoration: none;
      color: #111;
      display: block;
      transition: box-shadow .15s, transform .15s;
    }
    .vdp-similar-card:hover {
      box-shadow: 0 4px 16px rgba(0,0,0,.12);
      transform: translateY(-3px);
      color: #111;
    }
    .vdp-similar-card img {
      width: 100%;
      height: 160px;
      object-fit: cover;
      display: block;
    }
    .vdp-similar-body { padding: .75rem; }
    .vdp-similar-title { font-size: .9rem; font-weight: 700; margin: 0 0 .25rem; }
    .vdp-similar-price { color: #28a745; font-weight: 800; font-size: .95rem; }
    .vdp-similar-miles { font-size: .78rem; color: #888; }

    /* Responsive */
    @media (max-width: 991px) {
      .vdp-price-tag { font-size: 1.6rem; }
      .vdp-vehicle-title { font-size: 1.3rem; }
      .vdp-features-grid { grid-template-columns: 1fr 1fr !important; }
    }
    @media (max-width: 767px) {
      .vdp-main-img { max-height: 300px; }
      .vdp-features-grid { grid-template-columns: 1fr !important; }
      .vdp-title-row .container { text-align: center; }
      .vdp-price-tag { margin-top: .5rem; }
    }
  </style>
</head>
<body>

  <!-- TOP IDENTITY BAR -->
  <div class="site-identity-bar bg-white border-bottom py-3" style="position:relative;">
    <div class="container">
      <div class="d-flex align-items-center justify-content-between gap-3">
        <div class="d-flex flex-column align-items-start gap-1" style="min-width:120px;">
          <span class="fw-bold text-muted" style="font-size:.7rem;letter-spacing:.1em;text-transform:uppercase;">Connect</span>
          <div class="d-flex gap-2 align-items-center">
            <a href="${DEALER_FB}" target="_blank" aria-label="Facebook"
               style="display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:5px;background:#1877f2;color:#fff;text-decoration:none;">
              <svg width="17" height="17" fill="currentColor" viewBox="0 0 16 16"><path d="M16 8.049c0-4.446-3.582-8.05-8-8.05C3.58 0-.002 3.603-.002 8.05c0 4.017 2.926 7.347 6.75 7.951v-5.625h-2.03V8.05H6.75V6.275c0-2.017 1.195-3.131 3.022-3.131.876 0 1.791.157 1.791.157v1.98h-1.009c-.993 0-1.303.621-1.303 1.258v1.51h2.218l-.354 2.326H9.25V16c3.824-.604 6.75-3.934 6.75-7.951z"/></svg>
            </a>
            <a href="${DEALER_FB}" target="_blank" aria-label="Instagram"
               style="display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:5px;background:radial-gradient(circle at 30% 107%,#fdf497 0%,#fd5949 45%,#d6249f 60%,#285AEB 90%);color:#fff;text-decoration:none;">
              <svg width="17" height="17" fill="currentColor" viewBox="0 0 16 16"><path d="M8 0C5.829 0 5.556.01 4.703.048 3.85.088 3.269.222 2.76.42a3.9 3.9 0 0 0-1.417.923A3.9 3.9 0 0 0 .42 2.76C.222 3.268.087 3.85.048 4.7.01 5.555 0 5.827 0 8.001c0 2.172.01 2.444.048 3.297.04.852.174 1.433.372 1.942.205.526.478.972.923 1.417.444.445.89.719 1.416.923.51.198 1.09.333 1.942.372C5.555 15.99 5.827 16 8 16s2.444-.01 3.298-.048c.851-.04 1.434-.174 1.943-.372a3.9 3.9 0 0 0 1.416-.923c.445-.445.718-.891.923-1.417.197-.509.332-1.09.372-1.942C15.99 10.445 16 10.173 16 8s-.01-2.445-.048-3.299c-.04-.851-.175-1.433-.372-1.941a3.9 3.9 0 0 0-.923-1.417A3.9 3.9 0 0 0 13.24.42c-.51-.198-1.092-.333-1.943-.372C10.443.01 10.172 0 7.998 0h.003zm-.717 1.442h.718c2.136 0 2.389.007 3.232.046.78.035 1.204.166 1.486.275.373.145.64.319.92.599.28.28.453.546.598.92.11.281.24.705.275 1.485.039.843.047 1.096.047 3.231s-.008 2.389-.047 3.232c-.035.78-.166 1.203-.275 1.485a2.47 2.47 0 0 1-.599.919c-.28.28-.546.453-.92.598-.28.11-.704.24-1.485.276-.843.038-1.096.047-3.232.047s-2.39-.009-3.232-.047c-.78-.036-1.203-.166-1.485-.276a2.478 2.478 0 0 1-.92-.598 2.48 2.48 0 0 1-.6-.92c-.109-.281-.24-.705-.275-1.485-.038-.843-.046-1.096-.046-3.233 0-2.136.008-2.388.046-3.231.036-.78.166-1.204.276-1.486.145-.373.319-.64.599-.92.28-.28.546-.453.92-.598.282-.11.705-.24 1.485-.276.738-.034 1.024-.044 2.515-.045v.002zm4.988 1.328a.96.96 0 1 0 0 1.92.96.96 0 0 0 0-1.92zm-4.27 1.122a4.109 4.109 0 1 0 0 8.217 4.109 4.109 0 0 0 0-8.217zm0 1.441a2.667 2.667 0 1 1 0 5.334 2.667 2.667 0 0 1 0-5.334z"/></svg>
            </a>
            <a href="https://www.google.com/maps/place/Bells+Fork+Truck+and+Auto/@35.5641622,-77.367721,15z/data=!3m1!4b1!4m6!3m5!1s0x89aeddacc00176bf:0x2e8db9e8d1d56161!8m2!3d35.5641462!4d-77.349267!16s%2Fg%2F11yxj2p8q_?hl=en&entry=ttu&g_ep=EgoyMDI2MDIyNS4wIKXMDSoASAFQAw%3D%3D" target="_blank" rel="noreferrer" aria-label="Google Business"
               style="display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:5px;text-decoration:none;overflow:hidden;box-shadow:0 0 0 1px rgba(0,0,0,0.1);">
              <img src="${ASSET_PREFIX}assets/google-icon-color.png" alt="Google Business" width="34" height="34" style="display:block;">
            </a>
          </div>
        </div>
        <a href="${ASSET_PREFIX}index.html#top" class="text-decoration-none"
           style="position:absolute;left:50%;transform:translateX(-50%);">
          <img src="${ASSET_PREFIX}assets/logo.png" height="68" alt="${DEALER_NAME} Logo">
        </a>
        <div class="text-end ms-auto" style="min-width:160px;">
          <a href="tel:${DEALER_PHONE_TEL}" class="text-decoration-none fw-bold d-flex align-items-center justify-content-end gap-2" style="font-size:1.2rem;color:#111;">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor" viewBox="0 0 16 16">
              <path fill-rule="evenodd" d="M1.885.511a1.745 1.745 0 0 1 2.61.163L6.29 2.98c.329.423.445.974.315 1.494l-.547 2.19a.678.678 0 0 0 .178.643l2.457 2.457a.678.678 0 0 0 .644.178l2.189-.547a1.745 1.745 0 0 1 1.494.315l2.306 1.794c.829.645.905 1.87.163 2.611l-1.034 1.034c-.74.74-1.846 1.065-2.877.702a18.634 18.634 0 0 1-7.01-4.42 18.634 18.634 0 0 1-4.42-7.009c-.362-1.03-.037-2.137.703-2.877L1.885.511z"/>
            </svg>
            ${DEALER_PHONE}
          </a>
          <a href="https://maps.google.com/?q=3840+Charles+Blvd+Greenville+NC" target="_blank"
             class="text-decoration-none text-muted d-flex align-items-start justify-content-end gap-1 mt-1" style="font-size:.82rem;line-height:1.5;">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" class="flex-shrink-0 mt-1" viewBox="0 0 16 16">
              <path d="M8 16s6-5.686 6-10A6 6 0 0 0 2 6c0 4.314 6 10 6 10zm0-7a3 3 0 1 1 0-6 3 3 0 0 1 0 6z"/>
            </svg>
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
            <li class="nav-item">
              <a class="nav-link px-4 py-3 fw-semibold text-uppercase bfat-navlink active" href="${ASSET_PREFIX}inventory.html">Inventory</a>
            </li>
            <li class="nav-item">
              <a class="nav-link px-4 py-3 fw-semibold text-uppercase bfat-navlink" href="${ASSET_PREFIX}about.html">About</a>
            </li>
            <li class="nav-item">
              <a class="nav-link px-4 py-3 fw-semibold text-uppercase bfat-navlink" href="${ASSET_PREFIX}reviews.html">Reviews</a>
            </li>
            <li class="nav-item">
              <a class="nav-link px-4 py-3 fw-semibold text-uppercase bfat-navlink" href="${ASSET_PREFIX}financing.html">Financing</a>
            </li>
            <li class="nav-item">
              <a class="nav-link px-4 py-3 fw-semibold text-uppercase bfat-navlink" href="${ASSET_PREFIX}contact.html#visit">Contact</a>
            </li>
            <li class="nav-item">
              <a class="nav-link px-4 py-3 fw-semibold text-uppercase bfat-navlink" href="${ASSET_PREFIX}blog.html">Blog</a>
            </li>
          </ul>
        </div>
      </div>
    </nav>
  </header>

  <main id="main" class="vdp-main">

    <!-- Breadcrumb -->
    <nav class="vdp-breadcrumb" aria-label="Breadcrumb">
      <div class="container">
        <a href="${ASSET_PREFIX}index.html">Home</a>
        <span class="sep">&rsaquo;</span>
        <a href="${ASSET_PREFIX}inventory.html">Inventory</a>
        <span class="sep">&rsaquo;</span>
        <span>${escapeHtml(title)}</span>
      </div>
    </nav>

    <!-- Photo Gallery -->
    <section aria-label="Vehicle photos">
${v.images && v.images.length > 0 ? `      <div class="swiper vdp-gallery" style="border-radius:12px;overflow:hidden;">
        <div class="swiper-wrapper">
          ${v.images.map(img => `<div class="swiper-slide"><img src="${resolveImg(img, ASSET_PREFIX)}" alt="${escapeAttr(title)}" class="vdp-main-img" style="width:100%;max-height:520px;object-fit:contain;background:#f0f0f0;" loading="lazy" decoding="async"></div>`).join('\n          ')}
        </div>
        <div class="swiper-pagination"></div>
        <div class="swiper-button-prev d-none d-md-flex"></div>
        <div class="swiper-button-next d-none d-md-flex"></div>
      </div>
      <div class="swiper vdp-thumbs mt-2" style="height:80px;">
        <div class="swiper-wrapper">
          ${v.images.map(img => `<div class="swiper-slide" style="width:100px;cursor:pointer;"><img src="${resolveImg(img, ASSET_PREFIX)}" alt="Thumbnail" style="width:100%;height:72px;object-fit:cover;border-radius:6px;" loading="lazy" decoding="async"></div>`).join('\n          ')}
        </div>
      </div>` : `      <div class="d-flex align-items-center justify-content-center" style="height:300px;background:#e9e9e9;color:#999;">
        <div class="text-center">
          <svg width="80" height="80" fill="currentColor" viewBox="0 0 16 16"><rect x="1" y="3" width="15" height="13" rx="1" fill="none" stroke="currentColor" stroke-width="1"/></svg>
          <p class="mt-2">Photo Coming Soon</p>
        </div>
      </div>`}
    </section>

    <!-- Title + Price Row -->
    <section class="vdp-title-row">
      <div class="container">
        <div class="d-flex flex-wrap justify-content-between align-items-start gap-3">
          <div>
            <h1 class="vdp-vehicle-title">${escapeHtml(`${v.year} ${titleCase(v.make)} ${titleCase(v.model)}`)}${v.trim ? ` <span class="vdp-trim">${escapeHtml(v.trim)}</span>` : ''}</h1>
            <div class="vdp-stock-vin">
              ${stock ? escapeHtml(stock) : ''}${stock && vinB64 ? ' &nbsp;|&nbsp; ' : ''}${vinB64 ? `<button class="vin-reveal-btn" data-vin="${vinB64}" onclick="revealVin(this)">&#128269; Click to see VIN</button>` : ''}
            </div>
          </div>
          <div class="text-end">
            <div class="vdp-price-label">Our Price</div>
            <div class="vdp-price-tag">${escapeHtml(price)}</div>
${v.monthlyPayment ? `            <div class="text-muted" style="font-size:.85rem;">$${v.monthlyPayment}/month</div>` : ''}
          </div>
        </div>
      </div>
    </section>

    <!-- Main Content -->
    <div class="container mt-4">
      <div class="row g-4">

        <!-- Left Column: Spec Sections + Description -->
        <div class="col-lg-8">

          <!-- ══ Section 1: Primary Info (title row shows Year/Make/Model/Trim prominently above) ══ -->
          <!-- Quick-glance at-a-glance strip -->
          <div class="vdp-section" role="region" aria-label="Primary vehicle information">
            <div class="vdp-section-header" style="background:#1a1d23;">
              <svg width="16" height="16" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path d="M0 3.5A1.5 1.5 0 0 1 1.5 2h13A1.5 1.5 0 0 1 16 3.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 0 12.5v-9zM1.5 3a.5.5 0 0 0-.5.5V7h1V3H1.5zm-1 4.5v2H2v-2H.5zm0 2.5v1.5a.5.5 0 0 0 .5.5H2v-2H.5zM15 13v-1.5h-1V13h.5a.5.5 0 0 0 .5-.5zM14 3v4h1V3.5a.5.5 0 0 0-.5-.5H14zm1 5h-1v2h1V8zm-1 2.5V13h1v-2.5H14zm-1 3h-1v-2h1V13zm-2 0h-1v-2h1V13zm-2 0H9v-2h1V13zm-2 0H7v-2h1V13zm-2 0H5v-2h1V13zm-2 0H3v-2h1V13zM0 8v2h1V8H0zm0-1V3h1V7H0zm2-4v4h1V3H2zm1 4V3h1V7H3zm1 0V3h1V7H4zm1 0V3h1V7H5zm1 0V3h1V7H6zm1 0V3h1V7H7zm1 0V3h1V7H8zm1 0V3h1V7H9zm1 0V3h1V7h-1zm1 0V3h1V7h-1zm1 0V3h1V7h-1zm1 0V3h1V7h-1zm0 1v2h1V8h-1zm0 3h-1V8h1v3zm-1-3v3h-1V8h1zm-1 3h-1V8h1v3zm-1-3v3H9V8h1zm-1 3H8V8h1v3zm-1-3v3H7V8h1zm-1 3H6V8h1v3zm-1-3v3H5V8h1zm-1 3H4V8h1v3zm-1-3v3H3V8h1zm-1 3H2V8h1v3zm-1-3v3H1V8h1zm-1 3H0V8h1v3z"/></svg>
              Vehicle Overview
            </div>
            <div class="vdp-spec-grid">
              <div class="vdp-spec-item"><div class="vdp-spec-label">Year</div><div class="vdp-spec-value">${escapeHtml(String(v.year || '—'))}</div></div>
              <div class="vdp-spec-item"><div class="vdp-spec-label">Make</div><div class="vdp-spec-value">${escapeHtml(titleCase(v.make) || '—')}</div></div>
              <div class="vdp-spec-item"><div class="vdp-spec-label">Model</div><div class="vdp-spec-value">${escapeHtml(titleCase(v.model) || '—')}</div></div>
              <div class="vdp-spec-item"><div class="vdp-spec-label">Trim</div><div class="vdp-spec-value ${!v.trim ? 'missing' : ''}">${escapeHtml(v.trim || 'Not specified')}</div></div>
            </div>
          </div>

          <!-- ══ Section 2: Technical Specifications ══ -->
          <div class="vdp-section mt-4" role="region" aria-label="Technical specifications">
            <div class="vdp-section-header tech">
              <svg width="16" height="16" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path d="M8.932.727c-.243-.97-1.62-.97-1.864 0l-.071.286a.96.96 0 0 1-1.622.434l-.205-.211c-.695-.719-1.888-.03-1.613.931l.08.284a.96.96 0 0 1-1.186 1.187l-.284-.081c-.96-.275-1.65.918-.931 1.613l.211.205a.96.96 0 0 1-.434 1.622l-.286.071c-.97.243-.97 1.62 0 1.864l.286.071a.96.96 0 0 1 .434 1.622l-.211.205c-.719.695-.03 1.888.931 1.613l.284-.08a.96.96 0 0 1 1.187 1.187l-.081.283c-.275.96.918 1.65 1.613.931l.205-.211a.96.96 0 0 1 1.622.434l.071.286c.243.97 1.62.97 1.864 0l.071-.286a.96.96 0 0 1 1.622-.434l.205.211c.695.719 1.888.03 1.613-.931l-.08-.284a.96.96 0 0 1 1.187-1.186l.283.081c.96.275 1.65-.918.931-1.613l-.211-.205a.96.96 0 0 1 .434-1.622l.286-.071c.97-.243.97-1.62 0-1.864l-.286-.071a.96.96 0 0 1-.434-1.622l.211-.205c.719-.695.03-1.888-.931-1.613l-.284.08a.96.96 0 0 1-1.186-1.186l.081-.284c.275-.96-.918-1.65-1.613-.931l-.205.211a.96.96 0 0 1-1.622-.434L8.932.727zM8 12.997a4.998 4.998 0 1 1 0-9.995 4.998 4.998 0 0 1 0 9.996z"/></svg>
              Technical Specifications
            </div>
            <div class="vdp-spec-grid">
${techSpecs.map(s => `              <div class="vdp-spec-item"><div class="vdp-spec-label">${escapeHtml(s.label)}</div><div class="vdp-spec-value${s.value === '—' ? ' missing' : ''}">${escapeHtml(s.value)}</div></div>`).join('\n')}
            </div>
          </div>

          <!-- ══ Section 3: Appearance ══ -->
          <div class="vdp-section mt-4" role="region" aria-label="Appearance">
            <div class="vdp-section-header appear">
              <svg width="16" height="16" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path d="M13.354.646a1.207 1.207 0 0 0-1.708 0L8.5 3.793l-.646-.647a.5.5 0 1 0-.708.708L8.293 4.5 1.5 11.293A.5.5 0 0 0 1.354 12H.5a.5.5 0 0 0-.354.854l2 2a.5.5 0 0 0 .708 0l1.5-1.5a.5.5 0 0 0 0-.708L4 12.293l6.793-6.793 1.146 1.147a.5.5 0 0 0 .708-.708L12 5.793l3.354-3.354a1.207 1.207 0 0 0 0-1.707l-2-2z"/></svg>
              Appearance
            </div>
            <div class="vdp-spec-grid">
${appearSpecs.map(s => `              <div class="vdp-spec-item"><div class="vdp-spec-label">${escapeHtml(s.label)}</div><div class="vdp-spec-value${s.value === '—' ? ' missing' : ''}">${escapeHtml(s.value)}</div></div>`).join('\n')}
            </div>
          </div>

          <!-- ══ Section 4: Performance & Efficiency ══ -->
          <div class="vdp-section mt-4" role="region" aria-label="Performance and efficiency">
            <div class="vdp-section-header perf">
              <svg width="16" height="16" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 11a1 1 0 1 1 2 0v1a1 1 0 1 1-2 0v-1zm6-4a1 1 0 1 1 2 0v5a1 1 0 1 1-2 0V7zM7 9a1 1 0 0 1 2 0v3a1 1 0 1 1-2 0V9z"/><path d="M4 1.5H3a2 2 0 0 0-2 2V14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V3.5a2 2 0 0 0-2-2h-1v1h1a1 1 0 0 1 1 1V14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1h1v-1z"/><path d="M9.5 1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-3a.5.5 0 0 1-.5-.5v-1a.5.5 0 0 1 .5-.5h3zm-3-1A1.5 1.5 0 0 0 5 1.5v1A1.5 1.5 0 0 0 6.5 4h3A1.5 1.5 0 0 0 11 2.5v-1A1.5 1.5 0 0 0 9.5 0h-3z"/></svg>
              Performance &amp; Efficiency
            </div>
            <div class="vdp-spec-grid">
${perfSpecs.map(s => `              <div class="vdp-spec-item"><div class="vdp-spec-label">${escapeHtml(s.label)}</div><div class="vdp-spec-value${s.value === '—' ? ' missing' : ''}">${escapeHtml(s.value)}</div></div>`).join('\n')}
            </div>
${(v.mpgCity && v.mpgHighway) ? `            <!-- Visual MPG strip -->
            <div class="vdp-mpg-strip" role="img" aria-label="Fuel economy: ${v.mpgCity} city, ${v.mpgHighway} highway MPG">
              <div class="vdp-mpg-box">
                <div class="vdp-mpg-num">${v.mpgCity}</div>
                <div class="vdp-mpg-unit">City MPG</div>
              </div>
              <div class="vdp-mpg-box" style="flex:0 0 auto;padding:1.1rem 1.5rem;display:flex;align-items:center;border-right:1px solid #f2f2f2;">
                <svg width="30" height="30" fill="#e87722" viewBox="0 0 16 16" aria-hidden="true"><path d="M1 2a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v8a2 2 0 0 1 2 2v.5a.5.5 0 0 0 1 0V8h-.5a.5.5 0 0 1-.5-.5V4.375a.5.5 0 0 1 .5-.5h1.495c-.011-.476-.053-.894-.201-1.222a.22.22 0 0 0-.038-.063c-.137-.14-.353-.247-.51-.331a8 8 0 0 0-.345-.163l-.008-.003h-.004a.5.5 0 0 1 .4-.916l.008.004.018.008.066.03a9 9 0 0 1 .383.18c.17.091.462.264.674.486.212.221.46.58.46 1.137V7.5a.5.5 0 0 1-.5.5H14v4.5a1.5 1.5 0 0 1-3 0V12a1 1 0 0 0-1-1h-.5V2a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v13H1V2z"/></svg>
              </div>
              <div class="vdp-mpg-box">
                <div class="vdp-mpg-num">${v.mpgHighway}</div>
                <div class="vdp-mpg-unit">Hwy MPG</div>
              </div>
            </div>
            <div class="vdp-mpg-note">Est. MPG. Actual mileage may vary with driving conditions.</div>` : ''}
          </div>

          <!-- ══ Section 5: Administrative Details ══ -->
          <div class="vdp-section mt-4" role="region" aria-label="Administrative details">
            <div class="vdp-section-header admin">
              <svg width="16" height="16" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 3A1.5 1.5 0 0 0 1 4.5v.793c.026.009.051.02.076.032L7.674 8.51c.206.1.446.1.652 0l6.598-3.185A.755.755 0 0 1 15 5.293V4.5A1.5 1.5 0 0 0 13.5 3h-11z"/><path d="M15 6.954 8.978 9.86a2.25 2.25 0 0 1-1.956 0L1 6.954V11.5A1.5 1.5 0 0 0 2.5 13h11a1.5 1.5 0 0 0 1.5-1.5V6.954z"/></svg>
              Administrative Details
            </div>
            <div class="vdp-spec-grid">
${adminSpecs.map(s => {
  // VIN gets special treatment — still mask it but show in this section
  if (s.label === 'VIN' && vinB64) {
    return `              <div class="vdp-spec-item" style="grid-column:1/-1;"><div class="vdp-spec-label">VIN</div><div class="vdp-spec-value vin-field"><button class="vin-reveal-btn" data-vin="${vinB64}" onclick="revealVin(this)" aria-label="Click to reveal VIN number">&#128269; Click to reveal</button></div></div>`;
  }
  return `              <div class="vdp-spec-item"><div class="vdp-spec-label">${escapeHtml(s.label)}</div><div class="vdp-spec-value${s.value === '—' ? ' missing' : ''}">${escapeHtml(s.value)}</div></div>`;
}).join('\n')}
            </div>
          </div>

${(v.features && v.features.length > 0) ? `          <!-- Standard Features -->
          <div class="vdp-features mt-4">
            <h2 class="vdp-features-title">Standard Features</h2>
            <div class="vdp-features-grid" style="grid-template-columns:1fr 1fr 1fr;">
${v.features.map(f => `              <div class="vdp-feature-item">${escapeHtml(f)}</div>`).join('\n')}
            </div>
          </div>` : ''}

${(v.mechanical && v.mechanical.length > 0) ? `          <!-- Mechanical -->
          <div class="vdp-specs mt-4">
            <h2 class="vdp-specs-title" style="background:#333;">Mechanical</h2>
            <div class="p-3" style="background:#fff;">
              <ul class="list-unstyled mb-0" style="font-size:.9rem;color:#444;">
${v.mechanical.map(m => `                <li class="py-1">${escapeHtml(m)}</li>`).join('\n')}
              </ul>
            </div>
          </div>` : ''}

${(v.exterior && v.exterior.length > 0) ? `          <!-- Exterior -->
          <div class="vdp-specs mt-4">
            <h2 class="vdp-specs-title" style="background:#333;">Exterior</h2>
            <div class="p-3" style="background:#fff;">
              <ul class="list-unstyled mb-0" style="font-size:.9rem;color:#444;">
${v.exterior.map(e => `                <li class="py-1">${escapeHtml(e)}</li>`).join('\n')}
              </ul>
            </div>
          </div>` : ''}

${(v.entertainment && v.entertainment.length > 0) ? `          <!-- Entertainment -->
          <div class="vdp-specs mt-4">
            <h2 class="vdp-specs-title" style="background:#333;">Entertainment</h2>
            <div class="p-3" style="background:#fff;">
              <ul class="list-unstyled mb-0" style="font-size:.9rem;color:#444;">
${v.entertainment.map(e => `                <li class="py-1">${escapeHtml(e)}</li>`).join('\n')}
              </ul>
            </div>
          </div>` : ''}

${(v.interior && v.interior.length > 0) ? `          <!-- Interior -->
          <div class="vdp-specs mt-4">
            <h2 class="vdp-specs-title" style="background:#333;">Interior</h2>
            <div class="p-3" style="background:#fff;">
              <ul class="list-unstyled mb-0" style="font-size:.9rem;color:#444;">
${v.interior.map(i => `                <li class="py-1">${escapeHtml(i)}</li>`).join('\n')}
              </ul>
            </div>
          </div>` : ''}

          <!-- ══ Section 6: Vehicle Description ══ -->
          <div class="vdp-section mt-4" role="region" aria-label="Vehicle description">
            <div class="vdp-section-header desc">
              <svg width="16" height="16" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 7a.5.5 0 0 0 0 1h5a.5.5 0 0 0 0-1h-5zM5 9.5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 0 1h-2a.5.5 0 0 1-.5-.5z"/><path d="M9.5 0H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V4.5L9.5 0zm0 1v2A1.5 1.5 0 0 0 11 4.5h2V14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1h5.5z"/></svg>
              About This Vehicle
            </div>
            <div style="padding:1.25rem;background:#fff;">
              <p style="font-size:.93rem;color:#444;line-height:1.75;margin:0;">${escapeHtml(v.description || generateDescription(v))}</p>
            </div>
          </div>
        </div>

        <!-- Right Column: CTAs -->
        <div class="col-lg-4">
          <div class="vdp-cta-card">
            <div class="vdp-cta-header">Interested in This Vehicle?</div>
            <div class="vdp-cta-body">
              <a href="${applyHref}" class="vdp-cta-btn primary">Apply for Financing</a>
              <a href="${inquireHref}" class="vdp-cta-btn outline">Send an Inquiry</a>
              <a href="tel:${DEALER_PHONE_TEL}" class="vdp-cta-btn secondary">
                <svg width="16" height="16" fill="currentColor" viewBox="0 0 16 16" class="me-1"><path fill-rule="evenodd" d="M1.885.511a1.745 1.745 0 0 1 2.61.163L6.29 2.98c.329.423.445.974.315 1.494l-.547 2.19a.678.678 0 0 0 .178.643l2.457 2.457a.678.678 0 0 0 .644.178l2.189-.547a1.745 1.745 0 0 1 1.494.315l2.306 1.794c.829.645.905 1.87.163 2.611l-1.034 1.034c-.74.74-1.846 1.065-2.877.702a18.634 18.634 0 0 1-7.01-4.42 18.634 18.634 0 0 1-4.42-7.009c-.362-1.03-.037-2.137.703-2.877L1.885.511z"/></svg>
                Call ${DEALER_PHONE}
              </a>
              <a href="${ASSET_PREFIX}contact.html?vehicle=${encodeURIComponent(title)}#appointment" class="vdp-cta-btn dark">Schedule Test Drive</a>
            </div>
          </div>

          <!-- Dealer Info -->
          <div class="vdp-cta-card mt-3">
            <div class="vdp-cta-header">Visit Us</div>
            <div class="vdp-cta-body" style="font-size:.9rem;">
              <p class="mb-2"><strong>${DEALER_NAME}</strong></p>
              <p class="mb-2">
                <a href="https://maps.google.com/?q=3840+Charles+Blvd+Greenville+NC" target="_blank" class="text-decoration-none text-dark">
                  ${DEALER_STREET}<br>${DEALER_CITY}, ${DEALER_STATE} ${DEALER_ZIP}
                </a>
              </p>
              <p class="mb-2">
                <a href="tel:${DEALER_PHONE_TEL}" class="text-decoration-none text-dark fw-bold">${DEALER_PHONE}</a>
              </p>
              <p class="mb-0 text-muted" style="font-size:.82rem;">
                Mon–Fri: 8AM–6PM &bull; Sat: 9AM–2PM &bull; Sun: Appt Only
              </p>
            </div>
          </div>
        </div>
      </div>

${similar.length > 0 ? `      <!-- Similar Vehicles -->
      <section class="vdp-similar">
        <h2>Similar Vehicles</h2>
        <div class="row g-3">
${similar.map(sv => {
  const svTitle = vehicleTitle(sv);
  const svHref = buildVDPPath(sv);
  const svImg = sv.images && sv.images.length > 0
    ? resolveImg(sv.images[0], ASSET_PREFIX)
    : '';
  const svPrice = sv.price ? formatMoney(sv.price) : 'Call';
  const svMiles = sv.mileage ? `${Number(sv.mileage).toLocaleString()} mi` : '';
  return `          <div class="col-6 col-md-4 col-lg-2">
            <a href="${ASSET_PREFIX}${svHref.replace(/^\//, '')}" class="vdp-similar-card">
${svImg ? `              <img src="${escapeAttr(svImg)}" alt="${escapeAttr(svTitle)}" loading="lazy">` : `              <div style="height:160px;background:#eee;display:flex;align-items:center;justify-content:center;color:#999;font-size:.8rem;">No Photo</div>`}
              <div class="vdp-similar-body">
                <div class="vdp-similar-title">${escapeHtml(svTitle)}</div>
                <div class="vdp-similar-price">${escapeHtml(svPrice)}</div>
${svMiles ? `                <div class="vdp-similar-miles">${escapeHtml(svMiles)}</div>` : ''}
              </div>
            </a>
          </div>`;
}).join('\n')}
        </div>
      </section>` : ''}
    </div>
  </main>

  <!-- FOOTER -->
  <footer style="background:#1a1a1a;color:#ccc;">
    <div class="container py-5">
      <div class="row g-5">
        <div class="col-lg-4 col-md-6">
          <h5 class="fw-bold text-white mb-3 pb-2" style="border-bottom:1px solid #444;">Contact Information</h5>
          <div class="d-flex gap-3 align-items-start mb-3">
            <div style="width:38px;height:38px;border-radius:50%;background:#dc3545;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="#fff" viewBox="0 0 16 16">
                <path d="M8 16s6-5.686 6-10A6 6 0 0 0 2 6c0 4.314 6 10 6 10zm0-7a3 3 0 1 1 0-6 3 3 0 0 1 0 6z"/>
              </svg>
            </div>
            <div>
              <div class="text-white-50 small mb-1">Address</div>
              <a href="https://maps.google.com/?q=3840+Charles+Blvd+Greenville+NC" target="_blank"
                 class="text-white text-decoration-none fw-semibold">${DEALER_STREET}<br>${DEALER_CITY}, ${DEALER_STATE} ${DEALER_ZIP}</a>
            </div>
          </div>
          <div class="d-flex gap-3 align-items-start mb-4">
            <div style="width:38px;height:38px;border-radius:50%;background:#dc3545;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="#fff" viewBox="0 0 16 16">
                <path fill-rule="evenodd" d="M1.885.511a1.745 1.745 0 0 1 2.61.163L6.29 2.98c.329.423.445.974.315 1.494l-.547 2.19a.678.678 0 0 0 .178.643l2.457 2.457a.678.678 0 0 0 .644.178l2.189-.547a1.745 1.745 0 0 1 1.494.315l2.306 1.794c.829.645.905 1.87.163 2.611l-1.034 1.034c-.74.74-1.846 1.065-2.877.702a18.634 18.634 0 0 1-7.01-4.42 18.634 18.634 0 0 1-4.42-7.009c-.362-1.03-.037-2.137.703-2.877L1.885.511z"/>
              </svg>
            </div>
            <div>
              <div class="text-white-50 small mb-1">Phone</div>
              <a href="tel:${DEALER_PHONE_TEL}" class="text-white text-decoration-none fw-bold" style="font-size:1.15rem;">${DEALER_PHONE}</a>
            </div>
          </div>
          <div>
            <div class="text-white-50 small mb-2">Connect</div>
            <div class="d-flex gap-2">
              <a href="${DEALER_FB}" target="_blank" aria-label="Facebook"
                 style="display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:5px;background:#1877f2;color:#fff;text-decoration:none;">
                <svg width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M16 8.049c0-4.446-3.582-8.05-8-8.05C3.58 0-.002 3.603-.002 8.05c0 4.017 2.926 7.347 6.75 7.951v-5.625h-2.03V8.05H6.75V6.275c0-2.017 1.195-3.131 3.022-3.131.876 0 1.791.157 1.791.157v1.98h-1.009c-.993 0-1.303.621-1.303 1.258v1.51h2.218l-.354 2.326H9.25V16c3.824-.604 6.75-3.934 6.75-7.951z"/></svg>
              </a>
              <a href="${DEALER_FB}" target="_blank" aria-label="Instagram"
                 style="display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:5px;background:radial-gradient(circle at 30% 107%,#fdf497 0%,#fd5949 45%,#d6249f 60%,#285AEB 90%);color:#fff;text-decoration:none;">
                <svg width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M8 0C5.829 0 5.556.01 4.703.048 3.85.088 3.269.222 2.76.42a3.9 3.9 0 0 0-1.417.923A3.9 3.9 0 0 0 .42 2.76C.222 3.268.087 3.85.048 4.7.01 5.555 0 5.827 0 8.001c0 2.172.01 2.444.048 3.297.04.852.174 1.433.372 1.942.205.526.478.972.923 1.417.444.445.89.719 1.416.923.51.198 1.09.333 1.942.372C5.555 15.99 5.827 16 8 16s2.444-.01 3.298-.048c.851-.04 1.434-.174 1.943-.372a3.9 3.9 0 0 0 1.416-.923c.445-.445.718-.891.923-1.417.197-.509.332-1.09.372-1.942C15.99 10.445 16 10.173 16 8s-.01-2.445-.048-3.299c-.04-.851-.175-1.433-.372-1.941a3.9 3.9 0 0 0-.923-1.417A3.9 3.9 0 0 0 13.24.42c-.51-.198-1.092-.333-1.943-.372C10.443.01 10.172 0 7.998 0h.003zm-.717 1.442h.718c2.136 0 2.389.007 3.232.046.78.035 1.204.166 1.486.275.373.145.64.319.92.599.28.28.453.546.598.92.11.281.24.705.275 1.485.039.843.047 1.096.047 3.231s-.008 2.389-.047 3.232c-.035.78-.166 1.203-.275 1.485a2.47 2.47 0 0 1-.599.919c-.28.28-.546.453-.92.598-.28.11-.704.24-1.485.276-.843.038-1.096.047-3.232.047s-2.39-.009-3.232-.047c-.78-.036-1.203-.166-1.485-.276a2.478 2.478 0 0 1-.92-.598 2.48 2.48 0 0 1-.6-.92c-.109-.281-.24-.705-.275-1.485-.038-.843-.046-1.096-.046-3.233 0-2.136.008-2.388.046-3.231.036-.78.166-1.204.276-1.486.145-.373.319-.64.599-.92.28-.28.546-.453.92-.598.282-.11.705-.24 1.485-.276.738-.034 1.024-.044 2.515-.045v.002zm4.988 1.328a.96.96 0 1 0 0 1.92.96.96 0 0 0 0-1.92zm-4.27 1.122a4.109 4.109 0 1 0 0 8.217 4.109 4.109 0 0 0 0-8.217zm0 1.441a2.667 2.667 0 1 1 0 5.334 2.667 2.667 0 0 1 0-5.334z"/></svg>
              </a>
              <a href="https://www.google.com/maps/place/Bells+Fork+Truck+and+Auto/@35.5641622,-77.367721,15z/data=!3m1!4b1!4m6!3m5!1s0x89aeddacc00176bf:0x2e8db9e8d1d56161!8m2!3d35.5641462!4d-77.349267!16s%2Fg%2F11yxj2p8q_?hl=en&entry=ttu&g_ep=EgoyMDI2MDIyNS4wIKXMDSoASAFQAw%3D%3D" target="_blank" rel="noreferrer" aria-label="Google Business"
                 style="display:inline-flex;align-items:center;justify-content:center;width:38px;height:38px;border-radius:50%;text-decoration:none;overflow:hidden;transition:background .2s;">
              <img src="${ASSET_PREFIX}assets/google-icon-bw.png" alt="Google Business" width="38" height="38" style="display:block;">
              </a>
            </div>
          </div>
        </div>
        <div class="col-lg-4 col-md-6">
          <h5 class="fw-bold text-white mb-3 pb-2" style="border-bottom:1px solid #444;">Store Hours</h5>
          <table class="w-100" style="font-size:.92rem;border-collapse:separate;border-spacing:0 6px;">
            <tr><td class="text-white-50" style="width:45%;">Monday:</td><td class="text-white fw-semibold">8:00 AM – 6:00 PM</td></tr>
            <tr><td class="text-white-50">Tuesday:</td><td class="text-white fw-semibold">8:00 AM – 6:00 PM</td></tr>
            <tr><td class="text-white-50">Wednesday:</td><td class="text-white fw-semibold">8:00 AM – 6:00 PM</td></tr>
            <tr><td class="text-white-50">Thursday:</td><td class="text-white fw-semibold">8:00 AM – 6:00 PM</td></tr>
            <tr><td class="text-white-50">Friday:</td><td class="text-white fw-semibold">8:00 AM – 6:00 PM</td></tr>
            <tr><td class="text-white-50">Saturday:</td><td class="text-white fw-semibold">9:00 AM – 2:00 PM</td></tr>
            <tr><td class="text-white-50">Sunday:</td><td class="text-white fw-semibold">Appointment Only</td></tr>
          </table>
        </div>
        <div class="col-lg-4 col-md-12">
          <h5 class="fw-bold text-white mb-3 pb-2" style="border-bottom:1px solid #444;">Quick Links</h5>
          <ul class="list-unstyled mb-0" style="font-size:.95rem;">
            <li class="mb-2"><a href="${ASSET_PREFIX}inventory.html" class="text-white-50 text-decoration-none footer-link">Inventory</a></li>
            <li class="mb-2"><a href="${ASSET_PREFIX}about.html" class="text-white-50 text-decoration-none footer-link">About Us</a></li>
            <li class="mb-2"><a href="${ASSET_PREFIX}reviews.html" class="text-white-50 text-decoration-none footer-link">Reviews</a></li>
            <li class="mb-2"><a href="${ASSET_PREFIX}financing.html" class="text-white-50 text-decoration-none footer-link">Financing</a></li>
            <li class="mb-2"><a href="${ASSET_PREFIX}contact.html#visit" class="text-white-50 text-decoration-none footer-link">Contact Us</a></li>
            <li class="mb-2"><a href="${ASSET_PREFIX}privacy.html" class="text-white-50 text-decoration-none footer-link">Privacy Policy</a></li>
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
    <a href="sms:${DEALER_PHONE_TEL}" class="mobile-action" aria-label="Text us">
      <svg width="18" height="18" fill="currentColor" viewBox="0 0 16 16" class="me-1"><path d="M2.678 11.894a1 1 0 0 1 .287.801 10.97 10.97 0 0 1-.398 2c1.395-.323 2.247-.697 2.634-.893a1 1 0 0 1 .71-.074A8.06 8.06 0 0 0 8 14c3.996 0 7-2.807 7-6 0-3.192-3.004-6-7-6S1 4.808 1 8c0 1.468.617 2.83 1.678 3.894zm-.493 3.905a21.682 21.682 0 0 1-.713.129c-.2.032-.352-.176-.273-.362a9.68 9.68 0 0 0 .244-.637l.003-.01c.248-.72.45-1.548.524-2.319C.743 11.37 0 9.76 0 8c0-3.866 3.582-7 8-7s8 3.134 8 7-3.582 7-8 7a9.06 9.06 0 0 1-2.347-.306c-.52.263-1.639.742-3.468 1.105z"/></svg>
      Text
    </a>
    <a href="https://maps.google.com/?q=3840+Charles+Blvd+Greenville+NC" target="_blank" class="mobile-action" aria-label="Get directions">
      <svg width="18" height="18" fill="currentColor" viewBox="0 0 16 16" class="me-1"><path d="M8 16s6-5.686 6-10A6 6 0 0 0 2 6c0 4.314 6 10 6 10zm0-7a3 3 0 1 1 0-6 3 3 0 0 1 0 6z"/></svg>
      Directions
    </a>
  </div>

  <!-- Bootstrap JS -->
  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>

  <script>
  // Year in footer
  document.getElementById('year').textContent = new Date().getFullYear();

  function revealVin(btn) {
    var v = atob(btn.getAttribute('data-vin'));
    var s = document.createElement('span');
    s.style.fontFamily = 'monospace';
    s.textContent = 'VIN: ' + v;
    btn.replaceWith(s);
  }

  </script>
  <script src="https://cdn.jsdelivr.net/npm/swiper@11/swiper-bundle.min.js" defer></script>
  <script>
document.addEventListener('DOMContentLoaded',function(){
  var thumbs=new Swiper('.vdp-thumbs',{slidesPerView:'auto',spaceBetween:8,freeMode:true,watchSlidesProgress:true});
  new Swiper('.vdp-gallery',{loop:true,spaceBetween:10,pagination:{el:'.swiper-pagination',clickable:true},navigation:{nextEl:'.swiper-button-next',prevEl:'.swiper-button-prev'},thumbs:{swiper:thumbs}});
});
  </script>
  <script src="/assets/js/tracker.js" defer></script>
<script>if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js');</script>
</body>
</html>`;
}

// ── Sitemap generation ──
function generateSitemap(vehicles) {
  const today = todayISO();
  const staticPages = [
    { loc: '/', priority: '1.0', changefreq: 'weekly' },
    { loc: '/inventory.html', priority: '0.9', changefreq: 'daily' },
    { loc: '/financing.html', priority: '0.8', changefreq: 'monthly' },
    { loc: '/contact.html', priority: '0.8', changefreq: 'monthly' },
    { loc: '/about.html', priority: '0.7', changefreq: 'monthly' },
    { loc: '/reviews.html', priority: '0.7', changefreq: 'weekly' },
    { loc: '/privacy.html', priority: '0.3', changefreq: 'yearly' },
  ];

  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;

  for (const page of staticPages) {
    xml += `\n  <url>\n    <loc>${SITE_URL}${page.loc}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>${page.changefreq}</changefreq>\n    <priority>${page.priority}</priority>\n  </url>\n`;
  }

  for (const v of vehicles) {
    const vdpPath = buildVDPPath(v);
    xml += `\n  <url>\n    <loc>${SITE_URL}${vdpPath}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.8</priority>\n  </url>\n`;
  }

  xml += `\n</urlset>\n`;
  return xml;
}

// ── Main ──
function main() {
  const rootDir = __dirname;
  const inventoryPath = path.join(rootDir, 'inventory.json');

  if (!fs.existsSync(inventoryPath)) {
    console.error('Error: inventory.json not found at', inventoryPath);
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(inventoryPath, 'utf-8'));
  const vehicles = (data.vehicles || [])
    .filter(v => v && (v.status === 'available' || !v.status))
    .map(v => ({
      ...v,
      images: Array.isArray(v.images) ? v.images.map(resolveInventoryImageName) : []
    }));

  if (vehicles.length === 0) {
    console.log('No available vehicles found in inventory.json');
    return;
  }

  console.log(`Generating VDP pages for ${vehicles.length} vehicles...`);

  // Clean old VDP directory
  const vdpDir = path.join(rootDir, 'vdp');
  if (fs.existsSync(vdpDir)) {
    fs.rmSync(vdpDir, { recursive: true, force: true });
  }

  let generated = 0;
  for (const v of vehicles) {
    const id = buildVDPId(v);
    const slug = buildVDPSlug(v);
    const dirPath = path.join(vdpDir, id, slug);
    const filePath = path.join(dirPath, 'index.html');

    fs.mkdirSync(dirPath, { recursive: true });
    const html = generateVDPHtml(v, vehicles);
    fs.writeFileSync(filePath, html, 'utf-8');
    generated++;

    const title = vehicleTitle(v);
    console.log(`  [${generated}/${vehicles.length}] ${title} → vdp/${id}/${slug}/`);
  }

  // Generate updated sitemap
  const sitemapPath = path.join(rootDir, 'sitemap.xml');
  const sitemap = generateSitemap(vehicles);
  fs.writeFileSync(sitemapPath, sitemap, 'utf-8');
  console.log(`\nSitemap updated: ${sitemapPath} (${vehicles.length} VDP entries added)`);

  console.log(`\nDone! Generated ${generated} VDP pages.`);
}

main();
