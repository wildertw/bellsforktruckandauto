import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';

const require = createRequire(import.meta.url);
const { TECOBI_CLIENT_ID, tecobiWidgetTag } = require('../build-utils');

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..');

// The one page that must NOT carry a public lead widget: it is the auth-gated admin UI.
const EXCLUDED = 'admin-dashboard.html';

// Hand-maintained pages. No generator owns these, so they can only be fixed by editing
// them directly — they are listed explicitly so a new one is never silently missed.
// The two pre-qualify-* pages are the easy miss: stamp-versions.js does not touch them either.
const HAND_MAINTAINED = [
  '404.html',
  'about.html',
  'blog-post.html',
  'blog.html',
  'contact.html',
  'financing.html',
  'index.html',
  'inventory.html',
  'pre-qualify-no-score-impact/index.html',
  'pre-qualify-no-ssn-required/index.html',
  'privacy.html',
  'reviews.html',
];

const SKIP_DIRS = new Set(['node_modules', '.netlify', '.git', '.claude', 'finance-pdfs']);

function collectHtml(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      collectHtml(path.join(dir, entry.name), out);
    } else if (entry.name.endsWith('.html')) {
      out.push(path.relative(ROOT, path.join(dir, entry.name)));
    }
  }
  return out;
}

const allPages = collectHtml(ROOT);
const publicPages = allPages.filter((p) => p !== EXCLUDED);
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

describe('tecobiWidgetTag', () => {
  it('uses this dealership’s client ID', () => {
    expect(TECOBI_CLIENT_ID).toBe('2966');
    expect(tecobiWidgetTag()).toBe(
      '<script id="tecobi-widget-include" src="https://widget.tecobi.com/widget.js?clientId=2966"></script>'
    );
  });
});

describe('TECOBI widget coverage', () => {
  it('finds pages to check', () => {
    // Sanity floor: 12 hand-maintained + 9 category + 5 form + VDPs. If the glob breaks,
    // every per-page assertion below would vacuously pass, so fail loudly instead.
    expect(publicPages.length).toBeGreaterThan(25);
  });

  it.each(HAND_MAINTAINED)('%s is present on disk', (page) => {
    expect(fs.existsSync(path.join(ROOT, page))).toBe(true);
    expect(publicPages).toContain(page);
  });

  it.each(publicPages)('%s includes the widget exactly once', (page) => {
    const html = read(page);
    const occurrences = html.split('id="tecobi-widget-include"').length - 1;
    expect(occurrences).toBe(1);
  });

  it.each(publicPages)('%s uses the canonical tag for client 2966', (page) => {
    // This is what stops the hand-written copies from drifting from build-utils.js.
    expect(read(page)).toContain(tecobiWidgetTag());
  });

  it.each(publicPages)('%s puts the widget immediately before </body>', (page) => {
    const html = read(page);
    const idx = html.lastIndexOf('</body>');
    expect(idx).toBeGreaterThan(-1);
    const between = html.slice(idx - 200, idx);
    expect(between.trimEnd().endsWith(tecobiWidgetTag())).toBe(true);
  });

  it(`does not add the widget to ${EXCLUDED}`, () => {
    expect(read(EXCLUDED)).not.toContain('tecobi');
  });
});

describe('TECOBI CTAs', () => {
  it('puts Text Us and Quickly Qualify on the main SRP', () => {
    const html = read('inventory.html');
    expect(html).toContain('tecobi-contact-us-toggle');
    expect(html).toContain('tecobi-quick-qualify-toggle');
  });

  it('puts Text Us and Quickly Qualify on every category SRP', () => {
    const categories = publicPages.filter((p) => /^used-[^/]+-greenville-nc\/index\.html$/.test(p));
    expect(categories.length).toBeGreaterThan(0);
    for (const page of categories) {
      const html = read(page);
      expect(html, page).toContain('tecobi-contact-us-toggle');
      expect(html, page).toContain('tecobi-quick-qualify-toggle');
    }
  });

  it('puts Text Us and Quickly Qualify on every VDP', () => {
    const vdps = publicPages.filter((p) => p.startsWith(`vdp${path.sep}`) || p.startsWith('vdp/'));
    expect(vdps.length).toBeGreaterThan(0);
    for (const page of vdps) {
      const html = read(page);
      expect(html, page).toContain('tecobi-contact-us-toggle');
      expect(html, page).toContain('tecobi-quick-qualify-toggle');
    }
  });

  it('embeds the TECOBI forms on the contact and finance pages', () => {
    expect(read('contact.html')).toContain('data-tecobi-embed="signup"');
    expect(read('financing.html')).toContain('data-tecobi-embed="full-credit-app"');
    // financing/index.html is regex-extracted out of financing.html's tab pane, so the
    // embed must survive that extraction.
    if (fs.existsSync(path.join(ROOT, 'financing/index.html'))) {
      expect(read('financing/index.html')).toContain('data-tecobi-embed="full-credit-app"');
    }
  });

  it('leaves the pre-qualify pages to QualifyWizard', () => {
    for (const page of ['pre-qualify-no-ssn-required/index.html', 'pre-qualify-no-score-impact/index.html']) {
      const html = read(page);
      expect(html, page).toContain('qualifywizard');
      expect(html, page).not.toContain('data-tecobi-embed');
      expect(html, page).not.toContain('tecobi-quick-qualify-toggle');
    }
  });

  it('keeps the mobile action bar on a native sms: link', () => {
    const html = read('inventory.html');
    expect(html).toContain('class="mobile-action sms-limited" href="sms:+12529170551"');
  });

  it('does not leave sms-limiter in control of a converted TECOBI CTA', () => {
    // sms-limiter.js strips the href and sets pointer-events:none after 5 clicks, which
    // would silently kill a TECOBI button.
    const js = fs.readFileSync(path.join(ROOT, 'assets/js/lead-capture.js'), 'utf8');
    for (const line of js.split('\n')) {
      if (line.includes('tecobi-')) expect(line).not.toContain('sms-limited');
    }
  });

  it('gives every converted CTA a legacy fallback href', () => {
    const js = fs.readFileSync(path.join(ROOT, 'assets/js/lead-capture.js'), 'utf8');
    expect(js).toContain('data-tecobi-fallback');
    expect(js).toContain('function tecobiReady');
    // The guard must suppress navigation only — stopPropagation would prevent TECOBI's
    // own click handler from ever opening the form.
    expect(js).not.toMatch(/\.stopPropagation\s*\(/);
  });
});
