# Dynamic Blog System (Netlify)

This implementation uses:

- Netlify Functions (`netlify/functions/blog.js`, `netlify/functions/blog-auth.js`)
- Netlify Blobs as the content store (posts, comments, images)
- A browser admin CMS at `/admin/blog` (`blog-admin.html`)
- A dynamic post page with SEO URL rewrites (`/blog/:slug`)

## What is included

1. Public blog list page: `blog.html`
1. Public post page: `blog-post.html` + `assets/js/blog-post.js`
1. Admin CMS page: `blog-admin.html` + `assets/js/blog-admin.js`
1. Backend API:
`/.netlify/functions/blog`
`/.netlify/functions/blog-auth`
1. Netlify rewrites in `netlify.toml`:
`/blog/:slug -> /blog-post.html?slug=:slug`
`/admin/blog -> /blog-admin.html`

## Environment variables (Netlify)

Set these in Netlify Site Settings -> Environment Variables.

Required:

- `BLOG_JWT_SECRET`
  Use a long random string (at least 64 chars).
- `BLOG_ADMIN_USERS`
  JSON map of username to SHA-256 password hash.
  Example:
  `{"trey":"<sha256hex>","manager":"<sha256hex>"}`

Optional:

- `BLOG_COMMENT_MODERATION`
  `auto` (default) or `manual`.
- `BLOG_DEPLOY_HOOK_URL`
  Netlify Build Hook URL. If set, publish/delete operations trigger a deploy hook call.

## Creating admin password hashes

Use this in browser devtools console:

```js
async function h(v){const b=new TextEncoder().encode(v);const d=await crypto.subtle.digest('SHA-256',b);console.log(Array.from(new Uint8Array(d)).map(x=>x.toString(16).padStart(2,'0')).join(''));} h('your-password-here');
```

Copy output into `BLOG_ADMIN_USERS`.

## API summary

Public:

- `GET /.netlify/functions/blog?action=list`
- `GET /.netlify/functions/blog?action=post&slug=...`
- `GET /.netlify/functions/blog?action=categories`
- `GET /.netlify/functions/blog?action=comments&slug=...`
- `POST /.netlify/functions/blog?action=comment`
- `GET /.netlify/functions/blog?action=image&id=...`

Admin (Bearer token from `blog-auth`):

- `GET action=admin-list`
- `GET action=admin-get&slug=...`
- `POST /.netlify/functions/blog` (create/update post)
- `DELETE /.netlify/functions/blog?slug=...`
- `POST action=upload-image`
- `GET action=admin-comments`
- `POST action=comment-moderate`

## Editor workflow (for content team)

1. Open `/admin/blog`.
1. Sign in with your blog admin username/password.
1. Click `New Post`.
1. Enter title, category, tags, meta description, status.
1. Write content in the rich text editor.
1. Upload a featured image (or paste image URL).
1. Click `Preview`.
1. Click `Save Post`.
1. If status is `published`, post appears at `/blog/<slug>`.

## Comment moderation

- Open `Comments` table in the admin page.
- Approve or delete user comments.
- If `BLOG_COMMENT_MODERATION=manual`, new comments start as `pending`.

## SEO behavior

- Public list links to SEO path: `/blog/<slug>`
- Netlify rewrite resolves the page without needing local file generation
- Post page updates title/meta/canonical/OG tags client-side from CMS content

## Performance notes

- Public list/post responses include short cache headers
- Images are stored in Blobs and served by the blog function with long-lived cache headers
- Featured images lazy-load where appropriate

