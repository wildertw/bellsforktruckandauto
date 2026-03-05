(function () {
  'use strict';

  // ─── Constants & State ──────────────────────────────────────────────────────
  const INVENTORY_KEY = 'dashboardInventory';
  const BLOG_API = '/.netlify/functions/blog';
  const BLOG_AUTH = '/.netlify/functions/blog-auth';
  const STAGE_API = '/.netlify/functions/inventory-stage';
  const PUBLISH_API = '/.netlify/functions/inventory-publish';
  const NHTSA_API = 'https://vpic.nhtsa.dot.gov/api/vehicles/decodevinvalues';
  const STATS_API = '/.netlify/functions/dashboard-stats';

  let blogToken = '';
  let blogUser = '';
  let authPasswordHash = '';
  let blogPosts = [];
  let blogComments = [];
  let quillEditor = null;
  let currentBlogSlug = '';
  let parsedPublishInventory = null;
  let currentPeriod = 'week';
  let statsCache = { data: null, time: 0, period: '' };

  let inventory = JSON.parse(localStorage.getItem(INVENTORY_KEY) || 'null') || [
    {
      sku: 'BF-001', name: 'Diesel Pickup', category: 'Truck', quantity: 12, price: 48990,
      description: 'Heavy-duty work truck', supplier: 'Bells Fork Supply',
      year: 2020, make: 'Ford', model: 'F-250', trim: 'Lariat',
      vin: '1FT7W2B50LED12345', stockNumber: 'D2601',
      engine: '6.7L Power Stroke', transmission: '10-Speed Automatic',
      mileage: 58000, mpgCity: 15, mpgHighway: 21,
      exteriorColor: 'Gray', interiorColor: 'Black',
      features: ['4x4', 'Tow Package'], status: 'available',
    },
    {
      sku: 'BF-002', name: 'Crew Cab SUV', category: 'SUV', quantity: 6, price: 38920,
      description: 'Family ready with comfort features', supplier: 'Greenville Imports',
      year: 2019, make: 'Chevrolet', model: 'Tahoe', trim: 'LT',
      vin: '1GNSKBKC4KR456789', stockNumber: 'D2602',
      engine: '5.3L V8', transmission: '8-Speed Automatic',
      mileage: 72000, mpgCity: 16, mpgHighway: 21,
      exteriorColor: 'White', interiorColor: 'Gray',
      features: ['Third-row', 'Bluetooth'], status: 'pending',
    },
    {
      sku: 'BF-003', name: 'Performance Sedan', category: 'Sedan', quantity: 4, price: 27900,
      description: 'Sport package and refined cabin', supplier: 'Blue Ridge',
      year: 2018, make: 'Cadillac', model: 'CTS', trim: 'Premium',
      vin: '1G6AX5S3XH0123456', stockNumber: 'D2603',
      engine: '3.6L V6 Turbo', transmission: '8-Speed Automatic',
      mileage: 36000, mpgCity: 18, mpgHighway: 26,
      exteriorColor: 'Black', interiorColor: 'Red',
      features: ['Navigation', 'Sport Suspension'], status: 'available',
    },
  ];

  let currentPage = 1;
  const pageSize = 6;
  let currentFilter = '';
  let editingItem = null;
  let filteredInventory = [];
  let vinDecodeData = null;
  let editVinDecodeData = null;
  let editPhotoFiles = [];
  let addPhotoFiles = [];
  let editKeptImages = []; // existing Cloudinary URLs to keep when editing

  // ─── DOM References ─────────────────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);
  const authPanel = $('authPanel');
  const dashboard = $('dashboard');
  const loginForm = $('loginForm');
  const loginFeedback = $('loginFeedback');
  const currentUser = $('currentUser');
  const logoutBtn = $('logoutBtn');
  const tabs = document.querySelectorAll('.tab');
  const panels = document.querySelectorAll('.tab-panel');
  const addForm = $('addInventoryForm');
  const addFeedback = $('addFeedback');
  const inventoryTableBody = document.querySelector('#inventoryTable tbody');
  const editFeedback = $('editFeedback');
  const bulkFeedback = $('bulkFeedback');
  const bulkProgress = $('bulkProgress');
  const exportFilter = $('exportFilter');
  const editModal = $('editModal');
  const previewModal = $('previewModal');
  const previewContent = $('previewContent');
  const previewTitle = $('previewTitle');

  // ─── Utility ────────────────────────────────────────────────────────────────
  async function sha256Hex(value) {
    const data = new TextEncoder().encode(value);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  function formatMoney(value) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(value) || 0);
  }

  function slugify(text) {
    return String(text || '').toLowerCase().replace(/[^\w\s-]/g, '').replace(/[\s_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90);
  }

  function showFeedback(el, msg, isError) {
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hide');
    if (isError) el.classList.add('error');
    else el.classList.remove('error');
  }

  function hideFeedback(el) {
    if (el) el.classList.add('hide');
  }

  function persistInventory() {
    localStorage.setItem(INVENTORY_KEY, JSON.stringify(inventory));
  }

  // ─── Toast Notifications ──────────────────────────────────────────────────
  function showToast(message, type) {
    var toast = document.getElementById('autoSaveToast');
    if (!toast) return;
    toast.textContent = message;
    toast.className = 'auto-save-toast show';
    if (type) toast.classList.add(type);
  }
  function hideToast() {
    var toast = document.getElementById('autoSaveToast');
    if (toast) toast.className = 'auto-save-toast';
  }

  // ─── Cloudinary Upload ────────────────────────────────────────────────────
  async function uploadToCloudinary(file) {
    var cloudName = localStorage.getItem('bf_cloud_name');
    var preset = localStorage.getItem('bf_cloud_preset');
    if (!cloudName || !preset) {
      throw new Error('Cloudinary not configured. Go to Settings to add Cloud Name and Upload Preset.');
    }
    var formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', preset);
    var res = await fetch('https://api.cloudinary.com/v1_1/' + cloudName + '/image/upload', {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) {
      var err = await res.json().catch(function () { return {}; });
      throw new Error(err.error && err.error.message ? err.error.message : 'Cloudinary upload failed');
    }
    var data = await res.json();
    return data.secure_url;
  }

  async function uploadPhotos(files, progressCb) {
    var urls = [];
    for (var i = 0; i < files.length; i++) {
      if (progressCb) progressCb(i + 1, files.length);
      var url = await uploadToCloudinary(files[i]);
      urls.push(url);
    }
    return urls;
  }

  // ─── Auto Publish (Stage + Publish in one step) ───────────────────────────
  async function autoPublish() {
    var session = JSON.parse(sessionStorage.getItem('bf_admin_session') || '{}');
    if (!session.username) {
      throw new Error('Not authenticated. Please log in again.');
    }

    // Build publish-ready inventory (same format as exportInventoryJSON)
    var vehicles = inventory.map(function (item) {
      return {
        vin: item.vin, stockNumber: item.stockNumber || item.sku,
        year: item.year, make: item.make, model: item.model, trim: item.trim,
        engine: item.engine, transmission: item.transmission,
        drivetrain: item.drivetrain, fuelType: item.fuelType,
        mpgCity: item.mpgCity, mpgHighway: item.mpgHighway,
        mileage: item.mileage, price: item.price,
        type: item.category, exteriorColor: item.exteriorColor,
        interiorColor: item.interiorColor, description: item.description,
        features: item.features, status: item.status,
        badge: item.badge, images: item.images || [],
        dateAdded: item.dateAdded || new Date().toISOString().split('T')[0],
      };
    });
    var publishData = { vehicles: vehicles, lastUpdated: new Date().toISOString() };

    // Stage
    showToast('Staging inventory...');
    var stageRes = await fetch(STAGE_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth: { user: session.username, passwordHash: session.passwordHash || authPasswordHash },
        inventory: publishData,
      }),
    });
    var stageResult = await stageRes.json();
    if (!stageRes.ok) throw new Error(stageResult.error || 'Staging failed');

    // Publish
    showToast('Publishing to live site...');
    var pubRes = await fetch(PUBLISH_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth: { user: session.username, passwordHash: session.passwordHash || authPasswordHash },
      }),
    });
    var pubResult = await pubRes.json();
    if (!pubRes.ok) throw new Error(pubResult.error || 'Publish failed');

    return pubResult;
  }

  // ─── Auth ───────────────────────────────────────────────────────────────────
  function toggleAuth(showDashboard, user) {
    authPanel.style.display = showDashboard ? 'none' : 'grid';
    dashboard.style.filter = showDashboard ? 'none' : 'blur(1px)';
    dashboard.dataset.noScroll = showDashboard ? 'true' : 'false';
    currentUser.textContent = user ? 'Signed in as ' + user : '';
  }

  async function handleLogin(event) {
    event.preventDefault();
    const user = $('loginUser').value.trim();
    const pass = $('loginPass').value;
    if (!user || !pass) {
      showFeedback(loginFeedback, 'Enter username and password.');
      return;
    }
    try {
      const passwordHash = await sha256Hex(pass);
      const res = await fetch(BLOG_AUTH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user, passwordHash }),
      });
      if (!res.ok) throw new Error('Auth failed');
      const data = await res.json();
      blogToken = data.token;
      blogUser = data.user || user;
      authPasswordHash = passwordHash;

      // Store session for publish pipeline compatibility
      sessionStorage.setItem('bf_admin_session', JSON.stringify({
        authenticated: true, user: blogUser, username: user,
        passwordHash: passwordHash, loginTime: Date.now(),
      }));

      toggleAuth(true, blogUser);
      loginFeedback.textContent = '';
      await Promise.all([loadBlogPosts(), loadBlogComments()]);
    } catch (err) {
      showFeedback(loginFeedback, 'Credentials do not match.');
    }
  }

  // ─── Blog API ───────────────────────────────────────────────────────────────
  async function blogAdminRequest(path, options) {
    if (!blogToken) throw new Error('Not authenticated');
    const url = BLOG_API + (path || '?action=admin-list');
    const init = {
      ...(options || {}),
      headers: {
        Authorization: 'Bearer ' + blogToken,
        ...((options && options.headers) || {}),
        ...((options && options.body) ? { 'Content-Type': 'application/json' } : {}),
      },
    };
    const res = await fetch(url, init);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Blog request failed');
    }
    return res.json();
  }

  // ─── Tab Navigation ─────────────────────────────────────────────────────────
  function switchTab(tab) {
    tabs.forEach((t) => t.classList.toggle('active', t === tab));
    panels.forEach((panel) => panel.classList.toggle('active', panel.dataset.panel === tab.dataset.tab));
  }

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => switchTab(tab));
  });

  // Wire up "View All" / data-goto buttons
  document.querySelectorAll('[data-goto]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.goto;
      const tab = document.querySelector('.tab[data-tab="' + target + '"]');
      if (tab) switchTab(tab);
    });
  });

  // ─── Overview ───────────────────────────────────────────────────────────────
  const PERIOD_LABELS = { day: 'Today', week: 'Last 7 days', month: 'Last 30 days' };
  const PERIOD_TITLES = { day: 'Daily Overview', week: 'Weekly Overview', month: 'Monthly Overview' };

  async function fetchDashboardStats(period) {
    // Return cached data if fresh (5 min) and same period
    const now = Date.now();
    if (statsCache.data && statsCache.period === period && (now - statsCache.time) < 300000) {
      return statsCache.data;
    }

    // Build Basic auth from stored session
    const session = JSON.parse(sessionStorage.getItem('bf_admin_session') || '{}');
    const user = session.username || session.user || '';
    const hash = session.passwordHash || authPasswordHash || '';
    if (!user || !hash) throw new Error('Not authenticated');

    const authStr = btoa(user + ':' + hash);
    const res = await fetch(STATS_API + '?period=' + period, {
      headers: { 'Authorization': 'Basic ' + authStr },
    });
    if (!res.ok) throw new Error('Stats fetch failed: ' + res.status);
    const data = await res.json();
    statsCache = { data: data, time: now, period: period };
    return data;
  }

  function renderTrafficChart(dailyBreakdown) {
    const chart = $('trafficChart');
    if (!chart || !dailyBreakdown || !dailyBreakdown.length) return;

    const maxViews = Math.max(1, ...dailyBreakdown.map((d) => d.views));
    const barWidth = Math.max(12, Math.floor((chart.clientWidth - 40) / dailyBreakdown.length) - 4);

    chart.innerHTML = '<div class="chart-bars">' + dailyBreakdown.map((day) => {
      const viewH = Math.max(4, Math.round((day.views / maxViews) * 140));
      const uniqH = Math.max(2, Math.round((day.uniques / maxViews) * 140));
      const dateLabel = day.date.slice(5); // MM-DD
      return '<div class="chart-bar-group" style="width:' + barWidth + 'px">' +
        '<div class="chart-bar bar-views" style="height:' + viewH + 'px" title="' + day.views + ' views"></div>' +
        '<div class="chart-bar bar-uniques" style="height:' + uniqH + 'px" title="' + day.uniques + ' unique"></div>' +
        '<span class="chart-date">' + dateLabel + '</span>' +
      '</div>';
    }).join('') + '</div>';
  }

  async function renderOverview() {
    const visEl = $('kpiVisitors');
    if (!visEl) return;

    // Update date range display
    const now = new Date();
    const daysMap = { day: 1, week: 7, month: 30 };
    const daysBack = daysMap[currentPeriod] || 7;
    const startDate = new Date(now.getTime() - daysBack * 86400000);
    const fmt = (d) => d.toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });
    const dateRange = $('overviewDateRange');
    if (dateRange) dateRange.textContent = fmt(startDate) + ' - ' + fmt(now);
    const titleEl = $('overviewTitle');
    if (titleEl) titleEl.textContent = PERIOD_TITLES[currentPeriod] || 'Weekly Overview';
    const chartLabel = $('chartPeriodLabel');
    if (chartLabel) chartLabel.textContent = PERIOD_LABELS[currentPeriod] || 'Last 7 days';

    // Show latest inventory from local data regardless of API status
    renderLatestInventory();

    try {
      const stats = await fetchDashboardStats(currentPeriod);

      // Row 1: Traffic & Inventory
      visEl.textContent = String(stats.visitors.period);
      $('kpiVisitorsToday').textContent = String(stats.visitors.today);
      $('kpiUniques').textContent = String(stats.uniqueVisitors.period);
      $('kpiUniquesToday').textContent = String(stats.uniqueVisitors.today);
      $('kpiInventory').textContent = String(stats.carsInInventory);
      $('kpiInventoryMeta').textContent = stats.totalVehicles + ' total vehicles';
      $('kpiSold').textContent = String(stats.carsSold);
      $('kpiSoldMeta').textContent = stats.carsPending > 0 ? stats.carsPending + ' pending' : 'all time';

      // Row 2: Leads
      $('kpiLeads').textContent = String(stats.totalLeads);
      $('kpiWebLeads').textContent = String(stats.leadsFromWebsite);
      $('kpiCalls').textContent = String(stats.callsFromWebsite);
      $('kpiForms').textContent = String(stats.formsSubmitted);
      $('kpiFormsMeta').textContent = 'this ' + currentPeriod;

      // Traffic chart
      renderTrafficChart(stats.dailyBreakdown);

      // Recent activity summary
      const actEl = $('recentActivity');
      if (actEl && stats.dailyBreakdown.length) {
        const today = stats.dailyBreakdown[stats.dailyBreakdown.length - 1] || {};
        actEl.innerHTML =
          '<div class="activity-item"><strong>' + (today.views || 0) + '</strong> page views today</div>' +
          '<div class="activity-item"><strong>' + (today.uniques || 0) + '</strong> unique visitors today</div>' +
          '<div class="activity-item"><strong>' + (today.calls || 0) + '</strong> phone calls today</div>' +
          '<div class="activity-item"><strong>' + (today.forms || 0) + '</strong> forms submitted today</div>' +
          '<div class="activity-item muted" style="margin-top:8px">Data tracked via site analytics</div>';
      }

      // Top pages (from today's data - aggregate from breakdown not available, show placeholder)
      const topPagesBody = $('topPagesBody');
      if (topPagesBody) {
        // The daily breakdown doesn't include per-page data in the aggregation,
        // so show a summary of activity per day instead
        topPagesBody.innerHTML = stats.dailyBreakdown.slice(-7).reverse().map((d) => {
          return '<tr><td>' + d.date + '</td><td>' + d.views + ' views / ' + d.uniques + ' unique</td></tr>';
        }).join('') || '<tr><td colspan="2" class="muted">No data yet</td></tr>';
      }
    } catch (err) {
      console.warn('Dashboard stats unavailable:', err.message);
      // Show zero state
      ['kpiVisitors', 'kpiUniques', 'kpiInventory', 'kpiSold', 'kpiLeads', 'kpiWebLeads', 'kpiCalls', 'kpiForms'].forEach((id) => {
        const el = $(id);
        if (el) el.textContent = '-';
      });
      const chart = $('trafficChart');
      if (chart) chart.innerHTML = '<div class="chart-loading">Analytics data unavailable. Stats will appear once the site is deployed with tracking enabled.</div>';
      const topPagesBody = $('topPagesBody');
      if (topPagesBody) topPagesBody.innerHTML = '<tr><td colspan="2" class="muted">No data available</td></tr>';
      const actEl = $('recentActivity');
      if (actEl) actEl.innerHTML = '<p class="muted">Analytics will appear after deployment.</p>';
    }
  }

  function renderLatestInventory() {
    const latest = inventory[0];
    const latestModel = $('latestModel');
    const latestPrice = $('latestPrice');
    const latestFeatures = $('latestFeatures');
    if (latest && latestModel && latestPrice && latestFeatures) {
      const modelLabel = [latest.year, latest.make, latest.model, latest.trim].filter(Boolean).join(' ') || latest.name || 'Unknown';
      latestModel.textContent = modelLabel;
      latestPrice.textContent = formatMoney(latest.price);
      const featureList = Array.isArray(latest.features) && latest.features.length
        ? latest.features.slice(0, 5)
        : [latest.category || 'Vehicle', latest.engine || 'Stock', latest.transmission || 'Auto', (latest.quantity || 0) + ' in stock'];
      latestFeatures.innerHTML = featureList.map((f) => '<span class="chip">' + f + '</span>').join('');
    }
  }

  // Period toggle
  document.querySelectorAll('.period-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.period-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentPeriod = btn.dataset.period;
      statsCache = { data: null, time: 0, period: '' }; // clear cache on period change
      renderOverview();
    });
  });

  // ─── Inventory Table ────────────────────────────────────────────────────────
  function refreshExportFilter() {
    const cats = [...new Set(inventory.map((item) => item.category))].sort();
    exportFilter.innerHTML = '<option value="">All Categories</option>' + cats.map((cat) => '<option value="' + cat + '">' + cat + '</option>').join('');
  }

  function updateInventoryStatus() {
    const el = $('inventoryStatus');
    if (el) el.textContent = 'Local inventory: ' + inventory.length + ' vehicles.';
  }

  function renderInventoryTable() {
    refreshExportFilter();
    updateInventoryStatus();
    const search = $('editSearch').value.trim().toLowerCase();
    filteredInventory = inventory.filter((item) => {
      if (!search) return true;
      return [item.sku, item.name, item.category, item.supplier, item.make, item.model, item.vin].some((field) => String(field || '').toLowerCase().includes(search));
    });
    const totalPages = Math.max(1, Math.ceil(filteredInventory.length / pageSize));
    currentPage = Math.min(currentPage, totalPages);
    const start = (currentPage - 1) * pageSize;
    const pageSlice = filteredInventory.slice(start, start + pageSize);
    inventoryTableBody.innerHTML = pageSlice.map((item) => '<tr>' +
      '<td>' + item.sku + '</td>' +
      '<td>' + item.name + '</td>' +
      '<td>' + item.category + '</td>' +
      '<td><span class="status-pill status-' + (item.status || 'available') + '">' + (item.status || 'available') + '</span></td>' +
      '<td>' + item.quantity + '</td>' +
      '<td>' + formatMoney(item.price) + '</td>' +
      '<td class="table-actions">' +
        '<button class="ghost-btn" data-action="edit" data-sku="' + item.sku + '">Edit</button>' +
        '<button class="ghost-btn danger-text" data-action="delete" data-sku="' + item.sku + '">Delete</button>' +
      '</td></tr>'
    ).join('');
    $('pageInfo').textContent = 'Page ' + currentPage + ' / ' + totalPages;
  }

  // ─── Inventory Table Actions ────────────────────────────────────────────────
  function handleTableActions(event) {
    if (!event.target.matches('button')) return;
    const action = event.target.dataset.action;
    const sku = event.target.dataset.sku;
    const item = inventory.find((row) => row.sku === sku);
    if (!item) return;
    if (action === 'edit') {
      editingItem = item;
      // Basic fields
      $('editName').value = item.name || '';
      $('editSku').value = item.sku || '';
      $('editCategory').value = item.category || '';
      $('editYear').value = item.year || '';
      $('editMake').value = item.make || '';
      $('editModel').value = item.model || '';
      $('editTrim').value = item.trim || '';
      $('editVin').value = item.vin || '';
      $('editQuantity').value = item.quantity || 1;
      $('editPrice').value = item.price || '';
      $('editEngine').value = item.engine || '';
      $('editTransmission').value = item.transmission || '';
      $('editStatus').value = item.status || 'available';
      // Extended fields
      $('editStock').value = item.stockNumber || '';
      $('editMileage').value = item.mileage || '';
      $('editDrivetrain').value = item.drivetrain || '';
      $('editFuelType').value = item.fuelType || '';
      $('editMpgCity').value = item.mpgCity || '';
      $('editMpgHighway').value = item.mpgHighway || '';
      $('editExteriorColor').value = item.exteriorColor || '';
      $('editInteriorColor').value = item.interiorColor || '';
      $('editBadge').value = item.badge || '';
      $('editSupplier').value = item.supplier || '';
      $('editDescription').value = item.description || '';
      $('editFeatures').value = Array.isArray(item.features) ? item.features.join(', ') : (item.features || '');
      // Reset photo state
      editPhotoFiles = [];
      editKeptImages = item.images ? item.images.slice() : [];
      $('editPhotoPreview').innerHTML = '';
      // Show existing photos with remove buttons
      if (editKeptImages.length) {
        editKeptImages.forEach(function (url, i) {
          var div = document.createElement('div');
          div.className = 'photo-thumb';
          div.dataset.url = url;
          div.innerHTML = '<img src="' + url + '" alt="Photo ' + (i + 1) + '">' +
            '<button type="button" class="photo-remove-btn" title="Remove photo">&times;</button>' +
            '<span class="photo-label">' + (i === 0 ? 'Main' : 'Photo ' + (i + 1)) + '</span>';
          div.querySelector('.photo-remove-btn').addEventListener('click', function () {
            editKeptImages = editKeptImages.filter(function (u) { return u !== url; });
            div.remove();
          });
          $('editPhotoPreview').appendChild(div);
        });
      }
      // Reset VIN decode display
      $('editVinResult').classList.add('hide');
      editVinDecodeData = null;
      hideFeedback($('editFeedback'));
      editModal.classList.add('active');
    } else if (action === 'delete') {
      if (confirm('Delete ' + item.name + ' (' + item.sku + ')?')) {
        inventory = inventory.filter((entry) => entry.sku !== sku);
        persistInventory();
        renderInventoryTable();
        showFeedback(editFeedback, 'Item removed.');
        // Auto-publish deletion to live site
        showToast('Publishing deletion to live site...');
        autoPublish().then(function () {
          showToast('\u2713 Deleted & published! Live in ~30 seconds.', 'success');
          setTimeout(hideToast, 5000);
        }).catch(function (err) {
          showToast('Error publishing: ' + err.message, 'error');
          setTimeout(hideToast, 8000);
        });
      }
    }
  }

  async function handleEditSubmit(event) {
    event.preventDefault();
    if (!editingItem) return;

    // Disable submit button during save
    var submitBtn = event.target.querySelector('[type="submit"]');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Saving...'; }

    try {
      // Basic fields
      editingItem.name = $('editName').value.trim();
      editingItem.category = $('editCategory').value.trim();
      editingItem.year = Number($('editYear').value) || editingItem.year;
      editingItem.make = $('editMake').value.trim() || editingItem.make;
      editingItem.model = $('editModel').value.trim() || editingItem.model;
      editingItem.trim = $('editTrim').value.trim() || editingItem.trim;
      editingItem.vin = $('editVin').value.trim() || editingItem.vin;
      editingItem.quantity = Number($('editQuantity').value);
      editingItem.price = Number($('editPrice').value);
      editingItem.engine = $('editEngine').value.trim() || editingItem.engine;
      editingItem.transmission = $('editTransmission').value.trim() || editingItem.transmission;
      editingItem.status = $('editStatus').value;
      // Extended fields
      editingItem.stockNumber = $('editStock').value.trim() || editingItem.stockNumber;
      editingItem.mileage = Number($('editMileage').value) || editingItem.mileage;
      editingItem.drivetrain = $('editDrivetrain').value || editingItem.drivetrain;
      editingItem.fuelType = $('editFuelType').value || editingItem.fuelType;
      editingItem.mpgCity = Number($('editMpgCity').value) || editingItem.mpgCity;
      editingItem.mpgHighway = Number($('editMpgHighway').value) || editingItem.mpgHighway;
      editingItem.exteriorColor = $('editExteriorColor').value.trim() || editingItem.exteriorColor;
      editingItem.interiorColor = $('editInteriorColor').value.trim() || editingItem.interiorColor;
      editingItem.badge = $('editBadge').value;
      editingItem.supplier = $('editSupplier').value.trim() || editingItem.supplier;
      editingItem.description = $('editDescription').value.trim();
      var featVal = $('editFeatures').value.trim();
      editingItem.features = featVal ? featVal.split(',').map(function (f) { return f.trim(); }).filter(Boolean) : (editingItem.features || []);

      // Upload new photos to Cloudinary if any were selected
      var newImageUrls = [];
      if (editPhotoFiles.length > 0) {
        showToast('Uploading photos...');
        newImageUrls = await uploadPhotos(editPhotoFiles, function (current, total) {
          showToast('Uploading photo ' + current + ' of ' + total + '...');
        });
      }

      // Merge: kept existing images + newly uploaded images
      editingItem.images = (editKeptImages || []).concat(newImageUrls);

      // Save to localStorage
      persistInventory();
      renderInventoryTable();

      // Close modal
      editModal.classList.remove('active');

      // Auto-publish to live site
      showToast('Publishing to live site...');
      await autoPublish();
      showToast('\u2713 Saved & published! Live in ~30 seconds.', 'success');
      setTimeout(hideToast, 5000);
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
      // Only show inline feedback if modal is still open (photo upload errors)
      if (editModal.classList.contains('active')) {
        showFeedback(editFeedback, 'Save error: ' + err.message, true);
      }
      setTimeout(hideToast, 8000);
    } finally {
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Save Changes'; }
      editPhotoFiles = [];
    }
  }

  // ─── Inventory Import/Export ────────────────────────────────────────────────
  function loadInventoryFromSite() {
    showFeedback(editFeedback, 'Loading inventory from site...');
    fetch('/inventory.json')
      .then((res) => res.json())
      .then((data) => {
        const vehicles = data.vehicles || data;
        if (!Array.isArray(vehicles)) throw new Error('Invalid format');
        // Convert site format to dashboard format
        inventory = vehicles.map((v, i) => ({
          sku: v.stockNumber || v.vin || ('SITE-' + String(i + 1).padStart(3, '0')),
          name: [v.year, v.make, v.model].filter(Boolean).join(' ') || 'Vehicle',
          category: v.type || v.category || 'Vehicle',
          quantity: 1,
          price: Number(v.price) || 0,
          description: v.description || '',
          supplier: '',
          year: v.year, make: v.make, model: v.model, trim: v.trim,
          vin: v.vin, stockNumber: v.stockNumber,
          engine: v.engine, transmission: v.transmission,
          mileage: v.mileage, mpgCity: v.mpgCity, mpgHighway: v.mpgHighway,
          exteriorColor: v.exteriorColor, interiorColor: v.interiorColor,
          features: v.features || [], status: v.status || 'available',
          badge: v.badge, drivetrain: v.drivetrain, fuelType: v.fuelType,
          images: v.images,
        }));
        persistInventory();
        renderInventoryTable();
        showFeedback(editFeedback, 'Loaded ' + inventory.length + ' vehicles from site.');
      })
      .catch((err) => showFeedback(editFeedback, 'Failed to load: ' + err.message, true));
  }

  function importInventoryFile(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        const vehicles = data.vehicles || data;
        if (!Array.isArray(vehicles)) throw new Error('Invalid format');
        inventory = vehicles.map((v, i) => ({
          sku: v.stockNumber || v.sku || v.vin || ('IMP-' + String(i + 1).padStart(3, '0')),
          name: v.name || [v.year, v.make, v.model].filter(Boolean).join(' ') || 'Vehicle',
          category: v.type || v.category || 'Vehicle',
          quantity: v.quantity || 1,
          price: Number(v.price) || 0,
          description: v.description || '',
          supplier: v.supplier || '',
          year: v.year, make: v.make, model: v.model, trim: v.trim,
          vin: v.vin, stockNumber: v.stockNumber,
          engine: v.engine, transmission: v.transmission,
          mileage: v.mileage, mpgCity: v.mpgCity, mpgHighway: v.mpgHighway,
          exteriorColor: v.exteriorColor, interiorColor: v.interiorColor,
          features: v.features || [], status: v.status || 'available',
          badge: v.badge, drivetrain: v.drivetrain, fuelType: v.fuelType,
          images: v.images,
        }));
        persistInventory();
        renderInventoryTable();
        showFeedback(editFeedback, 'Imported ' + inventory.length + ' vehicles.');
      } catch (err) {
        showFeedback(editFeedback, 'Import failed: ' + err.message, true);
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  }

  function clearLocalInventory() {
    if (!confirm('Clear all local inventory data?')) return;
    inventory = [];
    persistInventory();
    renderInventoryTable();
    showFeedback(editFeedback, 'Local inventory cleared.');
  }

  // ─── Add Vehicle ────────────────────────────────────────────────────────────
  async function handleAddSubmit(event) {
    event.preventDefault();
    const name = $('addName').value.trim();
    const sku = $('addSku').value.trim();
    const category = $('addCategory').value;
    if (!name || !sku || !category) {
      showFeedback(addFeedback, 'Please fill required fields (Name, SKU, Category).', true);
      return;
    }

    // Disable submit button
    var submitBtn = event.target.querySelector('[type="submit"]');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Saving...'; }

    try {
      // Upload photos to Cloudinary if any
      var imageUrls = [];
      if (addPhotoFiles.length > 0) {
        showToast('Uploading photos...');
        imageUrls = await uploadPhotos(addPhotoFiles, function (current, total) {
          showToast('Uploading photo ' + current + ' of ' + total + '...');
        });
      }

      var vehicle = buildVehicleFromForm();
      vehicle.images = imageUrls;

      if ($('editModeBadge') && !$('editModeBadge').classList.contains('hide')) {
        // Edit mode - update existing
        const idx = inventory.findIndex((item) => item.sku === sku);
        if (idx >= 0) {
          // Keep existing images if no new ones uploaded
          if (imageUrls.length === 0 && inventory[idx].images) {
            vehicle.images = inventory[idx].images;
          }
          inventory[idx] = vehicle;
          persistInventory();
          renderInventoryTable();
          showFeedback(addFeedback, 'Vehicle updated.');
          exitEditMode();
        }
      } else {
        if (inventory.some((item) => item.sku === sku)) {
          showFeedback(addFeedback, 'SKU already exists.', true);
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Save Vehicle'; }
          return;
        }
        inventory.unshift(vehicle);
        persistInventory();
        renderInventoryTable();
        showFeedback(addFeedback, 'Vehicle saved.');
        addForm.reset();
        addPhotoFiles = [];
        if ($('photoPreview')) $('photoPreview').innerHTML = '';
      }

      // Auto-publish to live site
      showToast('Publishing to live site...');
      await autoPublish();
      showToast('\u2713 Saved & published! Live in ~30 seconds.', 'success');
      setTimeout(hideToast, 5000);
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
      showFeedback(addFeedback, 'Save error: ' + err.message, true);
      setTimeout(hideToast, 8000);
    } finally {
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Save Vehicle'; }
    }
  }

  function buildVehicleFromForm() {
    return {
      name: $('addName').value.trim(),
      sku: $('addSku').value.trim(),
      category: $('addCategory').value,
      quantity: Number($('addQuantity').value) || 1,
      price: Number($('addPrice').value) || 0,
      description: $('addDescription').value.trim(),
      supplier: $('addSupplier').value.trim(),
      year: Number($('addYear').value) || null,
      make: $('addMake').value.trim(),
      model: $('addModel').value.trim(),
      trim: $('addTrim').value.trim(),
      vin: $('addVin').value.trim(),
      stockNumber: $('addStock').value.trim(),
      engine: $('addEngine').value.trim(),
      transmission: $('addTransmission').value.trim(),
      mileage: Number($('addMileage').value) || 0,
      mpgCity: Number($('addMpgCity').value) || null,
      mpgHighway: Number($('addMpgHighway').value) || null,
      exteriorColor: $('addExteriorColor').value.trim(),
      interiorColor: $('addInteriorColor').value.trim(),
      drivetrain: $('addDrivetrain').value,
      fuelType: $('addFuelType').value,
      badge: $('addBadge').value,
      features: $('addFeatures').value.split(',').map((t) => t.trim()).filter(Boolean),
      status: $('addStatus').value,
      images: [],
    };
  }

  function enterEditMode(item) {
    $('addName').value = item.name || '';
    $('addSku').value = item.sku || '';
    $('addCategory').value = item.category || '';
    $('addYear').value = item.year || '';
    $('addMake').value = item.make || '';
    $('addModel').value = item.model || '';
    $('addTrim').value = item.trim || '';
    $('addVin').value = item.vin || '';
    $('addStock').value = item.stockNumber || '';
    $('addPrice').value = item.price || '';
    $('addMileage').value = item.mileage || '';
    $('addEngine').value = item.engine || '';
    $('addTransmission').value = item.transmission || '';
    $('addDrivetrain').value = item.drivetrain || '';
    $('addFuelType').value = item.fuelType || '';
    $('addMpgCity').value = item.mpgCity || '';
    $('addMpgHighway').value = item.mpgHighway || '';
    $('addExteriorColor').value = item.exteriorColor || '';
    $('addInteriorColor').value = item.interiorColor || '';
    $('addQuantity').value = item.quantity || 1;
    $('addStatus').value = item.status || 'available';
    $('addBadge').value = item.badge || '';
    $('addSupplier').value = item.supplier || '';
    $('addDescription').value = item.description || '';
    $('addFeatures').value = (item.features || []).join(', ');
    $('editModeBadge').classList.remove('hide');
    $('cancelEditVehicle').classList.remove('hide');
    $('submitVehicleBtn').textContent = 'Update Vehicle';
    $('addFormTitle').textContent = 'Edit Vehicle';
    const addTab = document.querySelector('.tab[data-tab="add"]');
    if (addTab) switchTab(addTab);
    updateLivePreview();
  }

  function exitEditMode() {
    $('editModeBadge').classList.add('hide');
    $('cancelEditVehicle').classList.add('hide');
    $('submitVehicleBtn').textContent = 'Save Vehicle';
    $('addFormTitle').textContent = 'Vehicle Details';
    addForm.reset();
    hideFeedback(addFeedback);
    updateLivePreview();
  }

  // ─── VIN Decoder ────────────────────────────────────────────────────────────
  async function decodeVin() {
    const vin = $('addVin').value.trim().toUpperCase();
    if (vin.length !== 17) {
      showFeedback($('vinFeedback'), 'VIN must be exactly 17 characters.', true);
      return;
    }
    hideFeedback($('vinFeedback'));
    $('decodeVinBtn').disabled = true;
    $('decodeVinBtn').textContent = 'Decoding...';

    try {
      const res = await fetch(NHTSA_API + '/' + vin + '?format=json');
      const data = await res.json();
      const result = data.Results && data.Results[0];
      if (!result || result.ErrorCode === '6') throw new Error('VIN not found');

      vinDecodeData = {
        year: result.ModelYear, make: result.Make, model: result.Model,
        trim: result.Trim, body: result.BodyClass, drive: result.DriveType,
        fuel: result.FuelTypePrimary, engine: [result.DisplacementL ? result.DisplacementL + 'L' : '', result.EngineCylinders ? 'V' + result.EngineCylinders : ''].filter(Boolean).join(' '),
      };

      $('decodedYear').textContent = vinDecodeData.year || '-';
      $('decodedMake').textContent = vinDecodeData.make || '-';
      $('decodedModel').textContent = vinDecodeData.model || '-';
      $('decodedTrim').textContent = vinDecodeData.trim || '-';
      $('decodedBody').textContent = vinDecodeData.body || '-';
      $('decodedDrive').textContent = vinDecodeData.drive || '-';
      $('decodedFuel').textContent = vinDecodeData.fuel || '-';
      $('decodedEngine').textContent = vinDecodeData.engine || '-';
      $('vinDecodeResult').classList.remove('hide');
    } catch (err) {
      showFeedback($('vinFeedback'), 'VIN decode failed: ' + err.message, true);
    } finally {
      $('decodeVinBtn').disabled = false;
      $('decodeVinBtn').textContent = 'Decode VIN';
    }
  }

  function applyVinData() {
    if (!vinDecodeData) return;
    if (vinDecodeData.year) $('addYear').value = vinDecodeData.year;
    if (vinDecodeData.make) $('addMake').value = vinDecodeData.make;
    if (vinDecodeData.model) $('addModel').value = vinDecodeData.model;
    if (vinDecodeData.trim) $('addTrim').value = vinDecodeData.trim;
    if (vinDecodeData.engine) $('addEngine').value = vinDecodeData.engine;
    if (vinDecodeData.fuel) {
      const fuelMap = { Gasoline: 'Gasoline', Diesel: 'Diesel', Electric: 'Electric', Hybrid: 'Hybrid' };
      const match = Object.keys(fuelMap).find((k) => (vinDecodeData.fuel || '').includes(k));
      if (match) $('addFuelType').value = fuelMap[match];
    }
    if (vinDecodeData.drive) {
      const driveMap = { '4WD': '4WD', 'AWD': 'AWD', 'FWD': 'FWD', 'RWD': 'RWD', '4x4': '4WD', '4X4': '4WD' };
      const match = Object.keys(driveMap).find((k) => (vinDecodeData.drive || '').includes(k));
      if (match) $('addDrivetrain').value = driveMap[match];
    }
    // Auto-generate name and SKU
    const autoName = [vinDecodeData.year, vinDecodeData.make, vinDecodeData.model].filter(Boolean).join(' ');
    if (autoName && !$('addName').value) $('addName').value = autoName;
    if (!$('addSku').value) {
      const stock = $('addStock').value.trim();
      $('addSku').value = stock || ('BF-' + String(inventory.length + 1).padStart(3, '0'));
    }
    updateLivePreview();
  }

  // ─── Live Preview ───────────────────────────────────────────────────────────
  function updateLivePreview() {
    const preview = $('vehiclePreview');
    if (!preview) return;
    const year = $('addYear').value;
    const make = $('addMake').value;
    const model = $('addModel').value;
    const price = $('addPrice').value;
    const mileage = $('addMileage').value;
    const status = $('addStatus').value;

    if (!make && !model && !year) {
      preview.innerHTML = '<p class="muted">Fill in details to see preview</p>';
      preview.className = 'preview-placeholder';
      return;
    }

    const title = [year, make, model, $('addTrim').value].filter(Boolean).join(' ');
    const features = $('addFeatures').value.split(',').map((t) => t.trim()).filter(Boolean);
    const badge = $('addBadge').value;

    preview.className = 'preview-card-render';
    preview.innerHTML =
      '<div class="preview-img-placeholder"></div>' +
      (badge ? '<div class="preview-badge">' + badge + '</div>' : '') +
      '<div class="preview-body">' +
        '<div class="preview-title">' + title + '</div>' +
        '<div class="preview-price">' + formatMoney(price) + '</div>' +
        '<div class="preview-meta">' +
          (mileage ? '<span>' + Number(mileage).toLocaleString() + ' mi</span>' : '') +
          ($('addEngine').value ? '<span>' + $('addEngine').value + '</span>' : '') +
          ($('addTransmission').value ? '<span>' + $('addTransmission').value + '</span>' : '') +
        '</div>' +
        '<div class="preview-status status-' + status + '">' + status + '</div>' +
        (features.length ? '<div class="chip-row">' + features.map((f) => '<span class="chip">' + f + '</span>').join('') + '</div>' : '') +
      '</div>';
  }

  // ─── AI Description ─────────────────────────────────────────────────────────
  async function generateAIDescription() {
    const apiKey = localStorage.getItem('bf_openai_key');
    if (!apiKey) {
      showFeedback(addFeedback, 'Set your OpenAI API key in Settings first.', true);
      return;
    }
    const year = $('addYear').value;
    const make = $('addMake').value;
    const model = $('addModel').value;
    const trim = $('addTrim').value;
    const engine = $('addEngine').value;
    const mileage = $('addMileage').value;
    const features = $('addFeatures').value;

    if (!make || !model) {
      showFeedback(addFeedback, 'Enter at least Make and Model first.', true);
      return;
    }

    $('generateDescBtn').disabled = true;
    $('generateDescBtn').textContent = 'Generating...';

    try {
      const prompt = 'Write a brief 2-sentence used car listing description for a ' +
        [year, make, model, trim].filter(Boolean).join(' ') +
        (engine ? ' with ' + engine + ' engine' : '') +
        (mileage ? ', ' + Number(mileage).toLocaleString() + ' miles' : '') +
        (features ? '. Features: ' + features : '') +
        '. Keep it professional and appealing for a dealership website.';

      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
        body: JSON.stringify({
          model: 'gpt-3.5-turbo', max_tokens: 120,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      const data = await res.json();
      if (data.choices && data.choices[0]) {
        $('addDescription').value = data.choices[0].message.content.trim();
        updateLivePreview();
      }
    } catch (err) {
      showFeedback(addFeedback, 'AI generation failed: ' + err.message, true);
    } finally {
      $('generateDescBtn').disabled = false;
      $('generateDescBtn').textContent = 'Generate with AI';
    }
  }

  // ─── Photo Handling ─────────────────────────────────────────────────────────
  function handlePhotoSelect(event) {
    const files = event.target.files;
    if (!files || !files.length) return;
    addPhotoFiles = Array.from(files).slice(0, 10);
    const preview = $('photoPreview');
    preview.innerHTML = '';
    addPhotoFiles.forEach((file, i) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const div = document.createElement('div');
        div.className = 'photo-thumb';
        div.innerHTML = '<img src="' + e.target.result + '" alt="Photo ' + (i + 1) + '">' +
          '<span class="photo-label">' + (i === 0 ? 'Main' : 'Photo ' + (i + 1)) + '</span>';
        preview.appendChild(div);
      };
      reader.readAsDataURL(file);
    });
  }

  // ─── Edit Modal: VIN Decoder ────────────────────────────────────────────────
  async function editDecodeVin() {
    var vin = $('editVin').value.trim().toUpperCase();
    if (vin.length !== 17) {
      showFeedback($('editFeedback'), 'VIN must be exactly 17 characters.', true);
      return;
    }
    hideFeedback($('editFeedback'));
    $('editDecodeVinBtn').disabled = true;
    $('editDecodeVinBtn').textContent = 'Decoding...';

    try {
      var res = await fetch(NHTSA_API + '/' + vin + '?format=json');
      var data = await res.json();
      var result = data.Results && data.Results[0];
      if (!result || result.ErrorCode === '6') throw new Error('VIN not found');

      editVinDecodeData = {
        year: result.ModelYear, make: result.Make, model: result.Model,
        trim: result.Trim, body: result.BodyClass, drive: result.DriveType,
        fuel: result.FuelTypePrimary,
        engine: [result.DisplacementL ? result.DisplacementL + 'L' : '', result.EngineCylinders ? 'V' + result.EngineCylinders : ''].filter(Boolean).join(' '),
        transmission: result.TransmissionStyle || '',
      };

      $('editDecodedYear').textContent = editVinDecodeData.year || '-';
      $('editDecodedMake').textContent = editVinDecodeData.make || '-';
      $('editDecodedModel').textContent = editVinDecodeData.model || '-';
      $('editDecodedTrim').textContent = editVinDecodeData.trim || '-';
      $('editDecodedBody').textContent = editVinDecodeData.body || '-';
      $('editDecodedDrive').textContent = editVinDecodeData.drive || '-';
      $('editDecodedFuel').textContent = editVinDecodeData.fuel || '-';
      $('editDecodedEngine').textContent = editVinDecodeData.engine || '-';
      $('editVinResult').classList.remove('hide');
    } catch (err) {
      showFeedback($('editFeedback'), 'VIN decode failed: ' + err.message, true);
    } finally {
      $('editDecodeVinBtn').disabled = false;
      $('editDecodeVinBtn').textContent = 'Decode';
    }
  }

  function editApplyVinData() {
    if (!editVinDecodeData) return;
    if (editVinDecodeData.year) $('editYear').value = editVinDecodeData.year;
    if (editVinDecodeData.make) $('editMake').value = editVinDecodeData.make;
    if (editVinDecodeData.model) $('editModel').value = editVinDecodeData.model;
    if (editVinDecodeData.trim) $('editTrim').value = editVinDecodeData.trim;
    if (editVinDecodeData.engine) $('editEngine').value = editVinDecodeData.engine;
    if (editVinDecodeData.transmission) $('editTransmission').value = editVinDecodeData.transmission;
    if (editVinDecodeData.fuel) {
      var fuelMap = { Gasoline: 'Gasoline', Diesel: 'Diesel', Electric: 'Electric', Hybrid: 'Hybrid' };
      var match = Object.keys(fuelMap).find(function (k) { return (editVinDecodeData.fuel || '').includes(k); });
      if (match) $('editFuelType').value = fuelMap[match];
    }
    if (editVinDecodeData.drive) {
      var driveMap = { '4WD': '4WD', 'AWD': 'AWD', 'FWD': 'FWD', 'RWD': 'RWD', '4x4': '4WD', '4X4': '4WD' };
      var match2 = Object.keys(driveMap).find(function (k) { return (editVinDecodeData.drive || '').includes(k); });
      if (match2) $('editDrivetrain').value = driveMap[match2];
    }
    // Auto-fill name if empty
    var autoName = [editVinDecodeData.year, editVinDecodeData.make, editVinDecodeData.model].filter(Boolean).join(' ');
    if (autoName && !$('editName').value) $('editName').value = autoName;
    showFeedback($('editFeedback'), 'VIN data applied to form.');
  }

  // ─── Edit Modal: AI Description ───────────────────────────────────────────
  async function editGenerateDescription() {
    var apiKey = localStorage.getItem('bf_openai_key');
    if (!apiKey) {
      showFeedback($('editFeedback'), 'Set your OpenAI API key in Settings first.', true);
      return;
    }
    var year = $('editYear').value;
    var make = $('editMake').value;
    var model = $('editModel').value;
    var trim2 = $('editTrim').value;
    var engine = $('editEngine').value;
    var mileage = $('editMileage').value;
    var features = $('editFeatures').value;

    if (!make || !model) {
      showFeedback($('editFeedback'), 'Enter at least Make and Model first.', true);
      return;
    }

    $('editGenDescBtn').disabled = true;
    $('editGenDescBtn').textContent = 'Generating...';

    try {
      var prompt = 'Write a brief 2-sentence used car listing description for a ' +
        [year, make, model, trim2].filter(Boolean).join(' ') +
        (engine ? ' with ' + engine + ' engine' : '') +
        (mileage ? ', ' + Number(mileage).toLocaleString() + ' miles' : '') +
        (features ? '. Features: ' + features : '') +
        '. Keep it professional and appealing for a dealership website.';

      var res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
        body: JSON.stringify({
          model: 'gpt-3.5-turbo', max_tokens: 120,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      var data = await res.json();
      if (data.choices && data.choices[0]) {
        $('editDescription').value = data.choices[0].message.content.trim();
        showFeedback($('editFeedback'), 'AI description generated.');
      }
    } catch (err) {
      showFeedback($('editFeedback'), 'AI generation failed: ' + err.message, true);
    } finally {
      $('editGenDescBtn').disabled = false;
      $('editGenDescBtn').textContent = 'Generate with AI';
    }
  }

  // ─── Edit Modal: Master AI Button ─────────────────────────────────────────
  async function editMasterAI() {
    var btn = $('editAiMasterBtn');
    btn.disabled = true;
    btn.textContent = '⏳ Working...';
    hideFeedback($('editFeedback'));

    try {
      // Step 1: Decode VIN if available
      var vin = $('editVin').value.trim().toUpperCase();
      if (vin.length === 17) {
        await editDecodeVin();
        if (editVinDecodeData) editApplyVinData();
      }

      // Step 2: Generate AI description
      var apiKey = localStorage.getItem('bf_openai_key');
      var make = $('editMake').value;
      var model = $('editModel').value;
      if (apiKey && make && model) {
        await editGenerateDescription();
      } else if (!apiKey) {
        showFeedback($('editFeedback'), 'VIN decoded. Set OpenAI key in Settings to also generate descriptions.', false);
      } else {
        showFeedback($('editFeedback'), 'VIN decoded and applied. Need Make & Model for AI description.', false);
      }
    } catch (err) {
      showFeedback($('editFeedback'), 'AI generate error: ' + err.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = '⚡ Generate with AI';
    }
  }

  // ─── Edit Modal: Photo Handling ───────────────────────────────────────────
  function editHandlePhotoSelect(event) {
    var files = event.target.files;
    if (!files || !files.length) return;
    var preview = $('editPhotoPreview');
    preview.innerHTML = '';
    editPhotoFiles = Array.from(files).slice(0, 10);
    editPhotoFiles.forEach(function (file, i) {
      var reader = new FileReader();
      reader.onload = function (e) {
        var div = document.createElement('div');
        div.className = 'photo-thumb';
        div.innerHTML = '<img src="' + e.target.result + '" alt="Photo ' + (i + 1) + '">' +
          '<span class="photo-label">' + (i === 0 ? 'Main' : 'Photo ' + (i + 1)) + '</span>';
        preview.appendChild(div);
      };
      reader.readAsDataURL(file);
    });
  }

  function setupEditPhotoDrop() {
    var dropZone = $('editPhotoDrop');
    var fileInput = $('editPhotos');
    if (!dropZone || !fileInput) return;

    dropZone.addEventListener('click', function () { fileInput.click(); });
    dropZone.addEventListener('dragover', function (e) { e.preventDefault(); dropZone.classList.add('drag-active'); });
    dropZone.addEventListener('dragleave', function () { dropZone.classList.remove('drag-active'); });
    dropZone.addEventListener('drop', function (e) {
      e.preventDefault();
      dropZone.classList.remove('drag-active');
      if (e.dataTransfer.files.length) {
        fileInput.files = e.dataTransfer.files;
        editHandlePhotoSelect({ target: fileInput });
      }
    });
  }

  // ─── Bulk Actions ───────────────────────────────────────────────────────────
  function downloadTemplate() {
    const template = 'SKU,Item Name,Category,Quantity,Price,Description,Supplier\n';
    const blob = new Blob([template], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'inventory-template.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  function handleBulkUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    showFeedback(bulkFeedback, 'Parsing file...');
    const reader = new FileReader();
    reader.onload = () => {
      const lines = reader.result.split(/\r?\n/).slice(1);
      let added = 0;
      lines.forEach((line) => {
        const [sku, name, category, quantity, price, description, supplier] = line.split(',');
        if (sku && !inventory.some((row) => row.sku === sku.trim())) {
          inventory.unshift({
            sku: sku.trim(), name: (name || '').trim() || 'Imported item',
            category: (category || '').trim() || 'Misc',
            quantity: Number(quantity) || 0, price: Number(price) || 0,
            description: (description || '').trim(), supplier: (supplier || '').trim(),
            status: 'available', features: [],
          });
          added++;
        }
      });
      persistInventory();
      renderInventoryTable();
      showFeedback(bulkFeedback, 'Bulk import completed. ' + added + ' items added.');
    };
    reader.readAsText(file);
    event.target.value = '';
  }

  function exportInventory() {
    const filterCat = exportFilter.value;
    const list = filterCat ? inventory.filter((item) => item.category === filterCat) : inventory;
    const rows = list.map((item) => [item.sku, item.name, item.category, item.quantity, item.price, item.description, item.supplier].join(','));
    const csv = ['SKU,Name,Category,Quantity,Price,Description,Supplier', ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'inventory-export.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  function exportInventoryJSON() {
    const vehicles = inventory.map((item) => ({
      vin: item.vin, stockNumber: item.stockNumber || item.sku,
      year: item.year, make: item.make, model: item.model, trim: item.trim,
      engine: item.engine, transmission: item.transmission,
      drivetrain: item.drivetrain, fuelType: item.fuelType,
      mpgCity: item.mpgCity, mpgHighway: item.mpgHighway,
      mileage: item.mileage, price: item.price,
      type: item.category, exteriorColor: item.exteriorColor,
      interiorColor: item.interiorColor, description: item.description,
      features: item.features, status: item.status,
      badge: item.badge, images: item.images || [],
      dateAdded: new Date().toISOString().split('T')[0],
    }));
    const json = JSON.stringify({ vehicles, lastUpdated: new Date().toISOString() }, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'inventory.json'; a.click();
    URL.revokeObjectURL(url);
  }

  function handleMassUpdate() {
    const percent = Number($('massPrice').value) || 0;
    const category = $('massCategory').value.trim();
    showFeedback(bulkFeedback, 'Applying updates...');
    let progress = 0;
    const step = () => {
      progress += 10;
      bulkProgress.style.width = progress + '%';
      if (progress >= 100) {
        const targetSKUs = new Set((filteredInventory.length ? filteredInventory : inventory).map((item) => item.sku));
        inventory = inventory.map((item) => {
          const updated = { ...item };
          if (!targetSKUs.has(item.sku)) return updated;
          if (percent) updated.price = Math.max(0, updated.price + (updated.price * percent) / 100);
          if (category) updated.category = category;
          return updated;
        });
        persistInventory();
        renderInventoryTable();
        showFeedback(bulkFeedback, 'Mass update applied.');
        setTimeout(() => (bulkProgress.style.width = '0%'), 400);
        return;
      }
      setTimeout(step, 120);
    };
    step();
  }

  // ─── Publish Pipeline ───────────────────────────────────────────────────────
  function setupPublishDropZone() {
    const dropZone = $('publishDropZone');
    const fileInput = $('publishFileInput');

    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-active'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-active'));
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('drag-active');
      if (e.dataTransfer.files[0]) handlePublishFile(e.dataTransfer.files[0]);
    });
    fileInput.addEventListener('change', () => {
      if (fileInput.files[0]) handlePublishFile(fileInput.files[0]);
    });
  }

  function handlePublishFile(file) {
    hideFeedback($('publishParseStatus'));
    if (!file.name.endsWith('.json')) {
      showFeedback($('publishParseStatus'), 'Please upload a .json file.', true);
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (!data.vehicles || !Array.isArray(data.vehicles)) throw new Error('Missing "vehicles" array');
        parsedPublishInventory = data;
        $('publishDropLabel').innerHTML = '<strong>&#10003; ' + file.name + ' loaded</strong>';
        dropZone.classList.add('file-ready');
        $('pubBadge1').classList.add('done');
        showFeedback($('publishParseStatus'), data.vehicles.length + ' vehicles found.');
        renderPublishReview(data);
      } catch (err) {
        showFeedback($('publishParseStatus'), 'Parse error: ' + err.message, true);
      }
    };
    reader.readAsText(file);
  }

  function renderPublishReview(data) {
    const vehicles = data.vehicles;
    const priced = vehicles.filter((v) => v.price && Number(v.price) > 0).length;
    const types = {};
    vehicles.forEach((v) => { types[v.type || 'unknown'] = (types[v.type || 'unknown'] || 0) + 1; });

    $('publishReviewStats').innerHTML =
      '<div class="stat-card"><div class="stat-value">' + vehicles.length + '</div><div class="muted">Total</div></div>' +
      '<div class="stat-card"><div class="stat-value">' + priced + '</div><div class="muted">Priced</div></div>' +
      '<div class="stat-card"><div class="stat-value">' + (vehicles.length - priced) + '</div><div class="muted">TBD</div></div>' +
      '<div class="stat-card"><div class="stat-value">' + Object.keys(types).length + '</div><div class="muted">Types</div></div>';

    $('publishVehicleTable').innerHTML = vehicles.map((v) =>
      '<tr><td>' + (v.year || '-') + '</td><td>' + (v.make || '-') + '</td><td>' + (v.model || '-') + '</td>' +
      '<td>' + (v.stockNumber || v.vin || '-') + '</td>' +
      '<td>' + (v.price ? formatMoney(v.price) : 'TBD') + '</td>' +
      '<td><span class="status-pill status-' + (v.status || 'available') + '">' + (v.status || 'unknown') + '</span></td></tr>'
    ).join('');

    $('publishReviewSection').classList.remove('hide');
    $('pubBadge2').classList.add('done');
  }

  async function stageInventory() {
    if (!parsedPublishInventory) return;
    const session = JSON.parse(sessionStorage.getItem('bf_admin_session') || '{}');
    $('stageBtn').disabled = true;
    $('stageBtn').textContent = 'Staging...';
    hideFeedback($('publishStageStatus'));

    try {
      const res = await fetch(STAGE_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          auth: { user: session.username, passwordHash: session.passwordHash || authPasswordHash },
          inventory: parsedPublishInventory,
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Stage failed');

      const { diff, count, stagedAt, stagedBy } = result;
      if (diff && (diff.added.length > 0 || diff.removed.length > 0)) {
        $('publishDiffSection').classList.remove('hide');
        $('publishAddedList').innerHTML = diff.added.length > 0
          ? '<strong>+ ' + diff.added.length + ' added:</strong><br>' + diff.added.map((x) => '&bull; ' + x).join('<br>')
          : '';
        $('publishRemovedList').innerHTML = diff.removed.length > 0
          ? '<strong>- ' + diff.removed.length + ' removed:</strong><br>' + diff.removed.map((x) => '&bull; ' + x).join('<br>')
          : '';
      }

      showFeedback($('publishStageStatus'), 'Staged! ' + count + ' vehicles ready to publish.');
      $('pubBadge3').classList.add('done');
      $('publishCommitSection').classList.remove('hide');
      $('publishStageInfo').textContent = count + ' vehicles \u00b7 Staged by ' + stagedBy + ' \u00b7 ' + new Date(stagedAt).toLocaleString();
    } catch (err) {
      showFeedback($('publishStageStatus'), err.message, true);
    } finally {
      $('stageBtn').disabled = false;
      $('stageBtn').textContent = 'Stage for Review';
    }
  }

  async function publishInventory() {
    const session = JSON.parse(sessionStorage.getItem('bf_admin_session') || '{}');
    $('publishBtn').disabled = true;
    $('publishBtn').textContent = 'Publishing...';
    hideFeedback($('publishCommitStatus'));

    try {
      const res = await fetch(PUBLISH_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          auth: { user: session.username, passwordHash: session.passwordHash || authPasswordHash },
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Publish failed');

      $('publishZone').classList.add('published');
      $('publishBtn').textContent = '\u2713 Published!';
      showFeedback($('publishCommitStatus'),
        'Published! ' + result.count + ' vehicles committed.' +
        (result.commitSha ? ' Commit: ' + result.commitSha.slice(0, 7) : ''));
    } catch (err) {
      showFeedback($('publishCommitStatus'), err.message, true);
      $('publishBtn').disabled = false;
      $('publishBtn').textContent = 'Publish Inventory Live';
    }
  }

  // ─── Blog CMS ───────────────────────────────────────────────────────────────
  function initQuillEditor() {
    if (quillEditor) return;
    quillEditor = new Quill('#quillEditor', {
      theme: 'snow',
      placeholder: 'Write your post content...',
      modules: {
        toolbar: [
          [{ header: [2, 3, false] }],
          ['bold', 'italic', 'underline', 'link'],
          [{ list: 'ordered' }, { list: 'bullet' }],
          ['blockquote', 'code-block'],
          ['image', 'clean'],
        ],
      },
    });
  }

  function renderBlogList() {
    const container = $('blogList');
    if (!blogPosts.length) {
      container.innerHTML = '<p class="muted">' + (blogToken ? 'No posts yet.' : 'Sign in to load posts.') + '</p>';
      return;
    }
    const search = $('blogSearch').value.trim().toLowerCase();
    const filter = $('blogFilter').value;
    const list = blogPosts.filter((post) => {
      const matchesSearch = [post.title, post.category, (post.tags || []).join(' ')].some((field) => String(field || '').toLowerCase().includes(search));
      return matchesSearch && (filter ? post.status === filter : true);
    });
    if (!list.length) {
      container.innerHTML = '<p class="muted">No posts match the filter.</p>';
      return;
    }
    container.innerHTML = list.map((post) => '<div class="blog-item">' +
      '<div><strong>' + post.title + '</strong>' +
      '<div class="muted">' + (post.category || 'General') + ' \u2022 ' + post.status + ' \u2022 ' + (post.publishedAt ? new Date(post.publishedAt).toLocaleDateString() : 'TBD') + '</div></div>' +
      '<button class="ghost-btn" data-slug="' + post.slug + '" data-action="edit-blog">Edit</button></div>'
    ).join('');

    container.querySelectorAll('button').forEach((button) => {
      button.addEventListener('click', async () => {
        const slug = button.dataset.slug;
        try {
          const post = await blogAdminRequest('?action=admin-get&slug=' + encodeURIComponent(slug));
          applyBlogPostToForm(post);
        } catch (err) {
          const cached = blogPosts.find((p) => p.slug === slug);
          if (cached) applyBlogPostToForm(cached);
        }
      });
    });
  }

  function applyBlogPostToForm(post) {
    currentBlogSlug = post.slug || '';
    $('blogTitle').value = post.title || '';
    $('blogSlug').value = post.slug || '';
    $('blogAuthor').value = post.author || '';
    $('blogCategory').value = post.category || 'Updates';
    $('blogTags').value = (post.tags || []).join(', ');
    $('blogDate').value = post.publishedAt ? post.publishedAt.split('T')[0] : '';
    $('blogStatus').value = post.status || 'draft';
    $('blogImage').value = post.featuredImage || '';
    $('blogExcerpt').value = post.excerpt || '';
    $('blogMeta').value = post.metaDescription || '';
    if (quillEditor) quillEditor.root.innerHTML = post.content || '';
    $('blogStatusLine').textContent = 'Editing: ' + post.title;
  }

  function resetBlogForm() {
    currentBlogSlug = '';
    $('blogTitle').value = '';
    $('blogSlug').value = '';
    $('blogAuthor').value = '';
    $('blogCategory').value = '';
    $('blogTags').value = '';
    $('blogDate').value = '';
    $('blogStatus').value = 'draft';
    $('blogImage').value = '';
    $('blogExcerpt').value = '';
    $('blogMeta').value = '';
    if (quillEditor) quillEditor.root.innerHTML = '';
    $('blogStatusLine').textContent = '';
  }

  async function loadBlogPosts() {
    try {
      const posts = await blogAdminRequest('?action=admin-list');
      blogPosts = Array.isArray(posts) ? posts : [];
      renderBlogList();
    } catch (err) {
      $('blogStatusLine').textContent = 'Unable to load posts: ' + err.message;
      blogPosts = [];
      renderBlogList();
    }
  }

  async function saveBlogPost() {
    if (!blogToken) {
      $('blogStatusLine').textContent = 'Sign in to publish posts.';
      return;
    }
    const title = $('blogTitle').value.trim();
    if (!title) {
      $('blogStatusLine').textContent = 'Title is required.';
      return;
    }
    const status = $('blogStatus').value;
    const content = quillEditor ? quillEditor.root.innerHTML.trim() : '<p>No content</p>';
    const textSnapshot = document.createElement('div');
    textSnapshot.innerHTML = content;
    const cleanText = textSnapshot.textContent.trim();
    const excerpt = $('blogExcerpt').value.trim() || (cleanText ? cleanText.slice(0, 220) + '...' : '');

    const slugInput = $('blogSlug').value.trim();
    const payload = {
      slug: slugify(slugInput || title),
      title, content,
      category: $('blogCategory').value.trim() || 'Updates',
      tags: $('blogTags').value.split(',').map((t) => t.trim()).filter(Boolean),
      status,
      publishedAt: status === 'published' ? ($('blogDate').value || new Date().toISOString()) : null,
      featuredImage: $('blogImage').value.trim(),
      author: $('blogAuthor').value.trim() || blogUser || 'Admin',
      excerpt,
      metaDescription: $('blogMeta').value.trim() || excerpt,
    };

    $('blogStatusLine').textContent = 'Saving...';
    try {
      const saved = await blogAdminRequest('', { method: 'POST', body: JSON.stringify(payload) });
      currentBlogSlug = saved.slug;
      $('blogSlug').value = saved.slug;
      $('blogStatusLine').textContent = 'Post ' + status + ' successfully.';
      await loadBlogPosts();
    } catch (err) {
      $('blogStatusLine').textContent = 'Save failed: ' + err.message;
    }
  }

  async function deleteBlogPost() {
    const slug = (currentBlogSlug || $('blogSlug').value || '').trim();
    if (!slug) return;
    if (!confirm('Delete post "' + slug + '"?')) return;
    $('blogStatusLine').textContent = 'Deleting...';
    try {
      await blogAdminRequest('?slug=' + encodeURIComponent(slug), { method: 'DELETE' });
      resetBlogForm();
      $('blogStatusLine').textContent = 'Post deleted.';
      await loadBlogPosts();
    } catch (err) {
      $('blogStatusLine').textContent = 'Delete failed: ' + err.message;
    }
  }

  function previewBlog() {
    const title = $('blogTitle').value;
    const body = quillEditor ? quillEditor.root.innerHTML : '<p>No content yet.</p>';
    previewTitle.textContent = title || 'Untitled';
    previewContent.innerHTML = body;
    previewModal.classList.add('active');
  }

  function handleBlogImageUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (blogToken) {
      // Upload to Netlify Blobs
      $('blogStatusLine').textContent = 'Uploading image...';
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const result = await blogAdminRequest('?action=upload-image', {
            method: 'POST',
            body: JSON.stringify({ filename: file.name, dataUrl: reader.result }),
          });
          $('blogImage').value = result.url;
          $('blogStatusLine').textContent = 'Image uploaded.';
        } catch (err) {
          $('blogStatusLine').textContent = 'Upload failed: ' + err.message;
        }
      };
      reader.readAsDataURL(file);
    } else {
      // Fallback: use data URL
      const reader = new FileReader();
      reader.onload = () => { $('blogImage').value = reader.result; };
      reader.readAsDataURL(file);
    }
    event.target.value = '';
  }

  // Auto-generate slug from title
  function setupBlogSlugGen() {
    $('blogTitle').addEventListener('input', () => {
      if (!currentBlogSlug) {
        $('blogSlug').value = slugify($('blogTitle').value);
      }
    });
  }

  // ─── Comment Moderation ─────────────────────────────────────────────────────
  async function loadBlogComments() {
    if (!blogToken) return;
    try {
      const comments = await blogAdminRequest('?action=admin-comments');
      blogComments = Array.isArray(comments) ? comments : [];
      renderComments();
    } catch (err) {
      blogComments = [];
      renderComments();
    }
  }

  function renderComments() {
    const tbody = $('commentTableBody');
    if (!blogComments.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="muted">No comments yet.</td></tr>';
      return;
    }
    tbody.innerHTML = blogComments.map((c) =>
      '<tr>' +
      '<td>' + (c.slug || '-') + '</td>' +
      '<td>' + (c.name || 'Anonymous') + '</td>' +
      '<td class="comment-text">' + String(c.content || '').slice(0, 120) + '</td>' +
      '<td><span class="status-pill status-' + (c.status || 'pending') + '">' + (c.status || 'pending') + '</span></td>' +
      '<td class="muted">' + (c.createdAt ? new Date(c.createdAt).toLocaleDateString() : '-') + '</td>' +
      '<td class="table-actions">' +
        '<button class="ghost-btn" data-action="approve" data-id="' + c.id + '" data-slug="' + c.slug + '">Approve</button>' +
        '<button class="ghost-btn danger-text" data-action="delete-comment" data-id="' + c.id + '" data-slug="' + c.slug + '">Delete</button>' +
      '</td></tr>'
    ).join('');

    tbody.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const action = btn.dataset.action;
        const id = btn.dataset.id;
        const slug = btn.dataset.slug;
        const status = action === 'approve' ? 'approved' : 'deleted';
        try {
          await blogAdminRequest('?action=comment-moderate', {
            method: 'POST',
            body: JSON.stringify({ slug, id, status }),
          });
          await loadBlogComments();
        } catch (err) {
          // silently fail
        }
      });
    });
  }

  // ─── Settings ───────────────────────────────────────────────────────────────
  function loadSettings() {
    const openaiKey = localStorage.getItem('bf_openai_key') || '';
    const cloudName = localStorage.getItem('bf_cloud_name') || '';
    const cloudPreset = localStorage.getItem('bf_cloud_preset') || '';
    if ($('settingsOpenaiKey')) $('settingsOpenaiKey').value = openaiKey ? '********' : '';
    if ($('settingsCloudName')) $('settingsCloudName').value = cloudName;
    if ($('settingsCloudPreset')) $('settingsCloudPreset').value = cloudPreset;
  }

  function saveOpenaiKey() {
    const key = $('settingsOpenaiKey').value.trim();
    if (key && !key.startsWith('*')) {
      localStorage.setItem('bf_openai_key', key);
      $('settingsOpenaiKey').value = '********';
      alert('OpenAI key saved.');
    }
  }

  function saveCloudinarySettings() {
    const name = $('settingsCloudName').value.trim();
    const preset = $('settingsCloudPreset').value.trim();
    if (name) localStorage.setItem('bf_cloud_name', name);
    if (preset) localStorage.setItem('bf_cloud_preset', preset);
    showFeedback($('settingsCloudStatus'), 'Cloudinary settings saved.');
  }

  // ─── Modal Close ────────────────────────────────────────────────────────────
  function closeModals(event) {
    if (event.target.matches('.modal') || event.target.dataset.close !== undefined) {
      document.querySelectorAll('.modal').forEach((modal) => modal.classList.remove('active'));
    }
  }

  // ─── Init ───────────────────────────────────────────────────────────────────
  function init() {
    // Auth
    loginForm.addEventListener('submit', handleLogin);
    logoutBtn.addEventListener('click', () => {
      blogToken = '';
      blogUser = '';
      authPasswordHash = '';
      sessionStorage.removeItem('bf_admin_session');
      toggleAuth(false);
    });

    // Inventory table
    $('inventoryTable').addEventListener('click', handleTableActions);
    $('editForm').addEventListener('submit', handleEditSubmit);
    $('cancelEdit').addEventListener('click', () => editModal.classList.remove('active'));
    $('editSearch').addEventListener('input', () => { currentPage = 1; renderInventoryTable(); });
    $('prevPage').addEventListener('click', () => { currentPage = Math.max(1, currentPage - 1); renderInventoryTable(); });
    $('nextPage').addEventListener('click', () => {
      const totalPages = Math.max(1, Math.ceil(filteredInventory.length / pageSize));
      currentPage = Math.min(totalPages, currentPage + 1);
      renderInventoryTable();
    });

    // Edit modal — VIN, AI, photos
    $('editDecodeVinBtn').addEventListener('click', editDecodeVin);
    $('editApplyVinBtn').addEventListener('click', editApplyVinData);
    $('editGenDescBtn').addEventListener('click', editGenerateDescription);
    $('editAiMasterBtn').addEventListener('click', editMasterAI);
    $('editPhotos').addEventListener('change', editHandlePhotoSelect);
    $('editVin').addEventListener('input', function () { this.value = this.value.toUpperCase(); });
    setupEditPhotoDrop();

    // Inventory import/export
    $('loadFromSiteBtn').addEventListener('click', loadInventoryFromSite);
    $('importInventoryFile').addEventListener('change', importInventoryFile);
    $('clearLocalBtn').addEventListener('click', clearLocalInventory);

    // Add Vehicle
    addForm.addEventListener('submit', handleAddSubmit);
    $('clearAdd').addEventListener('click', () => { addForm.reset(); hideFeedback(addFeedback); updateLivePreview(); });
    $('cancelEditVehicle').addEventListener('click', exitEditMode);
    $('decodeVinBtn').addEventListener('click', decodeVin);
    $('applyVinBtn').addEventListener('click', applyVinData);
    $('addVin').addEventListener('input', function () { this.value = this.value.toUpperCase(); });
    $('generateDescBtn').addEventListener('click', generateAIDescription);
    $('addPhotos').addEventListener('change', handlePhotoSelect);

    // Live preview updates
    ['addYear', 'addMake', 'addModel', 'addTrim', 'addPrice', 'addMileage',
     'addEngine', 'addTransmission', 'addStatus', 'addBadge', 'addFeatures'].forEach((id) => {
      const el = $(id);
      if (el) el.addEventListener('input', updateLivePreview);
      if (el) el.addEventListener('change', updateLivePreview);
    });

    // Bulk actions
    $('bulkUpload').addEventListener('change', handleBulkUpload);
    $('downloadTemplate').addEventListener('click', downloadTemplate);
    $('exportBtn').addEventListener('click', exportInventory);
    $('exportJsonBtn').addEventListener('click', exportInventoryJSON);
    $('applyMass').addEventListener('click', handleMassUpdate);

    // Publish pipeline
    setupPublishDropZone();
    $('stageBtn').addEventListener('click', stageInventory);
    $('publishBtn').addEventListener('click', publishInventory);

    // Blog
    initQuillEditor();
    $('blogSave').addEventListener('click', saveBlogPost);
    $('newPostBtn').addEventListener('click', resetBlogForm);
    $('deletePostBtn').addEventListener('click', deleteBlogPost);
    $('previewPost').addEventListener('click', previewBlog);
    $('blogSearch').addEventListener('input', renderBlogList);
    $('blogFilter').addEventListener('change', renderBlogList);
    $('blogImageFile').addEventListener('change', handleBlogImageUpload);
    $('refreshCommentsBtn').addEventListener('click', loadBlogComments);
    setupBlogSlugGen();

    // Settings
    $('saveOpenaiKey').addEventListener('click', saveOpenaiKey);
    $('saveCloudinary').addEventListener('click', saveCloudinarySettings);
    loadSettings();

    // Modals
    previewModal.addEventListener('click', closeModals);
    editModal.addEventListener('click', closeModals);

    // Initial render
    renderInventoryTable();
    renderBlogList();
  }

  init();
})();
