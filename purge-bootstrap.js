#!/usr/bin/env node
// purge-bootstrap.js — Remove unused Bootstrap CSS rules
// Scans all HTML + JS files for used classes, purges the rest
// Run AFTER all page generators (vdp, categories, forms, homepage, inventory)

const { PurgeCSS } = require('purgecss');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const BOOTSTRAP_SRC = path.join(ROOT, 'assets', 'vendor', 'bootstrap.min.css');
const BOOTSTRAP_BACKUP = path.join(ROOT, 'assets', 'vendor', 'bootstrap.full.min.css');

async function main() {
  console.log('=== PurgeCSS: Bootstrap ===\n');

  if (!fs.existsSync(BOOTSTRAP_SRC)) {
    console.error('bootstrap.min.css not found!');
    process.exit(1);
  }

  const originalSize = fs.statSync(BOOTSTRAP_SRC).size;
  console.log(`Original: ${(originalSize / 1024).toFixed(1)} KB`);

  // Back up the original (only if backup doesn't exist yet)
  if (!fs.existsSync(BOOTSTRAP_BACKUP)) {
    fs.copyFileSync(BOOTSTRAP_SRC, BOOTSTRAP_BACKUP);
    console.log('Backup saved to bootstrap.full.min.css');
  }

  // Collect all HTML files (exclude node_modules, .netlify)
  const htmlFiles = collectFiles(ROOT, /\.html$/, ['node_modules', '.netlify', '.git', '.claude']);
  console.log(`Scanning ${htmlFiles.length} HTML files`);

  // Collect JS files that build DOM (root-level + assets/js)
  const jsFiles = collectFiles(ROOT, /\.js$/, ['node_modules', '.netlify', '.git', '.claude', 'assets/vendor'])
    .filter(f => {
      const rel = path.relative(ROOT, f);
      // Include root-level JS, assets/js, and netlify/functions
      return !rel.includes(path.sep) ||
             rel.startsWith('assets' + path.sep + 'js') ||
             rel.startsWith('netlify' + path.sep + 'functions');
    });
  console.log(`Scanning ${jsFiles.length} JS files`);

  const result = await new PurgeCSS().purge({
    content: [
      ...htmlFiles.map(f => ({ raw: fs.readFileSync(f, 'utf8'), extension: 'html' })),
      ...jsFiles.map(f => ({ raw: fs.readFileSync(f, 'utf8'), extension: 'js' })),
      // Also scan style.css for Bootstrap class references
      { raw: fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8'), extension: 'css' },
    ],
    css: [{ raw: fs.readFileSync(BOOTSTRAP_BACKUP, 'utf8') }],
    // Safelist Bootstrap's dynamic/JS-toggled classes
    safelist: {
      standard: [
        // Bootstrap JS toggled classes
        'show', 'showing', 'hiding', 'hide',
        'active',
        'fade',
        'collapse', 'collapsing',
        'collapsed',
        'was-validated',
        'is-valid', 'is-invalid',
        'valid-feedback', 'invalid-feedback',
        'valid-tooltip', 'invalid-tooltip',
        'disabled',
        'open',
        'focus',
        'overflow-hidden',
        // Navbar specific
        'navbar-collapse',
      ],
      // Keep any class that starts with these patterns (regex)
      // Only safelist Bootstrap components actually used on the site
      greedy: [
        /^accordion/,   // FAQ section on homepage
        /^spinner/,     // Loading spinner on blog-post.html
        /^visually-hidden/, // Accessibility
      ],
    },
    // Don't remove @font-face, @keyframes, CSS variables
    fontFace: true,
    keyframes: true,
    variables: true,
  });

  if (!result || result.length === 0 || !result[0].css) {
    console.error('PurgeCSS returned no output!');
    process.exit(1);
  }

  const purgedCSS = result[0].css;
  fs.writeFileSync(BOOTSTRAP_SRC, purgedCSS, 'utf8');

  const newSize = Buffer.byteLength(purgedCSS, 'utf8');
  const saved = originalSize - newSize;
  const pct = ((saved / originalSize) * 100).toFixed(1);

  console.log(`\nPurged:   ${(newSize / 1024).toFixed(1)} KB`);
  console.log(`Saved:    ${(saved / 1024).toFixed(1)} KB (${pct}% reduction)`);
  console.log('\nDone! bootstrap.min.css updated in place.');
}

function collectFiles(dir, pattern, excludeDirs) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (excludeDirs.includes(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFiles(fullPath, pattern, excludeDirs));
    } else if (pattern.test(entry.name)) {
      results.push(fullPath);
    }
  }
  return results;
}

main().catch((err) => {
  console.error('PurgeCSS failed:', err);
  process.exit(1);
});
