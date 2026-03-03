(function () {
  const inventoryKey = 'dashboardInventory';
  const credentials = [
    { user: 'trey', pass: 'admin1' },
    { user: 'frank', pass: 'Tina1234' },
  ];
  const BLOG_API = '/.netlify/functions/blog';
  const BLOG_AUTH = '/.netlify/functions/blog-auth';
  let blogToken = '';
  let blogUser = '';
  let inventory = JSON.parse(localStorage.getItem(inventoryKey) || 'null') || [
    {
      sku: 'BF-001',
      name: 'Diesel Pickup',
      category: 'Truck',
      quantity: 12,
      price: 48990,
      description: 'Heavy-duty work truck',
      supplier: 'Bells Fork Supply',
      year: 2020,
      make: 'Ford',
      model: 'F-250',
      trim: 'Lariat',
      vin: '1FT7W2B50LED12345',
      stockNumber: 'D2601',
      engine: '6.7L Power Stroke',
      transmission: '10-Speed Automatic',
      mileage: 58000,
      mpgCity: 15,
      mpgHighway: 21,
      exteriorColor: 'Gray',
      interiorColor: 'Black',
      features: ['4x4', 'Tow Package'],
      status: 'available',
    },
    {
      sku: 'BF-002',
      name: 'Crew Cab SUV',
      category: 'SUV',
      quantity: 6,
      price: 38920,
      description: 'Family ready with comfort features',
      supplier: 'Greenville Imports',
      year: 2019,
      make: 'Chevrolet',
      model: 'Tahoe',
      trim: 'LT',
      vin: '1GNSKBKC4KR456789',
      stockNumber: 'D2602',
      engine: '5.3L V8',
      transmission: '8-Speed Automatic',
      mileage: 72000,
      mpgCity: 16,
      mpgHighway: 21,
      exteriorColor: 'White',
      interiorColor: 'Gray',
      features: ['Third-row', 'Bluetooth'],
      status: 'pending',
    },
    {
      sku: 'BF-003',
      name: 'Performance Sedan',
      category: 'Sedan',
      quantity: 4,
      price: 27900,
      description: 'Sport package and refined cabin',
      supplier: 'Blue Ridge',
      year: 2018,
      make: 'Cadillac',
      model: 'CTS',
      trim: 'Premium',
      vin: '1G6AX5S3XH0123456',
      stockNumber: 'D2603',
      engine: '3.6L V6 Turbo',
      transmission: '8-Speed Automatic',
      mileage: 36000,
      mpgCity: 18,
      mpgHighway: 26,
      exteriorColor: 'Black',
      interiorColor: 'Red',
      features: ['Navigation', 'Sport Suspension'],
      status: 'available',
    },
  ];
  let blogPosts = [];

  async function sha256Hex(value) {
    const data = new TextEncoder().encode(value);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  async function requestBlogToken(user, pass) {
    const passwordHash = await sha256Hex(pass);
    const res = await fetch(BLOG_AUTH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user, passwordHash }),
    });
    if (!res.ok) throw new Error('Blog auth failed');
    return res.json();
  }

  async function blogAdminRequest(path = '?action=admin-list', options = {}) {
    if (!blogToken) throw new Error('Blog dashboard not authenticated');
    const url = `${BLOG_API}${path}`;
    const init = {
      ...options,
      headers: {
        Authorization: `Bearer ${blogToken}`,
        ...(options.headers || {}),
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      },
    };
    const res = await fetch(url, init);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Blog request failed');
    }
    return res.json();
  }

  const authPanel = document.getElementById('authPanel');
  const dashboard = document.getElementById('dashboard');
  const loginForm = document.getElementById('loginForm');
  const loginFeedback = document.getElementById('loginFeedback');
  const currentUser = document.getElementById('currentUser');
  const logoutBtn = document.getElementById('logoutBtn');
  const tabs = document.querySelectorAll('.tab');
  const panels = document.querySelectorAll('.tab-panel');
  const addForm = document.getElementById('addInventoryForm');
  const addFeedback = document.getElementById('addFeedback');
  const inventoryTableBody = document.querySelector('#inventoryTable tbody');
  const editFeedback = document.getElementById('editFeedback');
  const bulkFeedback = document.getElementById('bulkFeedback');
  const bulkProgress = document.getElementById('bulkProgress');
  const exportFilter = document.getElementById('exportFilter');
  const editModal = document.getElementById('editModal');
  const previewModal = document.getElementById('previewModal');
  const previewContent = document.getElementById('previewContent');
  const previewTitle = document.getElementById('previewTitle');
  let currentPage = 1;
  const pageSize = 6;
  let currentFilter = '';
  let editingItem = null;
  let filteredInventory = [];

  function toggleAuth(showDashboard, user) {
    authPanel.style.display = showDashboard ? 'none' : 'grid';
    dashboard.style.filter = showDashboard ? 'none' : 'blur(1px)';
    dashboard.dataset.noScroll = showDashboard ? 'true' : 'false';
    currentUser.textContent = user ? `Signed in as ${user}` : '';
  }

  function loginUser(user) {
    toggleAuth(true, user);
    loginFeedback.textContent = '';
  }

  async function handleLogin(event) {
    event.preventDefault();
    const user = document.getElementById('loginUser').value.trim();
    const pass = document.getElementById('loginPass').value;
    const match = credentials.find((c) => c.user.toLowerCase() === user.toLowerCase() && c.pass === pass);
    if (match) {
      loginUser(match.user === 'Frank' ? 'Frank' : match.user);
      try {
        const data = await requestBlogToken(match.user, pass);
        blogToken = data.token;
        blogUser = data.user || match.user;
        await loadBlogPosts();
      } catch (err) {
        loginFeedback.classList.remove('hide');
        loginFeedback.textContent = `Logged in, but blog auth failed: ${err.message}`;
      }
      return;
    }
    loginFeedback.classList.remove('hide');
    loginFeedback.textContent = 'Credentials do not match.';
  }

  function switchTab(tab) {
    tabs.forEach((t) => t.classList.toggle('active', t === tab));
    panels.forEach((panel) => panel.classList.toggle('active', panel.dataset.panel === tab.dataset.tab));
  }

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => switchTab(tab));
  });

  function persistInventory() {
    localStorage.setItem(inventoryKey, JSON.stringify(inventory));
  }

  function bindLogout() {
    logoutBtn.addEventListener('click', () => toggleAuth(false));
  }

  function refreshExportFilter() {
    const categories = [...new Set(inventory.map((item) => item.category))].sort();
    exportFilter.innerHTML = '<option value="">All Categories</option>' + categories.map((cat) => `<option value="${cat}">${cat}</option>`).join('');
  }

  function renderInventoryTable() {
    refreshExportFilter();
    const search = document.getElementById('editSearch').value.trim().toLowerCase();
    filteredInventory = inventory.filter((item) => {
      if (!search) return true;
      return [item.sku, item.name, item.category, item.supplier].some((field) => String(field).toLowerCase().includes(search));
    });
    const totalPages = Math.max(1, Math.ceil(filteredInventory.length / pageSize));
    currentPage = Math.min(currentPage, totalPages);
    const start = (currentPage - 1) * pageSize;
    const pageSlice = filteredInventory.slice(start, start + pageSize);
    inventoryTableBody.innerHTML = pageSlice
      .map((item) => `
        <tr>
          <td>${item.sku}</td>
          <td>${item.name}</td>
          <td>${item.category}</td>
          <td>${item.status}</td>
          <td>${item.quantity}</td>
          <td>$${item.price.toFixed(2)}</td>
          <td class="table-actions">
            <button class="ghost-btn" data-action="edit" data-sku="${item.sku}">Edit</button>
            <button class="ghost-btn" data-action="delete" data-sku="${item.sku}">Delete</button>
          </td>
        </tr>`).join('');
    document.getElementById('pageInfo').textContent = `Page ${currentPage} / ${totalPages}`;
  }

  function handleTableActions(event) {
    if (!event.target.matches('button')) return;
    const action = event.target.dataset.action;
    const sku = event.target.dataset.sku;
    const item = inventory.find((row) => row.sku === sku);
    if (!item) return;
    if (action === 'edit') {
      editingItem = item;
      document.getElementById('editName').value = item.name;
      document.getElementById('editSku').value = item.sku;
      document.getElementById('editCategory').value = item.category;
      document.getElementById('editYear').value = item.year || '';
      document.getElementById('editMake').value = item.make || '';
      document.getElementById('editModel').value = item.model || '';
      document.getElementById('editTrim').value = item.trim || '';
      document.getElementById('editVin').value = item.vin || '';
      document.getElementById('editQuantity').value = item.quantity;
      document.getElementById('editPrice').value = item.price;
      document.getElementById('editEngine').value = item.engine || '';
      document.getElementById('editTransmission').value = item.transmission || '';
      document.getElementById('editStatus').value = item.status || 'available';
      document.getElementById('editModal').classList.add('active');
    } else if (action === 'delete') {
      if (confirm(`Delete ${item.name} (${item.sku})?`)) {
        inventory = inventory.filter((entry) => entry.sku !== sku);
        persistInventory();
        renderInventoryTable();
        editFeedback.textContent = 'Item removed.';
        editFeedback.classList.remove('hide');
      }
    }
  }

  function handleEditSubmit(event) {
    event.preventDefault();
    if (!editingItem) return;
    editingItem.name = document.getElementById('editName').value.trim();
    editingItem.category = document.getElementById('editCategory').value.trim();
    editingItem.year = Number(document.getElementById('editYear').value) || editingItem.year;
    editingItem.make = document.getElementById('editMake').value.trim() || editingItem.make;
    editingItem.model = document.getElementById('editModel').value.trim() || editingItem.model;
    editingItem.trim = document.getElementById('editTrim').value.trim() || editingItem.trim;
    editingItem.vin = document.getElementById('editVin').value.trim() || editingItem.vin;
    editingItem.quantity = Number(document.getElementById('editQuantity').value);
    editingItem.price = Number(document.getElementById('editPrice').value);
    editingItem.engine = document.getElementById('editEngine').value.trim() || editingItem.engine;
    editingItem.transmission = document.getElementById('editTransmission').value.trim() || editingItem.transmission;
    editingItem.status = document.getElementById('editStatus').value;
    persistInventory();
    renderInventoryTable();
    editFeedback.textContent = 'Item updated.';
    editFeedback.classList.remove('hide');
    editModal.classList.remove('active');
  }

  function handleAddSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const name = document.getElementById('addName').value.trim();
    const sku = document.getElementById('addSku').value.trim();
    const category = document.getElementById('addCategory').value.trim();
    const quantity = Number(document.getElementById('addQuantity').value);
    const price = Number(document.getElementById('addPrice').value);
    const description = document.getElementById('addDescription').value.trim();
    const supplier = document.getElementById('addSupplier').value.trim();
    const year = Number(document.getElementById('addYear').value) || null;
    const make = document.getElementById('addMake').value.trim();
    const model = document.getElementById('addModel').value.trim();
    const trim = document.getElementById('addTrim').value.trim();
    const vin = document.getElementById('addVin').value.trim();
    const stockNumber = document.getElementById('addStock').value.trim();
    const engine = document.getElementById('addEngine').value.trim();
    const transmission = document.getElementById('addTransmission').value.trim();
    const mileage = Number(document.getElementById('addMileage').value) || 0;
    const mpgCity = Number(document.getElementById('addMpgCity').value) || null;
    const mpgHighway = Number(document.getElementById('addMpgHighway').value) || null;
    const exteriorColor = document.getElementById('addExteriorColor').value.trim();
    const interiorColor = document.getElementById('addInteriorColor').value.trim();
    const status = document.getElementById('addStatus').value;
    const features = document.getElementById('addFeatures').value
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
    if (!name || !sku || !category) {
      addFeedback.textContent = 'Please fill required fields.';
      addFeedback.classList.remove('hide');
      return;
    }
    if (inventory.some((item) => item.sku === sku)) {
      addFeedback.textContent = 'SKU already exists.';
      addFeedback.classList.remove('hide');
      return;
    }
    inventory.unshift({
      name,
      sku,
      category,
      quantity,
      price,
      description,
      supplier,
      year,
      make,
      model,
      trim,
      vin,
      stockNumber,
      engine,
      transmission,
      mileage,
      mpgCity,
      mpgHighway,
      exteriorColor,
      interiorColor,
      features,
      status,
    });
    persistInventory();
    renderInventoryTable();
    addFeedback.textContent = 'Item saved.';
    addFeedback.classList.remove('hide');
    form.reset();
  }

  function handleClearForm() {
    addForm.reset();
    addFeedback.classList.add('hide');
  }

  function downloadTemplate() {
    const template = 'SKU,Item Name,Category,Quantity,Price,Description,Supplier\n';
    const blob = new Blob([template], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'inventory-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleBulkUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    bulkFeedback.textContent = 'Parsing file...';
    bulkFeedback.classList.remove('hide');
    const reader = new FileReader();
    reader.onload = () => {
      const lines = reader.result.split(/\r?\n/).slice(1);
      lines.forEach((line) => {
        const [sku, name, category, quantity, price, description, supplier] = line.split(',');
        if (sku && !inventory.some((row) => row.sku === sku.trim())) {
          inventory.unshift({
            sku: sku.trim(),
            name: name?.trim() || 'Imported item',
            category: category?.trim() || 'Misc',
            quantity: Number(quantity) || 0,
            price: Number(price) || 0,
            description: description?.trim() || '',
            supplier: supplier?.trim() || '',
          });
        }
      });
      persistInventory();
      renderInventoryTable();
      bulkFeedback.textContent = 'Bulk import completed.';
    };
    reader.readAsText(file);
    event.target.value = '';
  }

  function exportInventory() {
    const filterCat = document.getElementById('exportFilter').value;
    const list = filterCat ? inventory.filter((item) => item.category === filterCat) : inventory;
    const rows = list.map((item) => [
      item.sku, item.name, item.category, item.quantity, item.price, item.description, item.supplier,
    ].join(','));
    const csv = ['SKU,Name,Category,Quantity,Price,Description,Supplier', ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'inventory-export.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleMassUpdate() {
    const percent = Number(document.getElementById('massPrice').value) || 0;
    const category = document.getElementById('massCategory').value.trim();
    bulkFeedback.textContent = 'Applying updates...';
    bulkFeedback.classList.remove('hide');
    let progress = 0;
    const step = () => {
      progress += 10;
      bulkProgress.style.width = `${progress}%`;
      if (progress >= 100) {
      const targetSKUs = new Set((filteredInventory.length ? filteredInventory : inventory).map((item) => item.sku));
      inventory = inventory.map((item) => {
        const updated = { ...item };
        if (!targetSKUs.has(item.sku)) return updated;
        if (percent) {
          updated.price = Math.max(0, updated.price + (updated.price * percent) / 100);
        }
        if (category) updated.category = category;
        return updated;
      });
        persistInventory();
        renderInventoryTable();
        bulkFeedback.textContent = 'Mass update applied.';
        setTimeout(() => (bulkProgress.style.width = '0%'), 400);
        return;
      }
      setTimeout(step, 120);
    };
    step();
  }

  function renderBlogList() {
    const container = document.getElementById('blogList');
    if (!blogPosts.length) {
      container.innerHTML = `<p class="muted">${blogToken ? 'No posts yet.' : 'Sign in to load posts.'}</p>`;
      return;
    }
    const search = document.getElementById('blogSearch').value.trim().toLowerCase();
    const filter = document.getElementById('blogFilter').value;
    const list = blogPosts.filter((post) => {
      const matchesSearch = [post.title, post.category, (post.tags || []).join(' ')].some((field) => String(field || '').toLowerCase().includes(search));
      const matchesStatus = filter ? post.status === filter : true;
      return matchesSearch && matchesStatus;
    });
    if (!list.length) {
      container.innerHTML = '<p class="muted">No posts match the filter.</p>';
      return;
    }
    container.innerHTML = list
      .map((post) => `
        <div class="blog-item">
          <div>
            <strong>${post.title}</strong>
            <div class="muted">${post.category} • ${post.status} • ${post.publishedAt ? new Date(post.publishedAt).toLocaleDateString() : 'TBD'}</div>
          </div>
          <button class="ghost-btn" data-slug="${post.slug}" data-action="edit-blog">Edit</button>
        </div>
      `).join('');
    container.querySelectorAll('button').forEach((button) => {
      button.addEventListener('click', () => {
        const slug = button.dataset.slug;
        const post = blogPosts.find((entry) => entry.slug === slug);
        if (!post) return;
        document.getElementById('blogTitle').value = post.title;
        document.getElementById('blogCategory').value = post.category;
        document.getElementById('blogTags').value = (post.tags || []).join(', ');
        document.getElementById('blogDate').value = post.publishedAt ? post.publishedAt.split('T')[0] : '';
        document.getElementById('blogStatus').value = post.status;
        document.getElementById('blogImage').value = post.featuredImage || '';
        document.getElementById('blogStatusLine').textContent = `Editing ${post.title}`;
        document.getElementById('blogEditor').innerHTML = post.content;
      });
    });
  }

  async function loadBlogPosts() {
    try {
      const posts = await blogAdminRequest('?action=admin-list');
      blogPosts = Array.isArray(posts) ? posts : [];
      renderBlogList();
    } catch (err) {
      document.getElementById('blogStatusLine').textContent = `Unable to load posts: ${err.message}`;
      blogPosts = [];
      renderBlogList();
    }
  }

  async function saveBlogPost() {
    if (!blogToken) {
      document.getElementById('blogStatusLine').textContent = 'Sign in to publish posts.';
      return;
    }
    const title = document.getElementById('blogTitle').value.trim();
    if (!title) {
      document.getElementById('blogStatusLine').textContent = 'Title is required.';
      return;
    }
    const status = document.getElementById('blogStatus').value;
    const content = document.getElementById('blogEditor').innerHTML.trim() || '<p>No content</p>';
    const textSnapshot = document.createElement('div');
    textSnapshot.innerHTML = content;
    const cleanText = textSnapshot.textContent.trim();
    const excerpt = cleanText ? `${cleanText.slice(0, 220)}...` : '';
    const payload = {
      title,
      content,
      category: document.getElementById('blogCategory').value.trim() || 'Updates',
      tags: document.getElementById('blogTags').value.split(',').map((t) => t.trim()).filter(Boolean),
      status,
      publishedAt: status === 'published' ? (document.getElementById('blogDate').value || new Date().toISOString()) : null,
      featuredImage: document.getElementById('blogImage').value.trim(),
      author: blogUser || 'Admin',
      excerpt,
      metaDescription: excerpt,
    };
    try {
      await blogAdminRequest('', { method: 'POST', body: JSON.stringify(payload) });
      document.getElementById('blogStatusLine').textContent = `Post ${status} successfully.`;
      await loadBlogPosts();
    } catch (err) {
      document.getElementById('blogStatusLine').textContent = `Save failed: ${err.message}`;
    }
  }

  function previewBlog() {
    const title = document.getElementById('blogTitle').value;
    const body = document.getElementById('blogEditor').innerHTML || '<p>No content yet.</p>';
    previewTitle.textContent = title || 'Untitled';
    previewContent.innerHTML = body;
    document.getElementById('previewModal').classList.add('active');
  }

  function handleBlogImageUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      document.getElementById('blogImage').value = reader.result;
    };
    reader.readAsDataURL(file);
    event.target.value = '';
  }

  function closeModals(event) {
    if (event.target.matches('.modal') || event.target.dataset.close !== undefined) {
      document.querySelectorAll('.modal').forEach((modal) => modal.classList.remove('active'));
    }
  }

  function init() {
    loginForm.addEventListener('submit', handleLogin);
    logoutBtn.addEventListener('click', () => toggleAuth(false));
    document.getElementById('clearAdd').addEventListener('click', handleClearForm);
    addForm.addEventListener('submit', handleAddSubmit);
    document.getElementById('inventoryTable').addEventListener('click', handleTableActions);
    document.getElementById('editForm').addEventListener('submit', handleEditSubmit);
    document.getElementById('cancelEdit').addEventListener('click', () => editModal.classList.remove('active'));
    document.getElementById('editSearch').addEventListener('input', () => {
      currentPage = 1;
      renderInventoryTable();
    });
    document.getElementById('prevPage').addEventListener('click', () => {
      currentPage = Math.max(1, currentPage - 1);
      renderInventoryTable();
    });
    document.getElementById('nextPage').addEventListener('click', () => {
      const totalPages = Math.max(1, Math.ceil(filteredInventory.length / pageSize));
      currentPage = Math.min(totalPages, currentPage + 1);
      renderInventoryTable();
    });
    document.getElementById('bulkUpload').addEventListener('change', handleBulkUpload);
    document.getElementById('downloadTemplate').addEventListener('click', downloadTemplate);
    document.getElementById('exportBtn').addEventListener('click', exportInventory);
    document.getElementById('applyMass').addEventListener('click', handleMassUpdate);
    document.getElementById('blogSave').addEventListener('click', saveBlogPost);
    document.getElementById('blogSearch').addEventListener('input', renderBlogList);
    document.getElementById('blogFilter').addEventListener('change', renderBlogList);
    document.getElementById('blogImageFile').addEventListener('change', handleBlogImageUpload);
    document.getElementById('previewPost').addEventListener('click', previewBlog);
    document.getElementById('previewModal').addEventListener('click', closeModals);
    document.getElementById('editModal').addEventListener('click', closeModals);

    renderInventoryTable();
    renderBlogList();
  }

  init();
})();
