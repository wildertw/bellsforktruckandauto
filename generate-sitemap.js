#!/usr/bin/env node
// generate-sitemap.js — Generate sitemap.xml dynamically from inventory + static pages
// Run AFTER generate-vdp.js so VDP folders exist

const fs = require('fs');
const path = require('path');
const { SITE_URL, buildVDPPath, loadAvailableVehicles } = require('./build-utils');
const { loadPublishedBlogPosts } = require('./blog-source');
const { postUrl } = require('./prerender-blog');
const {
  loadInventoryDates,
  lastCommitDate,
  latest,
  formatLastmod,
  toDate,
} = require('./sitemap-dates');

// Static pages with their change frequency and priority.
// lastmod = latest of: the last commit to `sources` (the files the page's content comes from),
// the date the available-vehicle list last changed (`inventory`), the newest blog post (`blog`).
const CATEGORY_SRC = ['generate-category-pages.js'];
const FORM_SRC = ['generate-form-pages.js'];
const STATIC_PAGES = [
  { loc: '/', changefreq: 'weekly', priority: '1.0', sources: ['index.html', 'prerender-homepage.js'], inventory: true },
  { loc: '/inventory', changefreq: 'daily', priority: '0.9', sources: ['inventory.html', 'prerender-inventory.js'], inventory: true },
  { loc: '/used-trucks-greenville-nc/', changefreq: 'daily', priority: '0.9', sources: CATEGORY_SRC, inventory: true },
  { loc: '/used-suvs-greenville-nc/', changefreq: 'daily', priority: '0.9', sources: CATEGORY_SRC, inventory: true },
  { loc: '/used-cars-greenville-nc/', changefreq: 'daily', priority: '0.9', sources: CATEGORY_SRC, inventory: true },
  { loc: '/used-diesel-trucks-greenville-nc/', changefreq: 'daily', priority: '0.9', sources: CATEGORY_SRC, inventory: true },
  { loc: '/financing/', changefreq: 'monthly', priority: '0.8', sources: FORM_SRC },
  { loc: '/schedule-test-drive/', changefreq: 'monthly', priority: '0.8', sources: FORM_SRC },
  { loc: '/make-an-offer/', changefreq: 'monthly', priority: '0.8', sources: FORM_SRC },
  { loc: '/trade-in-value/', changefreq: 'monthly', priority: '0.8', sources: FORM_SRC },
  { loc: '/consignment/', changefreq: 'monthly', priority: '0.7', sources: FORM_SRC },
  { loc: '/contact', changefreq: 'monthly', priority: '0.8', sources: ['contact.html'] },
  { loc: '/about', changefreq: 'monthly', priority: '0.7', sources: ['about.html'] },
  { loc: '/reviews', changefreq: 'weekly', priority: '0.7', sources: ['reviews.html'] },
  { loc: '/blog', changefreq: 'weekly', priority: '0.7', sources: ['blog.html'], blog: true },
  { loc: '/privacy', changefreq: 'yearly', priority: '0.3', sources: ['privacy.html'] },
];

function escapeXml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// lastmod: a Date, or null to omit <lastmod> (better than a made-up date)
function urlEntry(loc, changefreq, priority, lastmod) {
  const day = formatLastmod(lastmod);
  const lastmodLine = day ? `\n    <lastmod>${day}</lastmod>` : '';
  return `  <url>
    <loc>${escapeXml(loc.startsWith('http') ? loc : SITE_URL + loc)}</loc>${lastmodLine}
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`;
}

// Real per-post lastmod from the CMS timestamps
function postLastmod(post) {
  return toDate(post.updatedAt || post.publishedAt || post.createdAt);
}

async function main() {
  const vehicles = loadAvailableVehicles();
  // Same published-only source as prerender-blog.js; throws (fails the build) on fetch errors
  const posts = (await loadPublishedBlogPosts()) || [];
  console.log(`Generating sitemap with ${STATIC_PAGES.length} static pages + ${vehicles.length} VDPs + ${posts.length} blog posts...`);

  const inventoryDates = loadInventoryDates();
  const newestPost = latest(posts.map(postLastmod));
  console.log(`  lastmod source for inventory pages: ${inventoryDates.source}`);

  const entries = [];
  const dates = [];
  const add = (loc, changefreq, priority, lastmod) => {
    entries.push(urlEntry(loc, changefreq, priority, lastmod));
    dates.push(lastmod);
  };

  // Add static pages
  for (const page of STATIC_PAGES) {
    const lastmod = latest(
      lastCommitDate(page.sources),
      page.inventory ? inventoryDates.listing : null,
      page.blog ? newestPost : null
    );
    add(page.loc, page.changefreq, page.priority, lastmod);
  }

  // Add VDP pages: date this vehicle's inventory record last changed
  for (const v of vehicles) {
    add(buildVDPPath(v), 'weekly', '0.8', inventoryDates.vehicle(v));
  }

  // Add blog posts (canonical www URLs, matching each post's <link rel="canonical">)
  for (const post of posts) {
    add(postUrl(post), 'monthly', '0.7', postLastmod(post));
  }

  const undated = dates.filter((d) => !d).length;
  if (undated) console.warn(`  ${undated} URL(s) have no known change date; <lastmod> omitted`);

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
  // Its lastmod is the newest entry in sitemap-main.xml.
  const indexDay = formatLastmod(latest(dates));
  const indexLastmod = indexDay ? `\n    <lastmod>${indexDay}</lastmod>` : '';
  const sitemapIndex = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap>
    <loc>${SITE_URL}/sitemap-main.xml</loc>${indexLastmod}
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
