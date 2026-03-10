const { getStore } = require('@netlify/blobs');
const mammoth = require('mammoth');

function blobStore(name) {
  const siteID = process.env.SITE_ID;
  const token = process.env.NF_API_TOKEN;
  if (!siteID || !token) {
    throw new Error('Blob config missing');
  }
  return getStore({ name, siteID, token, apiURL: 'https://api.netlify.com' });
}

const POSTS_STORE = 'blog-posts';

const BASE_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
};

function json(statusCode, data) {
  return {
    statusCode,
    headers: { ...BASE_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  };
}

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);
}

function stripHtml(html) {
  return String(html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function generateId(prefix = '') {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Parse filename to extract title and optional category.
 * Supports: "[Category] My Blog Title.docx" or "My Blog Title.docx"
 */
function parseFilename(filename) {
  const name = String(filename || '')
    .replace(/\.docx$/i, '')
    .trim();

  const catMatch = name.match(/^\[([^\]]+)\]\s*(.+)$/);
  if (catMatch) {
    return { category: catMatch[1].trim(), title: catMatch[2].trim() };
  }
  return { category: 'General', title: name || 'Untitled Post' };
}

/**
 * Extract the first H1/H2 from HTML to use as title (if available).
 */
function extractTitleFromHtml(html) {
  const match = html.match(/<h[12][^>]*>(.*?)<\/h[12]>/i);
  if (match) {
    return stripHtml(match[1]);
  }
  return null;
}

/**
 * Remove the first heading from HTML content if it was used as the title.
 */
function removeFirstHeading(html) {
  return html.replace(/<h[12][^>]*>.*?<\/h[12]>/i, '').trim();
}

async function maybeTriggerDeploy(reason, payload = {}) {
  const hook = process.env.BLOG_DEPLOY_HOOK_URL;
  if (!hook) return;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    await fetch(hook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason, source: 'blog-docx-import', ...payload }),
      signal: controller.signal,
    });
    clearTimeout(timer);
  } catch (_) {
    // silent
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: BASE_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  // API key auth
  const apiKey = process.env.BLOG_IMPORT_API_KEY;
  if (!apiKey) {
    return json(500, { error: 'BLOG_IMPORT_API_KEY not configured' });
  }

  const providedKey =
    event.headers['x-api-key'] ||
    event.headers['X-API-Key'] ||
    event.headers['X-Api-Key'] || '';
  if (providedKey !== apiKey) {
    return json(401, { error: 'Invalid API key' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Invalid JSON body' });
  }

  const fileBase64 = body.file;
  const filename = String(body.filename || 'Untitled.docx');
  const statusOverride = String(body.status || 'draft').toLowerCase();
  const categoryOverride = String(body.category || '').trim();
  const authorOverride = String(body.author || '').trim();

  if (!fileBase64) {
    return json(400, { error: 'file (base64 .docx) is required' });
  }

  // Convert .docx to HTML
  const buffer = Buffer.from(fileBase64, 'base64');
  let result;
  try {
    result = await mammoth.convertToHtml({ buffer });
  } catch (err) {
    return json(400, { error: 'Failed to convert .docx: ' + err.message });
  }

  let html = result.value || '';
  if (!html.trim()) {
    return json(400, { error: 'Document is empty' });
  }

  // Determine title: from HTML heading, then from filename
  const { category: fileCategory, title: fileTitle } = parseFilename(filename);
  const htmlTitle = extractTitleFromHtml(html);

  let title;
  if (htmlTitle) {
    title = htmlTitle;
    html = removeFirstHeading(html);
  } else {
    title = fileTitle;
  }

  const category = categoryOverride || fileCategory;
  const author = authorOverride || 'Bells Fork Team';
  const status = statusOverride === 'published' ? 'published' : 'draft';
  const slug = slugify(title);

  if (!slug) {
    return json(400, { error: 'Could not generate slug from title' });
  }

  const postStore = blobStore(POSTS_STORE);
  const existing = await postStore.get(slug, { type: 'json' }).catch(() => null);
  const now = new Date().toISOString();

  const post = {
    id: existing?.id || generateId('p_'),
    slug,
    title,
    author,
    category,
    tags: [],
    featuredImage: '',
    metaDescription: '',
    excerpt: `${stripHtml(html).slice(0, 210)}...`,
    content: html,
    status,
    publishedAt: status === 'published' ? (existing?.publishedAt || now) : null,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    lastEditedBy: 'Google Drive Import',
  };

  await postStore.set(slug, JSON.stringify(post));

  if (status === 'published') {
    await maybeTriggerDeploy('blog-docx-import', { slug, title });
  }

  return json(200, {
    success: true,
    slug: post.slug,
    title: post.title,
    status: post.status,
    url: status === 'published' ? `/blog/${post.slug}` : null,
    adminUrl: `/admin/blog`,
    message: status === 'published'
      ? `Post "${title}" published at /blog/${slug}`
      : `Post "${title}" saved as draft. Review at /admin/blog`,
    warnings: result.messages?.length ? result.messages.map((m) => m.message) : [],
  });
};
