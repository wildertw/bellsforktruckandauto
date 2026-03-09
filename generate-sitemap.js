#!/usr/bin/env node
// generate-sitemap.js — Generate sitemap.xml dynamically from inventory + static pages
// Run AFTER generate-vdp.js so VDP folders exist

const fs = require('fs');
const path = require('path');
const { SITE_URL, buildVDPPath, loadAvailableVehicles, todayISO } = require('./build-utils');

const today = todayISO();

// Static pages with their change frequency and priority
const STATIC_PAGES = [
  { loc: '/', changefreq: 'weekly', priority: '1.0' },
  { loc: '/inventory', changefreq: 'daily', priority: '0.9' },
  { loc: '/used-trucks-greenville-nc/', changefreq: 'daily', priority: '0.9' },
  { loc: '/used-suvs-greenville-nc/', changefreq: 'daily', priority: '0.9' },
  { loc: '/used-cars-greenville-nc/', changefreq: 'daily', priority: '0.9' },
  { loc: '/used-diesel-trucks-greenville-nc/', changefreq: 'daily', priority: '0.9' },
  { loc: '/financing/', changefreq: 'monthly', priority: '0.8' },
  { loc: '/schedule-test-drive/', changefreq: 'monthly', priority: '0.8' },
  { loc: '/make-an-offer/', changefreq: 'monthly', priority: '0.8' },
  { loc: '/trade-in-value/', changefreq: 'monthly', priority: '0.8' },
  { loc: '/consignment/', changefreq: 'monthly', priority: '0.7' },
  { loc: '/contact', changefreq: 'monthly', priority: '0.8' },
  { loc: '/about', changefreq: 'monthly', priority: '0.7' },
  { loc: '/reviews', changefreq: 'weekly', priority: '0.7' },
  { loc: '/blog', changefreq: 'monthly', priority: '0.6' },
  { loc: '/privacy', changefreq: 'yearly', priority: '0.3' },
];

function escapeXml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function urlEntry(loc, changefreq, priority) {
  return `  <url>
    <loc>${escapeXml(SITE_URL + loc)}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`;
}

function main() {
  const vehicles = loadAvailableVehicles();
  console.log(`Generating sitemap with ${STATIC_PAGES.length} static pages + ${vehicles.length} VDPs...`);

  const entries = [];

  // Add static pages
  for (const page of STATIC_PAGES) {
    entries.push(urlEntry(page.loc, page.changefreq, page.priority));
  }

  // Add VDP pages
  for (const v of vehicles) {
    const vdpPath = buildVDPPath(v);
    entries.push(urlEntry(vdpPath, 'weekly', '0.8'));
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">

${entries.join('\n\n')}

</urlset>
`;

  const sitemapPath = path.join(__dirname, 'sitemap.xml');
  fs.writeFileSync(sitemapPath, xml, 'utf-8');
  console.log(`Sitemap generated: ${STATIC_PAGES.length + vehicles.length} URLs`);
}

main();
