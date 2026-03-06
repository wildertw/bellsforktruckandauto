(() => {
  const API = '/.netlify/functions/blog';

  const qs = new URLSearchParams(window.location.search);
  const slugFromQuery = (qs.get('slug') || '').trim();
  const slugFromPath = (() => {
    const m = window.location.pathname.match(/^\/blog\/([^/?#]+)/i);
    return m ? decodeURIComponent(m[1]) : '';
  })();
  const slug = slugFromPath || slugFromQuery;

  const yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  const loadingState = document.getElementById('loadingState');
  const articleEl = document.getElementById('article');
  const errorEl = document.getElementById('errorState');

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  }

  function setMeta(id, value) {
    const el = document.getElementById(id);
    if (el) el.setAttribute('content', value);
  }

  async function getPost() {
    const res = await fetch(`${API}?action=post&slug=${encodeURIComponent(slug)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function getComments() {
    const res = await fetch(`${API}?action=comments&slug=${encodeURIComponent(slug)}`);
    if (!res.ok) throw new Error('Comments failed');
    return res.json();
  }

  function buildCommentCard(c) {
    return `
      <article class="comment-card p-3">
        <div class="d-flex align-items-center justify-content-between mb-1">
          <strong>${escapeHtml(c.name)}</strong>
          <span class="comment-meta">${formatDate(c.createdAt)}</span>
        </div>
        <div style="white-space:pre-wrap;">${escapeHtml(c.content)}</div>
      </article>
    `;
  }

  function bindShare(post) {
    const url = window.location.origin + `/blog/${post.slug}`;
    const text = `${post.title} | Bells Fork Auto & Truck`;

    document.getElementById('shareFacebook').href = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`;
    document.getElementById('shareX').href = `https://x.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
    document.getElementById('shareEmail').href = `mailto:?subject=${encodeURIComponent(text)}&body=${encodeURIComponent(url)}`;

    document.getElementById('copyLinkBtn').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(url);
        document.getElementById('copyLinkBtn').textContent = 'Copied';
      } catch (_) {
        document.getElementById('copyLinkBtn').textContent = 'Copy failed';
      }
      setTimeout(() => { document.getElementById('copyLinkBtn').textContent = 'Copy Link'; }, 1600);
    });
  }

  async function loadComments() {
    const list = document.getElementById('commentsList');
    list.innerHTML = '<div class="text-muted small">Loading comments...</div>';
    try {
      const comments = await getComments();
      if (!Array.isArray(comments) || !comments.length) {
        list.innerHTML = '<div class="text-muted small">No comments yet.</div>';
        return;
      }
      list.innerHTML = comments.map(buildCommentCard).join('');
    } catch (_) {
      list.innerHTML = '<div class="text-danger small">Unable to load comments right now.</div>';
    }
  }

  function bindCommentForm() {
    const form = document.getElementById('commentForm');
    const statusEl = document.getElementById('commentStatus');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      statusEl.className = 'small text-muted mb-2';
      statusEl.textContent = 'Submitting...';

      const payload = {
        slug,
        name: document.getElementById('commentName').value.trim(),
        content: document.getElementById('commentBody').value.trim(),
        website: document.getElementById('commentWebsite').value.trim(),
      };

      try {
        const res = await fetch(`${API}?action=comment`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not post comment');

        statusEl.className = 'small text-success mb-2';
        statusEl.textContent = data.message || 'Comment submitted.';
        form.reset();
        await loadComments();
      } catch (err) {
        statusEl.className = 'small text-danger mb-2';
        statusEl.textContent = err.message || 'Could not post comment.';
      }
    });
  }

  function applyPostToPage(post) {
    const pageUrl = `${window.location.origin}/blog/${post.slug}`;
    const desc = post.metaDescription || post.excerpt || 'Bells Fork Auto & Truck blog post';
    const title = `${post.title} | Bells Fork Auto & Truck Blog`;
    const image = post.featuredImage || `${window.location.origin}/assets/hero/shop-front-og.jpg`;

    document.title = title;
    document.getElementById('pageTitle').textContent = title;
    document.getElementById('metaDescription').setAttribute('content', desc);
    document.getElementById('canonicalLink').setAttribute('href', pageUrl);
    setMeta('ogTitle', title);
    setMeta('ogDescription', desc);
    setMeta('ogUrl', pageUrl);
    setMeta('ogImage', image);
    setMeta('twTitle', title);
    setMeta('twDescription', desc);
    setMeta('twImage', image);

    const postTitle = document.getElementById('postTitle');
    const postDate = document.getElementById('postDate');
    const postAuthor = document.getElementById('postAuthor');
    const postCategory = document.getElementById('postCategory');
    const content = document.getElementById('postContent');
    const heroWrap = document.getElementById('postHero');
    const heroImg = document.getElementById('postHeroImg');

    postTitle.textContent = post.title || 'Untitled';
    postDate.textContent = formatDate(post.publishedAt || post.updatedAt);
    postAuthor.textContent = post.author || 'Bells Fork Team';
    postCategory.textContent = post.category || 'General';
    content.innerHTML = post.content || '';

    if (post.featuredImage) {
      heroWrap.style.display = '';
      heroImg.src = post.featuredImage;
      heroImg.alt = post.title || 'Featured image';
    } else {
      heroWrap.style.display = 'none';
    }
  }

  async function init() {
    if (!slug) {
      loadingState.style.display = 'none';
      errorEl.style.display = '';
      return;
    }
    try {
      const post = await getPost();
      applyPostToPage(post);
      bindShare(post);
      bindCommentForm();
      await loadComments();
      loadingState.style.display = 'none';
      articleEl.style.display = '';
      errorEl.style.display = 'none';
    } catch (_) {
      loadingState.style.display = 'none';
      articleEl.style.display = 'none';
      errorEl.style.display = '';
    }
  }

  init();
})();

