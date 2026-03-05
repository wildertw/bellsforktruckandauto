const { getStore } = require('@netlify/blobs');
const crypto = require('crypto');

// V1 function blob config — required for legacy exports.handler functions
function blobStore(nameOrOpts) {
  const siteID = process.env.SITE_ID;
  const token = process.env.NF_API_TOKEN;
  if (!siteID || !token) {
    throw new Error('Blob config missing: SITE_ID=' + (siteID ? 'set' : 'UNSET') + ', NETLIFY_API_TOKEN=' + (token ? 'set' : 'UNSET'));
  }
  const cfg = { siteID, token, apiURL: 'https://api.netlify.com' };
  if (typeof nameOrOpts === 'string') return getStore({ name: nameOrOpts, ...cfg });
  return getStore({ ...nameOrOpts, ...cfg });
}

const POSTS_STORE = 'blog-posts';
const COMMENTS_STORE = 'blog-comments';
const IMAGES_STORE = 'blog-images';

const BASE_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(statusCode, data, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      ...BASE_HEADERS,
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
    body: JSON.stringify(data),
  };
}

function b64urlDecode(str) {
  let s = String(str || '').replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64');
}

function verifyJWT(token) {
  const secret = process.env.BLOG_JWT_SECRET;
  if (!secret) throw new Error('BLOG_JWT_SECRET is not configured');
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('Invalid token');

  const [headerB64, payloadB64, sig] = parts;
  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

  const providedSig = Buffer.from(sig);
  const expectedSigBuf = Buffer.from(expectedSig);
  if (providedSig.length !== expectedSigBuf.length || !crypto.timingSafeEqual(providedSig, expectedSigBuf)) {
    throw new Error('Invalid token signature');
  }

  const payload = JSON.parse(b64urlDecode(payloadB64).toString('utf8'));
  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp < now) throw new Error('Token expired');
  return payload;
}

function getTokenFromHeaders(headers) {
  const authHeader = headers.authorization || headers.Authorization || '';
  return authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
}

function requireAdmin(event) {
  const token = getTokenFromHeaders(event.headers || {});
  if (!token) throw new Error('Authentication required');
  return verifyJWT(token);
}

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);
}

function sanitizeTagList(tags) {
  if (!Array.isArray(tags)) return [];
  const seen = new Set();
  const out = [];
  for (const t of tags) {
    const clean = String(t || '').trim();
    if (!clean) continue;
    const lowered = clean.toLowerCase();
    if (seen.has(lowered)) continue;
    seen.add(lowered);
    out.push(clean);
  }
  return out.slice(0, 20);
}

function stripHtml(html) {
  return String(html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function generateId(prefix = '') {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function getImageExtension(contentType, fallback = 'jpg') {
  const t = String(contentType || '').toLowerCase();
  if (t.includes('png')) return 'png';
  if (t.includes('webp')) return 'webp';
  if (t.includes('gif')) return 'gif';
  if (t.includes('jpeg') || t.includes('jpg')) return 'jpg';
  return fallback;
}

function postMeta(post) {
  return {
    id: post.id,
    slug: post.slug,
    title: post.title,
    excerpt: post.excerpt,
    featuredImage: post.featuredImage || '',
    author: post.author || 'Bells Fork Team',
    category: post.category || 'General',
    tags: post.tags || [],
    status: post.status || 'draft',
    publishedAt: post.publishedAt || null,
    updatedAt: post.updatedAt || null,
    createdAt: post.createdAt || null,
  };
}

async function getAllPosts(store) {
  const { blobs } = await store.list();
  const posts = [];
  for (const blob of blobs) {
    if (blob.key.startsWith('_')) continue;
    try {
      const post = await store.get(blob.key, { type: 'json' });
      if (post) posts.push(post);
    } catch (_) {
      // skip invalid entries
    }
  }
  return posts;
}

async function getCommentsForSlug(commentStore, slug, includeUnapproved = false) {
  const prefix = `${slug}__`;
  const { blobs } = await commentStore.list({ prefix });
  const comments = [];
  for (const blob of blobs) {
    try {
      const c = await commentStore.get(blob.key, { type: 'json' });
      if (!c) continue;
      if (!includeUnapproved && c.status !== 'approved') continue;
      comments.push(c);
    } catch (_) {
      // skip invalid entries
    }
  }
  comments.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
  return comments;
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
      body: JSON.stringify({ reason, source: 'blog-function', ...payload }),
      signal: controller.signal,
    });
    clearTimeout(timer);
  } catch (_) {
    // Do not fail content write if deployment hook fails.
  }
}

async function parseBody(event) {
  try {
    return JSON.parse(event.body || '{}');
  } catch {
    throw new Error('Invalid JSON body');
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: BASE_HEADERS, body: '' };
  }

  const params = event.queryStringParameters || {};
  const action = params.action || 'list';

  const postStore = blobStore(POSTS_STORE);
  const commentStore = blobStore(COMMENTS_STORE);
  const imageStore = blobStore(IMAGES_STORE);

  // Public image serving endpoint
  if (event.httpMethod === 'GET' && action === 'image') {
    const id = String(params.id || '').trim();
    if (!id) return json(400, { error: 'id is required' });
    const imageBlob = await imageStore.get(id, { type: 'json' }).catch(() => null);
    if (!imageBlob || !imageBlob.base64 || !imageBlob.contentType) {
      return { statusCode: 404, headers: BASE_HEADERS, body: '' };
    }
    return {
      statusCode: 200,
      isBase64Encoded: true,
      headers: {
        ...BASE_HEADERS,
        'Content-Type': imageBlob.contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
      body: imageBlob.base64,
    };
  }

  if (event.httpMethod === 'GET') {
    // Public listing
    if (action === 'list') {
      const category = String(params.category || '').trim();
      const tag = String(params.tag || '').trim();
      const limit = Number.parseInt(String(params.limit || ''), 10);

      let posts = await getAllPosts(postStore);
      posts = posts.filter((p) => (p.status || 'draft') === 'published');
      if (category) posts = posts.filter((p) => (p.category || 'General') === category);
      if (tag) posts = posts.filter((p) => (p.tags || []).includes(tag));
      posts.sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));
      if (Number.isFinite(limit) && limit > 0) posts = posts.slice(0, limit);
      return json(200, posts.map(postMeta), {
        'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=600',
      });
    }

    if (action === 'post') {
      const slug = String(params.slug || '').trim();
      if (!slug) return json(400, { error: 'slug is required' });
      const post = await postStore.get(slug, { type: 'json' }).catch(() => null);
      if (!post || (post.status || 'draft') !== 'published') return json(404, { error: 'Post not found' });
      return json(200, post, {
        'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=600',
      });
    }

    if (action === 'categories') {
      const all = await getAllPosts(postStore);
      const categories = [...new Set(all.filter((p) => (p.status || 'draft') === 'published').map((p) => p.category || 'General'))].sort();
      return json(200, categories, { 'Cache-Control': 'public, max-age=600, s-maxage=1800' });
    }

    if (action === 'comments') {
      const slug = String(params.slug || '').trim();
      if (!slug) return json(400, { error: 'slug is required' });
      const comments = await getCommentsForSlug(commentStore, slug, false);
      const safe = comments.map((c) => ({
        id: c.id,
        name: c.name,
        content: c.content,
        createdAt: c.createdAt,
      }));
      return json(200, safe);
    }

    // Admin read endpoints
    if (action === 'admin-list' || action === 'admin-get' || action === 'admin-comments') {
      try {
        requireAdmin(event);
      } catch (err) {
        return json(401, { error: err.message });
      }

      if (action === 'admin-get') {
        const slug = String(params.slug || '').trim();
        if (!slug) return json(400, { error: 'slug is required' });
        const post = await postStore.get(slug, { type: 'json' }).catch(() => null);
        if (!post) return json(404, { error: 'Post not found' });
        return json(200, post);
      }

      if (action === 'admin-comments') {
        const slug = String(params.slug || '').trim();
        let comments = [];
        if (slug) {
          comments = await getCommentsForSlug(commentStore, slug, true);
        } else {
          const { blobs } = await commentStore.list();
          for (const blob of blobs) {
            try {
              const c = await commentStore.get(blob.key, { type: 'json' });
              if (c) comments.push(c);
            } catch (_) {
              // skip invalid entries
            }
          }
        }
        comments.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
        return json(200, comments);
      }

      // admin-list
      const all = await getAllPosts(postStore);
      all.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
      return json(200, all.map(postMeta));
    }

    return json(400, { error: 'Unknown action' });
  }

  if (event.httpMethod === 'POST') {
    // Public comment submission
    if (action === 'comment') {
      let body;
      try {
        body = await parseBody(event);
      } catch (err) {
        return json(400, { error: err.message });
      }

      const slug = String(body.slug || '').trim();
      const name = String(body.name || '').trim();
      const content = String(body.content || '').trim();
      const hp = String(body.website || '').trim(); // honeypot

      if (hp) return json(200, { success: true });
      if (!slug || !name || !content) return json(400, { error: 'slug, name, and content are required' });
      if (name.length > 80) return json(400, { error: 'Name is too long' });
      if (content.length < 3 || content.length > 1200) return json(400, { error: 'Comment must be 3-1200 characters' });

      const post = await postStore.get(slug, { type: 'json' }).catch(() => null);
      if (!post || (post.status || 'draft') !== 'published') return json(404, { error: 'Post not found' });

      const moderationMode = String(process.env.BLOG_COMMENT_MODERATION || 'auto').toLowerCase();
      const status = moderationMode === 'manual' ? 'pending' : 'approved';
      const now = new Date().toISOString();
      const comment = {
        id: generateId('c_'),
        slug,
        name,
        content,
        status,
        createdAt: now,
      };
      await commentStore.set(`${slug}__${comment.id}`, JSON.stringify(comment));
      return json(200, {
        success: true,
        status,
        message: status === 'approved'
          ? 'Comment posted.'
          : 'Comment submitted for moderation.',
      });
    }

    let admin;
    try {
      admin = requireAdmin(event);
    } catch (err) {
      return json(401, { error: err.message });
    }

    // Admin image upload
    if (action === 'upload-image') {
      let body;
      try {
        body = await parseBody(event);
      } catch (err) {
        return json(400, { error: err.message });
      }
      const dataUrl = String(body.dataUrl || '');
      const filename = String(body.filename || 'blog-image');
      const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
      if (!match) return json(400, { error: 'Invalid image payload' });
      const contentType = match[1].toLowerCase();
      const base64Data = match[2];
      const bytes = Buffer.byteLength(base64Data, 'base64');
      if (bytes > 6 * 1024 * 1024) return json(400, { error: 'Image exceeds 6MB limit' });

      const ext = getImageExtension(contentType);
      const safeName = slugify(filename.replace(/\.[a-z0-9]+$/i, '')) || 'image';
      const id = `${Date.now()}-${safeName}.${ext}`;

      await imageStore.set(id, JSON.stringify({ contentType, base64: base64Data }));
      return json(200, {
        id,
        url: `/.netlify/functions/blog?action=image&id=${encodeURIComponent(id)}`,
      });
    }

    // Admin comment moderation
    if (action === 'comment-moderate') {
      let body;
      try {
        body = await parseBody(event);
      } catch (err) {
        return json(400, { error: err.message });
      }
      const slug = String(body.slug || '').trim();
      const id = String(body.id || '').trim();
      const status = String(body.status || '').toLowerCase();
      if (!slug || !id) return json(400, { error: 'slug and id are required' });

      if (status === 'deleted') {
        await commentStore.delete(`${slug}__${id}`);
        return json(200, { success: true });
      }
      if (!['approved', 'pending'].includes(status)) {
        return json(400, { error: 'Invalid status' });
      }
      const key = `${slug}__${id}`;
      const existing = await commentStore.get(key, { type: 'json' }).catch(() => null);
      if (!existing) return json(404, { error: 'Comment not found' });
      existing.status = status;
      existing.moderatedAt = new Date().toISOString();
      existing.moderatedBy = admin.user || admin.sub || 'Admin';
      await commentStore.set(key, JSON.stringify(existing));
      return json(200, { success: true, comment: existing });
    }

    // Admin create/update post
    let body;
    try {
      body = await parseBody(event);
    } catch (err) {
      return json(400, { error: err.message });
    }

    const title = String(body.title || '').trim();
    const content = String(body.content || '').trim();
    const status = String(body.status || 'draft').toLowerCase() === 'published' ? 'published' : 'draft';
    const explicitSlug = String(body.slug || '').trim();
    if (!title) return json(400, { error: 'Title is required' });
    if (!content) return json(400, { error: 'Content is required' });

    const slug = slugify(explicitSlug || title);
    if (!slug) return json(400, { error: 'Unable to build slug from title' });

    const existing = await postStore.get(slug, { type: 'json' }).catch(() => null);
    const now = new Date().toISOString();
    const post = {
      id: existing?.id || generateId('p_'),
      slug,
      title,
      author: String(body.author || '').trim() || existing?.author || admin.user || 'Bells Fork Team',
      category: String(body.category || '').trim() || 'General',
      tags: sanitizeTagList(body.tags),
      featuredImage: String(body.featuredImage || '').trim(),
      metaDescription: String(body.metaDescription || '').trim().slice(0, 320),
      excerpt: String(body.excerpt || '').trim() || `${stripHtml(content).slice(0, 210)}...`,
      content,
      status,
      publishedAt: status === 'published'
        ? (existing?.publishedAt || String(body.publishedAt || '').trim() || now)
        : null,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      lastEditedBy: admin.user || admin.sub || 'Admin',
    };

    await postStore.set(slug, JSON.stringify(post));
    if (status === 'published') {
      await maybeTriggerDeploy('blog-published', { slug, title });
    }
    return json(200, post);
  }

  if (event.httpMethod === 'DELETE') {
    let admin;
    try {
      admin = requireAdmin(event);
    } catch (err) {
      return json(401, { error: err.message });
    }

    const slug = String(params.slug || '').trim();
    if (!slug) return json(400, { error: 'slug is required' });
    const existing = await postStore.get(slug, { type: 'json' }).catch(() => null);
    if (!existing) return json(404, { error: 'Post not found' });

    await postStore.delete(slug);
    await maybeTriggerDeploy('blog-deleted', { slug, by: admin.user || admin.sub || 'Admin' });
    return json(200, { success: true, slug });
  }

  return json(405, { error: 'Method not allowed' });
};
