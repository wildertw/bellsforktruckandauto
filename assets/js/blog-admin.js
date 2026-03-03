(() => {
  const AUTH_API = '/.netlify/functions/blog-auth';
  const BLOG_API = '/.netlify/functions/blog';
  const TOKEN_KEY = 'bf_blog_admin_token';
  const USER_KEY = 'bf_blog_admin_user';

  let editor;
  let currentSlug = '';
  let previewModal;
  let postsCache = [];

  const $ = (id) => document.getElementById(id);

  function slugify(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 90);
  }

  async function sha256(input) {
    const data = new TextEncoder().encode(input);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  function getToken() {
    return sessionStorage.getItem(TOKEN_KEY) || '';
  }

  function setSession(token, user) {
    sessionStorage.setItem(TOKEN_KEY, token);
    sessionStorage.setItem(USER_KEY, user || 'Admin');
  }

  function clearSession() {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
  }

  async function api(url, options = {}, requiresAuth = true) {
    const headers = { ...(options.headers || {}) };
    if (!headers['Content-Type'] && options.body) headers['Content-Type'] = 'application/json';
    if (requiresAuth) {
      const token = getToken();
      if (!token) throw new Error('No admin session');
      headers.Authorization = `Bearer ${token}`;
    }
    const res = await fetch(url, { ...options, headers });
    const text = await res.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch (_) { data = {}; }
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  function setLoginState(isLoggedIn) {
    $('loginPanel').classList.toggle('d-none', isLoggedIn);
    $('adminPanel').classList.toggle('d-none', !isLoggedIn);
    $('sessionBar').classList.toggle('d-none', !isLoggedIn);
    if (isLoggedIn) {
      const user = sessionStorage.getItem(USER_KEY) || 'Admin';
      $('sessionUser').textContent = `Signed in as ${user}`;
    }
  }

  function formToPayload() {
    const title = $('postTitleInput').value.trim();
    const slugInput = $('postSlugInput').value.trim();
    const category = $('postCategoryInput').value.trim();
    const tags = $('postTagsInput').value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return {
      slug: slugify(slugInput || title),
      title,
      author: $('postAuthorInput').value.trim(),
      category: category || 'General',
      status: $('postStatusInput').value,
      tags,
      metaDescription: $('postMetaInput').value.trim(),
      excerpt: $('postExcerptInput').value.trim(),
      featuredImage: $('postImageInput').value.trim(),
      content: editor.root.innerHTML,
    };
  }

  function resetForm() {
    currentSlug = '';
    $('postForm').reset();
    $('postSlugInput').value = '';
    $('postStatusInput').value = 'draft';
    $('postImagePreview').style.display = 'none';
    $('postImagePreview').src = '';
    editor.root.innerHTML = '';
    $('formStatus').textContent = '';
  }

  function applyPostToForm(post) {
    currentSlug = post.slug || '';
    $('postTitleInput').value = post.title || '';
    $('postSlugInput').value = post.slug || '';
    $('postAuthorInput').value = post.author || '';
    $('postCategoryInput').value = post.category || 'General';
    $('postStatusInput').value = post.status || 'draft';
    $('postTagsInput').value = (post.tags || []).join(', ');
    $('postMetaInput').value = post.metaDescription || '';
    $('postExcerptInput').value = post.excerpt || '';
    $('postImageInput').value = post.featuredImage || '';
    editor.root.innerHTML = post.content || '';
    if (post.featuredImage) {
      $('postImagePreview').src = post.featuredImage;
      $('postImagePreview').style.display = '';
    } else {
      $('postImagePreview').style.display = 'none';
      $('postImagePreview').src = '';
    }
  }

  function renderPostTable(posts) {
    const tbody = $('postTableBody');
    if (!posts.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-muted text-center py-3">No posts yet.</td></tr>';
      return;
    }
    tbody.innerHTML = posts.map((p) => `
      <tr class="post-row">
        <td>
          <div class="fw-semibold">${p.title || '(Untitled)'}</div>
          <div class="small text-muted mono">/${p.slug}</div>
        </td>
        <td><span class="badge ${p.status === 'published' ? 'bg-success' : 'bg-secondary'}">${p.status || 'draft'}</span></td>
        <td>${p.category || 'General'}</td>
        <td class="small text-muted">${p.updatedAt ? new Date(p.updatedAt).toLocaleString() : '-'}</td>
        <td>
          <button class="btn btn-sm btn-outline-primary me-1" data-action="edit" data-slug="${p.slug}">Edit</button>
          <a class="btn btn-sm btn-outline-dark" href="/blog/${p.slug}" target="_blank" rel="noopener">View</a>
        </td>
      </tr>
    `).join('');

    tbody.querySelectorAll('button[data-action="edit"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const slug = btn.getAttribute('data-slug');
        const post = await api(`${BLOG_API}?action=admin-get&slug=${encodeURIComponent(slug)}`);
        applyPostToForm(post);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });
  }

  function renderCommentsTable(comments) {
    const tbody = $('commentTableBody');
    if (!comments.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-muted text-center py-3">No comments yet.</td></tr>';
      return;
    }
    tbody.innerHTML = comments.map((c) => `
      <tr>
        <td><a href="/blog/${c.slug}" target="_blank" rel="noopener" class="mono text-decoration-none">${c.slug}</a></td>
        <td>${c.name}</td>
        <td style="max-width:340px;white-space:normal;">${String(c.content || '').slice(0, 180)}</td>
        <td><span class="badge ${c.status === 'approved' ? 'bg-success' : 'bg-warning text-dark'}">${c.status}</span></td>
        <td class="small text-muted">${c.createdAt ? new Date(c.createdAt).toLocaleString() : '-'}</td>
        <td>
          <button class="btn btn-sm btn-outline-success me-1" data-action="approve" data-id="${c.id}" data-slug="${c.slug}">Approve</button>
          <button class="btn btn-sm btn-outline-danger" data-action="delete-comment" data-id="${c.id}" data-slug="${c.slug}">Delete</button>
        </td>
      </tr>
    `).join('');

    tbody.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const action = btn.getAttribute('data-action');
        const id = btn.getAttribute('data-id');
        const slug = btn.getAttribute('data-slug');
        const status = action === 'approve' ? 'approved' : 'deleted';
        await api(`${BLOG_API}?action=comment-moderate`, {
          method: 'POST',
          body: JSON.stringify({ slug, id, status }),
        });
        await loadComments();
      });
    });
  }

  async function loadPosts() {
    const posts = await api(`${BLOG_API}?action=admin-list`);
    postsCache = Array.isArray(posts) ? posts : [];
    renderPostTable(postsCache);
  }

  async function loadComments() {
    const comments = await api(`${BLOG_API}?action=admin-comments`);
    renderCommentsTable(Array.isArray(comments) ? comments : []);
  }

  async function uploadImage(file) {
    const toDataUrl = (f) => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(f);
    });
    const dataUrl = await toDataUrl(file);
    const out = await api(`${BLOG_API}?action=upload-image`, {
      method: 'POST',
      body: JSON.stringify({ filename: file.name, dataUrl }),
    });
    return out.url;
  }

  function bindEditorEvents() {
    $('postTitleInput').addEventListener('input', () => {
      if (!currentSlug) $('postSlugInput').value = slugify($('postTitleInput').value);
    });

    $('postImageInput').addEventListener('input', () => {
      const src = $('postImageInput').value.trim();
      if (src) {
        $('postImagePreview').src = src;
        $('postImagePreview').style.display = '';
      } else {
        $('postImagePreview').style.display = 'none';
        $('postImagePreview').src = '';
      }
    });

    $('postImageFile').addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      $('formStatus').className = 'small text-muted';
      $('formStatus').textContent = 'Uploading image...';
      try {
        const imageUrl = await uploadImage(file);
        $('postImageInput').value = imageUrl;
        $('postImagePreview').src = imageUrl;
        $('postImagePreview').style.display = '';
        $('formStatus').className = 'small text-success';
        $('formStatus').textContent = 'Image uploaded.';
      } catch (err) {
        $('formStatus').className = 'small text-danger';
        $('formStatus').textContent = err.message;
      } finally {
        e.target.value = '';
      }
    });
  }

  function bindPreview() {
    $('previewBtn').addEventListener('click', () => {
      const p = formToPayload();
      $('previewTitle').textContent = p.title || 'Untitled';
      $('previewMeta').textContent = `${p.author || 'Bells Fork Team'} | ${p.category || 'General'} | ${p.status}`;
      $('previewContent').innerHTML = p.content || '<p class="text-muted">No content.</p>';
      if (p.featuredImage) {
        $('previewImage').src = p.featuredImage;
        $('previewImage').style.display = '';
      } else {
        $('previewImage').style.display = 'none';
        $('previewImage').src = '';
      }
      previewModal.show();
    });
  }

  function bindFormActions() {
    $('newPostBtn').addEventListener('click', resetForm);

    $('postForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      $('formStatus').className = 'small text-muted';
      $('formStatus').textContent = 'Saving...';
      const payload = formToPayload();
      try {
        const saved = await api(BLOG_API, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        currentSlug = saved.slug;
        $('postSlugInput').value = saved.slug;
        $('formStatus').className = 'small text-success';
        $('formStatus').textContent = saved.status === 'published'
          ? 'Saved and published.'
          : 'Draft saved.';
        await loadPosts();
      } catch (err) {
        $('formStatus').className = 'small text-danger';
        $('formStatus').textContent = err.message;
      }
    });

    $('deletePostBtn').addEventListener('click', async () => {
      const slug = (currentSlug || $('postSlugInput').value || '').trim();
      if (!slug) return;
      if (!confirm(`Delete post "${slug}"?`)) return;
      $('formStatus').className = 'small text-muted';
      $('formStatus').textContent = 'Deleting...';
      try {
        await api(`${BLOG_API}?slug=${encodeURIComponent(slug)}`, { method: 'DELETE' });
        resetForm();
        $('formStatus').className = 'small text-success';
        $('formStatus').textContent = 'Post deleted.';
        await loadPosts();
      } catch (err) {
        $('formStatus').className = 'small text-danger';
        $('formStatus').textContent = err.message;
      }
    });

    $('refreshCommentsBtn').addEventListener('click', loadComments);
  }

  function bindLogin() {
    $('loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      $('loginStatus').className = 'small text-muted mt-2';
      $('loginStatus').textContent = 'Signing in...';
      try {
        const username = $('loginUser').value.trim();
        const password = $('loginPass').value;
        const passwordHash = await sha256(password);
        const res = await fetch(AUTH_API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, passwordHash }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Login failed');
        setSession(data.token, data.user || username);
        $('loginStatus').className = 'small text-success mt-2';
        $('loginStatus').textContent = 'Signed in.';
        await startAdmin();
      } catch (err) {
        $('loginStatus').className = 'small text-danger mt-2';
        $('loginStatus').textContent = err.message || 'Login failed';
      }
    });

    $('logoutBtn').addEventListener('click', () => {
      clearSession();
      setLoginState(false);
      resetForm();
    });
  }

  async function startAdmin() {
    // validate token
    await api(`${BLOG_API}?action=admin-list`);
    setLoginState(true);
    await Promise.all([loadPosts(), loadComments()]);
  }

  function init() {
    editor = new Quill('#editor', {
      theme: 'snow',
      modules: {
        toolbar: [
          [{ header: [2, 3, false] }],
          ['bold', 'italic', 'underline', 'link'],
          [{ list: 'ordered' }, { list: 'bullet' }],
          ['blockquote', 'code-block'],
          ['clean'],
        ],
      },
    });
    previewModal = new bootstrap.Modal(document.getElementById('previewModal'));

    bindLogin();
    bindEditorEvents();
    bindPreview();
    bindFormActions();

    const token = getToken();
    if (token) {
      startAdmin().catch(() => {
        clearSession();
        setLoginState(false);
      });
    } else {
      setLoginState(false);
    }
  }

  init();
})();

