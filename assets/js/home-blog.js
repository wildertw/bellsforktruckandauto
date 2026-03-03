(function () {
  const DATA_URL = '/.netlify/functions/blog?action=list&limit=6';
  const container = document.getElementById('homeBlogPosts');
  const filters = document.getElementById('homeBlogFilters');
  let posts = [];
  let activeCategory = '';

  if (!container || !filters) return;

  function renderFilters() {
    const categories = Array.from(new Set(posts.map((post) => post.category || 'General')));
    filters.innerHTML = '';
    const allBtn = document.createElement('button');
    allBtn.type = 'button';
    allBtn.textContent = 'All';
    allBtn.className = activeCategory === '' ? 'active' : '';
    allBtn.addEventListener('click', () => {
      activeCategory = '';
      renderFilters();
      renderPosts();
    });
    filters.appendChild(allBtn);
    categories.forEach((category) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = category;
      btn.className = activeCategory === category ? 'active' : '';
      btn.addEventListener('click', () => {
        activeCategory = category;
        renderFilters();
        renderPosts();
      });
      filters.appendChild(btn);
    });
  }

  function renderPosts() {
    const filtered = activeCategory
      ? posts.filter((post) => (post.category || 'General') === activeCategory)
      : posts;
    if (!filtered.length) {
      container.innerHTML = '<p class="muted">No posts found for this category.</p>';
      return;
    }
    container.innerHTML = filtered
      .map((post) => `
        <div class="col-md-6 col-lg-4">
          <article class="home-blog-card">
            <span>${post.category || 'General'} • ${post.status || 'draft'}</span>
            <h3>${post.title}</h3>
            <p>${post.excerpt || post.content?.replace(/<[^>]+>/g, '').slice(0, 120) || 'Read our latest update spotlighted for you.'}</p>
            <a href="/blog/${encodeURIComponent(post.slug)}">Read <strong>More</strong></a>
          </article>
        </div>
      `).join('');
  }

  async function fetchPosts() {
    try {
      const res = await fetch(DATA_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      posts = await res.json();
      renderFilters();
      renderPosts();
    } catch (err) {
      container.innerHTML = `<p class="muted">Unable to load blog posts right now.</p>`;
      console.error('Home blog load error:', err);
    }
  }

  fetchPosts();
})();
