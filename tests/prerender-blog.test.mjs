import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const { renderPostPage, BLOG_ORIGIN, GENERATED_MARKER } = require('../prerender-blog');
const { selectPublished } = require('../blog-source');

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const template = fs.readFileSync(path.join(root, 'blog-post.html'), 'utf8');
const fixture = JSON.parse(
  fs.readFileSync(path.join(root, 'tests/fixtures/blog-posts.json'), 'utf8')
);
const quietLog = { warn: () => {} };
const published = selectPublished(fixture, quietLog);
const towing = published.find((p) => p.slug.startsWith('towing-capacity'));
const diesel = published.find((p) => p.slug === 'diesel-vs-gas-trucks');

describe('selectPublished', () => {
  it('keeps only published posts (missing status counts as draft)', () => {
    expect(published.map((p) => p.slug).sort()).toEqual([diesel.slug, towing.slug].sort());
  });

  it('sorts newest first', () => {
    expect(published[0].slug).toBe(towing.slug);
  });

  it('skips unsafe slugs', () => {
    const out = selectPublished(
      [{ slug: '../etc/passwd', title: 't', content: 'c', status: 'published' }],
      quietLog
    );
    expect(out).toEqual([]);
  });
});

describe('renderPostPage', () => {
  const html = renderPostPage(template, towing);

  it('contains the full article body without JS', () => {
    expect(html).toContain('Nested div content survives.');
    expect(html).toContain('<h1 id="postTitle" class="fw-bold mb-2">Towing Capacity Explained');
    expect(html).not.toContain('Loading article...');
    expect(html).not.toContain('Post not found');
    expect(html).not.toMatch(/<article id="article"[^>]*display:none/);
  });

  it('self-canonicalizes to its own www URL', () => {
    const url = `${BLOG_ORIGIN}/blog/${towing.slug}`;
    expect(html).toContain(`<link rel="canonical" id="canonicalLink" href="${url}" />`);
    expect(html).toContain(`<meta property="og:url" id="ogUrl" content="${url}" />`);
    expect(html.match(/rel="canonical"/g)).toHaveLength(1);
  });

  it('marks the page as prerendered for blog-post.js', () => {
    expect(html).toContain(`data-prerendered="true" data-slug="${towing.slug}"`);
    expect(html).toContain(GENERATED_MARKER);
  });

  it('escapes post fields in markup', () => {
    const out = renderPostPage(template, diesel);
    expect(out).toContain('Diesel vs. Gas Trucks: &quot;Which&quot; Is Right for &lt;You&gt;?');
    expect(out).not.toContain('<You>');
    expect(out).not.toContain('id="postHero"'); // no featured image -> no empty hero
  });
});
