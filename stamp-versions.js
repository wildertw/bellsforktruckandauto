#!/usr/bin/env node
// stamp-versions.js — Append ?v=<buildHash> to local CSS/JS asset references in HTML files
// Run as the LAST step of the build pipeline, after all HTML is generated/prerendered.
// This ensures browsers fetch fresh assets after every deploy.

const fs = require('fs');
const path = require('path');
const { ASSET_VERSION } = require('./build-utils');

// ── Files to process ──

// Static HTML files in root
const STATIC_HTML = [
  'index.html',
  'about.html',
  'inventory.html',
  'contact.html',
  'financing.html',
  'reviews.html',
  'blog.html',
  'blog-post.html',
  'privacy.html',
  '404.html',
  'admin-dashboard.html',
];

// Subdirectories with generated index.html
const GENERATED_DIRS = [
  'schedule-test-drive',
  'trade-in-value',
];

// ── Asset path patterns that should be versioned ──
// Matches href="..." or src="..." containing local asset paths (starting with /)
// Excludes external URLs (http/https), data: URIs, and sw.js (service worker)
const ASSET_RE = /(<(?:link|script)[^>]*(?:href|src)\s*=\s*")(\/(assets\/|style\.min\.css|inventory-loader\.js|vehicle-manager\.js|color-lookup\.js)[^"]*?)(")/g;

function stampFile(filePath) {
  if (!fs.existsSync(filePath)) return false;
  const original = fs.readFileSync(filePath, 'utf8');

  const stamped = original.replace(ASSET_RE, (match, prefix, assetPath, _group, suffix) => {
    // Strip any existing version query param so we always stamp the current build version
    const cleanPath = assetPath.replace(/[?&]v=[^&"]*/, '');
    const sep = cleanPath.includes('?') ? '&' : '?';
    return `${prefix}${cleanPath}${sep}v=${ASSET_VERSION}${suffix}`;
  });

  if (stamped !== original) {
    fs.writeFileSync(filePath, stamped, 'utf8');
    return true;
  }
  return false;
}

// Also stamp the service worker cache name
const swPath = path.join(__dirname, 'sw.js');
if (fs.existsSync(swPath)) {
  const swContent = fs.readFileSync(swPath, 'utf8');
  // Replace either the placeholder or any previous version stamp
  const swUpdated = swContent.replace(/bfat-v[a-z0-9]+|__SW_VERSION__/g, `bfat-v${ASSET_VERSION}`);
  if (swUpdated !== swContent) {
    fs.writeFileSync(swPath, swUpdated, 'utf8');
    console.log(`[stamp-versions] Updated sw.js CACHE_NAME to bfat-v${ASSET_VERSION}`);
  }
}

let count = 0;

// Stamp root static HTML
for (const file of STATIC_HTML) {
  if (stampFile(path.join(__dirname, file))) count++;
}

// Stamp generated subdirectory pages
for (const dir of GENERATED_DIRS) {
  const idx = path.join(__dirname, dir, 'index.html');
  if (stampFile(idx)) count++;
}

console.log(`[stamp-versions] Versioned ${count} file(s) with v=${ASSET_VERSION}`);
