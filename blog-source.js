// blog-source.js — Load published blog posts for build scripts (prerender-blog.js, generate-sitemap.js)
//
// Source of truth is the `blog-posts` Netlify Blobs store written by netlify/functions/blog.js
// (key = slug, value = JSON post). Resolution order:
//   1. BLOG_POSTS_FILE=<path>  — JSON array of posts (local testing / fixtures)
//   2. Netlify Blobs           — NETLIFY_BLOBS_CONTEXT (Netlify build) or SITE_ID + NF_API_TOKEN
//   3. Neither, outside Netlify — returns null so local builds still pass (blog output skipped)
//   Neither, on a Netlify build — throws. A production deploy must never ship without its posts.
//
// SKIP_BLOG_PRERENDER=1 is an explicit, logged escape hatch (e.g. Blobs outage blocking an
// inventory deploy). It is never the default.

const fs = require('fs');
const path = require('path');

const POSTS_STORE = 'blog-posts';

// Matches the slugify() output in netlify/functions/blog.js; also keeps slugs safe as file names.
const SAFE_SLUG_RE = /^[a-z0-9_][a-z0-9_-]*$/;

function hasBlobCredentials() {
  return Boolean(
    process.env.NETLIFY_BLOBS_CONTEXT || (process.env.SITE_ID && process.env.NF_API_TOKEN)
  );
}

async function readAllFromBlobs() {
  const { blobStore } = require('./netlify/lib/blobStore');
  const store = blobStore(POSTS_STORE);
  const { blobs } = await store.list();
  const posts = [];
  for (const blob of blobs) {
    if (blob.key.startsWith('_')) continue;
    let post;
    try {
      post = await store.get(blob.key, { type: 'json' });
    } catch (err) {
      throw new Error(`Failed to read blog post blob "${blob.key}": ${err.message}`);
    }
    if (post) posts.push(post);
  }
  return posts;
}

function readAllFromFile(file) {
  const raw = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  const posts = Array.isArray(raw) ? raw : raw && raw.posts;
  if (!Array.isArray(posts)) throw new Error(`${file} must contain a JSON array of posts`);
  return posts;
}

/** Keep only published, renderable posts; dedupe by slug; newest first. */
function selectPublished(posts, log = console) {
  const bySlug = new Map();
  for (const p of posts) {
    if (!p || typeof p !== 'object') continue;
    if ((p.status || 'draft') !== 'published') continue;
    const slug = String(p.slug || '').trim();
    if (!SAFE_SLUG_RE.test(slug)) {
      log.warn(`[blog] Skipping published post with unsafe slug: ${JSON.stringify(p.slug)}`);
      continue;
    }
    if (!String(p.title || '').trim() || !String(p.content || '').trim()) {
      log.warn(`[blog] Skipping published post "${slug}": missing title or content`);
      continue;
    }
    const prev = bySlug.get(slug);
    if (!prev || new Date(p.updatedAt || 0) > new Date(prev.updatedAt || 0)) {
      bySlug.set(slug, { ...p, slug });
    }
  }
  return [...bySlug.values()].sort(
    (a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0)
  );
}

/**
 * @returns {Promise<Array<object>|null>} published posts, or null when no source is configured
 *   (local build only). Throws on any fetch failure.
 */
async function loadPublishedBlogPosts(log = console) {
  if (process.env.SKIP_BLOG_PRERENDER === '1') {
    log.warn(
      '[blog] WARNING: SKIP_BLOG_PRERENDER=1 — blog posts will NOT be prerendered or listed'
    );
    return null;
  }

  let all;
  if (process.env.BLOG_POSTS_FILE) {
    all = readAllFromFile(process.env.BLOG_POSTS_FILE);
  } else if (hasBlobCredentials()) {
    all = await readAllFromBlobs();
  } else if (process.env.NETLIFY === 'true') {
    throw new Error(
      '[blog] Cannot read the blog-posts Blobs store during the Netlify build: ' +
        'NETLIFY_BLOBS_CONTEXT is absent and SITE_ID/NF_API_TOKEN are not both set. ' +
        'Expose NF_API_TOKEN to the build scope (or set SKIP_BLOG_PRERENDER=1 to deploy without the blog).'
    );
  } else {
    log.warn(
      '[blog] No blog source configured (set BLOG_POSTS_FILE, or SITE_ID + NF_API_TOKEN) — skipping blog output'
    );
    return null;
  }

  return selectPublished(all, log);
}

module.exports = { loadPublishedBlogPosts, selectPublished, SAFE_SLUG_RE };
