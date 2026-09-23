#!/usr/bin/env node
// generate-sitemap.js — Generate sitemap.xml dynamically from inventory + static pages
// Run AFTER generate-vdp.js so VDP folders exist

const fs = require('fs');
const path = require('path');
const { SITE_URL, buildVDPPath, loadAvailableVehicles, todayISO } = require('./build-utils');
const { loadPublishedBlogPosts } = require('./blog-source');
const { postUrl } = require('./prerender-blog');

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
  { loc: '/blog', changefreq: 'weekly', priority: '0.7' },
  { loc: '/privacy', changefreq: 'yearly', priority: '0.3' },
];

function escapeXml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function urlEntry(loc, changefreq, priority, lastmod = today) {
  return `  <url>
    <loc>${escapeXml(loc.startsWith('http') ? loc : SITE_URL + loc)}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`;
}

// Real per-post lastmod (YYYY-MM-DD) from the CMS timestamps
function postLastmod(post) {
  const d = new Date(post.updatedAt || post.publishedAt || post.createdAt || '');
  return Number.isNaN(d.getTime()) ? today : d.toISOString().slice(0, 10);
}

async function main() {
  const vehicles = loadAvailableVehicles();
  // Same published-only source as prerender-blog.js; throws (fails the build) on fetch errors
  const posts = (await loadPublishedBlogPosts()) || [];
  console.log(`Generating sitemap with ${STATIC_PAGES.length} static pages + ${vehicles.length} VDPs + ${posts.length} blog posts...`);

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

  // Add blog posts (canonical www URLs, matching each post's <link rel="canonical">)
  for (const post of posts) {
    entries.push(urlEntry(postUrl(post), 'monthly', '0.7', postLastmod(post)));
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">

${entries.join('\n\n')}

</urlset>
`;

  const mainSitemapPath = path.join(__dirname, 'sitemap-main.xml');
  fs.writeFileSync(mainSitemapPath, xml, 'utf-8');
  console.log(`Main sitemap generated: ${entries.length} URLs`);

  // Sitemap index. Blog posts are listed in sitemap-main.xml (build time, www canonicals), so the
  // runtime /blog-sitemap.xml function is no longer referenced here.
  const sitemapIndex = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap>
    <loc>${SITE_URL}/sitemap-main.xml</loc>
    <lastmod>${today}</lastmod>
  </sitemap>
</sitemapindex>
`;

  const sitemapIndexPath = path.join(__dirname, 'sitemap.xml');
  fs.writeFileSync(sitemapIndexPath, sitemapIndex, 'utf-8');
  console.log('Sitemap index generated: sitemap.xml -> sitemap-main.xml');
}

main().catch((err) => {
  console.error(`[generate-sitemap] FAILED: ${err.stack || err.message}`);
  process.exit(1);
});
