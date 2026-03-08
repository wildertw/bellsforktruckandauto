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
  const VISION_API = '/.netlify/functions/vehicle-vision';
  const SETTINGS_API = '/.netlify/functions/admin-settings';

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
  let editKeptImages = []; // existing image keys to keep when editing
  let addPreviewIndex = 0;     // which new photo is the preview in Add form
  let editPreviewName = null;  // URL or 'new-N' identifier for preview in Edit modal

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

  // ─── Photo Upload (Netlify Blobs) ────────────────────────────────────────
  async function uploadPhotoToBlobs(file, stockNumber, photoIndex) {
    var session = JSON.parse(sessionStorage.getItem('bf_admin_session') || '{}');
    if (!session.username || !session.passwordHash) {
      throw new Error('Not authenticated. Please log in again.');
    }
    var base64 = await new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result.split(',')[1]); };
      reader.onerror = function () { reject(new Error('Failed to read file')); };
      reader.readAsDataURL(file);
    });
    var res = await fetch('/.netlify/functions/photo-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth: { user: session.username, passwordHash: session.passwordHash },
        stockNumber: stockNumber,
        photoIndex: photoIndex,
        imageData: base64,
        contentType: file.type || 'image/png',
      }),
    });
    if (!res.ok) {
      var err = await res.json().catch(function () { return {}; });
      throw new Error(err.error || 'Photo upload failed');
    }
    var data = await res.json();
    return data.key; // e.g. "blob:D2601-01.png"
  }

  async function uploadPhotos(files, stockNumber, progressCb) {
    var keys = [];
    for (var i = 0; i < files.length; i++) {
      if (progressCb) progressCb(i + 1, files.length);
      var key = await uploadPhotoToBlobs(files[i], stockNumber, i + 1);
      keys.push(key);
    }
    return keys;
  }

  // ─── Resolve image name to a displayable src URL ────────────────────────
  function resolveImageSrc(name) {
    if (!name) return '';
    if (typeof name !== 'string') return '';
    if (name.startsWith('http://') || name.startsWith('https://')) return name;
    if (name.startsWith('blob:')) return '/photos/' + name.slice(5);
    return 'assets/vehicles/' + name;
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
        badge: item.badge, featured: item.featured || false,
        images: item.images || [],
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
      // Always sync inventory from the live site on login
      loadInventoryFromSite();
      // Load dashboard overview stats on login
      renderOverview();
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

  // Industry benchmarks for auto dealerships
  var BENCHMARKS = {
    conversionRate: 3.5,
    bounceRate: 45,
    avgDaysOnLot: 45,
    mobileTrafficPct: 65,
    avgSessionDuration: 180,
  };

  // Chart.js instances (destroyed before re-render)
  var trafficChartInstance = null;
  var leadSourceChartInstance = null;
  var leadTrendChartInstance = null;
  var categoryViewsChartInstance = null;

  // Chart.js dark theme colors
  var chartTextColor = 'rgba(230,237,247,0.7)';
  var chartGridColor = 'rgba(230,237,247,0.08)';
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
    chartTextColor = 'rgba(15,23,42,0.6)';
    chartGridColor = 'rgba(15,23,42,0.08)';
  }

  async function fetchDashboardStats(period) {
    var now = Date.now();
    if (statsCache.data && statsCache.period === period && (now - statsCache.time) < 300000) {
      return statsCache.data;
    }
    var session = JSON.parse(sessionStorage.getItem('bf_admin_session') || '{}');
    var user = session.username || session.user || '';
    var hash = session.passwordHash || authPasswordHash || '';
    if (!user || !hash) throw new Error('Not authenticated');

    var authStr = btoa(user + ':' + hash);
    var res = await fetch(STATS_API + '?period=' + period, {
      headers: { 'Authorization': 'Basic ' + authStr },
    });
    if (!res.ok) throw new Error('Stats fetch failed: ' + res.status);
    var data = await res.json();
    statsCache = { data: data, time: now, period: period };
    return data;
  }

  function getAuthStr() {
    var session = JSON.parse(sessionStorage.getItem('bf_admin_session') || '{}');
    var user = session.username || session.user || '';
    var hash = session.passwordHash || authPasswordHash || '';
    if (!user || !hash) return '';
    return btoa(user + ':' + hash);
  }

  // ─── Trend Delta Helper ────────────────────────────────────────────────────
  function renderDelta(elId, current, previous) {
    var el = $(elId);
    if (!el) return;
    if (previous == null || previous === 0) { el.textContent = ''; el.className = 'delta'; return; }
    var pct = Math.round(((current - previous) / previous) * 100);
    if (pct === 0) { el.textContent = '-'; el.className = 'delta neutral'; return; }
    el.textContent = (pct > 0 ? '+' : '') + pct + '%';
    el.className = 'delta ' + (pct > 0 ? 'positive' : 'negative');
  }

  function renderBenchmarkDelta(elId, current, benchmark, lowerIsBetter) {
    var el = $(elId);
    if (!el) return;
    var diff = current - benchmark;
    var good = lowerIsBetter ? diff <= 0 : diff >= 0;
    if (Math.abs(diff) < 0.5) { el.textContent = 'on target'; el.className = 'delta neutral'; return; }
    el.textContent = (diff > 0 ? '+' : '') + diff.toFixed(0) + ' vs avg';
    el.className = 'delta ' + (good ? 'positive' : 'negative');
  }

  // ─── Chart.js Traffic Chart ────────────────────────────────────────────────
  function renderTrafficChart(dailyBreakdown) {
    var canvas = $('trafficChartCanvas');
    if (!canvas || !dailyBreakdown || !dailyBreakdown.length) return;
    if (typeof Chart === 'undefined') return;

    if (trafficChartInstance) { trafficChartInstance.destroy(); trafficChartInstance = null; }

    var labels = dailyBreakdown.map(function (d) { return d.date.slice(5); });
    var viewsData = dailyBreakdown.map(function (d) { return d.views; });
    var uniquesData = dailyBreakdown.map(function (d) { return d.uniques; });
    var leadsData = dailyBreakdown.map(function (d) { return (d.calls || 0) + (d.forms || 0); });

    trafficChartInstance = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Page Views',
            data: viewsData,
            backgroundColor: 'rgba(103, 103, 247, 0.6)',
            borderColor: '#6767f7',
            borderWidth: 1,
            borderRadius: 4,
            order: 2,
          },
          {
            label: 'Unique Visitors',
            type: 'line',
            data: uniquesData,
            borderColor: '#37bc7b',
            backgroundColor: 'rgba(55, 188, 123, 0.1)',
            tension: 0.3,
            fill: true,
            pointRadius: 3,
            order: 1,
          },
          {
            label: 'Leads',
            type: 'line',
            data: leadsData,
            borderColor: '#f59e0b',
            borderDash: [5, 5],
            tension: 0.3,
            pointRadius: 2,
            order: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: chartTextColor, font: { family: "'Space Grotesk'" } } },
          tooltip: { mode: 'index', intersect: false },
        },
        scales: {
          x: { ticks: { color: chartTextColor }, grid: { color: chartGridColor } },
          y: { ticks: { color: chartTextColor }, grid: { color: chartGridColor }, beginAtZero: true },
        },
      },
    });
  }

  // ─── Sub-tab Navigation ────────────────────────────────────────────────────
  var currentSubtab = 'performance';
  document.querySelectorAll('.subtab').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.subtab').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      currentSubtab = btn.dataset.subtab;
      document.querySelectorAll('[data-subpanel]').forEach(function (panel) {
        panel.classList.toggle('hide', panel.dataset.subpanel !== currentSubtab);
      });
      // Render sub-tab content on demand
      if (statsCache.data) {
        if (currentSubtab === 'leads') renderLeadsPanel(statsCache.data);
        if (currentSubtab === 'inventory-analytics') renderInventoryAnalytics(statsCache.data);
        if (currentSubtab === 'insights') renderInsightsPanel(statsCache.data);
      }
    });
  });

  // ─── Performance Sub-Tab (Main Overview) ───────────────────────────────────
  async function renderOverview() {
    var visEl = $('kpiVisitors');
    if (!visEl) return;

    var now = new Date();
    var daysMap = { day: 1, week: 7, month: 30 };
    var daysBack = daysMap[currentPeriod] || 7;
    var startDate = new Date(now.getTime() - daysBack * 86400000);
    var fmt = function (d) { return d.toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' }); };
    var dateRange = $('overviewDateRange');
    if (dateRange) dateRange.textContent = fmt(startDate) + ' - ' + fmt(now);
    var titleEl = $('overviewTitle');
    if (titleEl) titleEl.textContent = PERIOD_TITLES[currentPeriod] || 'Weekly Overview';
    var chartLabel = $('chartPeriodLabel');
    if (chartLabel) chartLabel.textContent = PERIOD_LABELS[currentPeriod] || 'Last 7 days';

    renderLatestInventory();

    try {
      var stats = await fetchDashboardStats(currentPeriod);
      var prev = stats.previousPeriod || {};

      // Row 1: Traffic & Inventory
      visEl.textContent = String(stats.visitors.period);
      $('kpiVisitorsToday').textContent = String(stats.visitors.today);
      $('kpiUniques').textContent = String(stats.uniqueVisitors.period);
      $('kpiUniquesToday').textContent = String(stats.uniqueVisitors.today);
      $('kpiInventory').textContent = String(stats.carsInInventory);
      $('kpiInventoryMeta').textContent = stats.totalVehicles + ' total vehicles';

      // Conversion rate
      var convEl = $('kpiConversion');
      if (convEl) convEl.textContent = (stats.conversionRate || 0).toFixed(1) + '%';
      renderDelta('kpiConversionDelta', stats.conversionRate || 0, prev.conversionRate);

      // Trend deltas for visitors/uniques
      renderDelta('kpiVisitorsDelta', stats.visitors.period, prev.visitors);
      renderDelta('kpiUniquesDelta', stats.uniqueVisitors.period, prev.uniqueVisitors);

      // Row 2: Leads
      $('kpiLeads').textContent = String(stats.totalLeads);
      renderDelta('kpiLeadsDelta', stats.totalLeads, prev.totalLeads);
      $('kpiCalls').textContent = String(stats.callsFromWebsite);
      $('kpiForms').textContent = String(stats.formsSubmitted);
      $('kpiFormsMeta').textContent = 'this ' + currentPeriod;
      $('kpiSold').textContent = String(stats.carsSold);
      $('kpiSoldMeta').textContent = stats.carsPending > 0 ? stats.carsPending + ' pending' : 'all time';

      // Row 3: Engagement
      var ds = stats.deviceSplit || {};
      var totalDevices = (ds.mobile || 0) + (ds.desktop || 0) + (ds.tablet || 0);
      var deviceEl = $('kpiDeviceSplit');
      if (deviceEl) {
        deviceEl.textContent = totalDevices > 0
          ? Math.round((ds.mobile || 0) / totalDevices * 100) + '% / ' + Math.round((ds.desktop || 0) / totalDevices * 100) + '%'
          : '-';
      }
      var deviceMeta = $('kpiDeviceMeta');
      if (deviceMeta) deviceMeta.textContent = totalDevices > 0 ? 'mobile / desktop' : 'no data yet';

      var bounceEl = $('kpiBounce');
      if (bounceEl) bounceEl.textContent = (stats.bounceRate || 0).toFixed(0) + '%';
      renderBenchmarkDelta('kpiBounceVsBenchmark', stats.bounceRate || 0, BENCHMARKS.bounceRate, true);

      var nv = stats.newVsReturning || {};
      var newRetEl = $('kpiNewReturn');
      if (newRetEl) newRetEl.textContent = (nv.new || 0) + ' / ' + (nv.returning || 0);
      var nrMeta = $('kpiNewReturnMeta');
      if (nrMeta) nrMeta.textContent = 'new / returning';

      var sessEl = $('kpiSessionDuration');
      var avgSess = stats.avgSessionDuration || 0;
      if (sessEl) {
        var mins = Math.floor(avgSess / 60);
        var secs = avgSess % 60;
        sessEl.textContent = mins + 'm ' + secs + 's';
      }

      // Traffic chart (Chart.js)
      renderTrafficChart(stats.dailyBreakdown);

      // Recent activity
      var actEl = $('recentActivity');
      if (actEl && stats.dailyBreakdown.length) {
        var today = stats.dailyBreakdown[stats.dailyBreakdown.length - 1] || {};
        actEl.innerHTML =
          '<div class="activity-item"><strong>' + (today.views || 0) + '</strong> page views today</div>' +
          '<div class="activity-item"><strong>' + (today.uniques || 0) + '</strong> unique visitors today</div>' +
          '<div class="activity-item"><strong>' + (today.calls || 0) + '</strong> phone calls today</div>' +
          '<div class="activity-item"><strong>' + (today.forms || 0) + '</strong> forms submitted today</div>' +
          '<div class="activity-item muted" style="margin-top:8px">Data tracked via site analytics</div>';
      }

      // Top pages (now using aggregated page data from API)
      var topPagesBody = $('topPagesBody');
      if (topPagesBody && stats.topPages && Object.keys(stats.topPages).length) {
        var sortedPages = Object.entries(stats.topPages)
          .sort(function (a, b) { return b[1] - a[1]; })
          .slice(0, 10);
        topPagesBody.innerHTML = sortedPages.map(function (entry) {
          var label = entry[0] === '/' ? 'Home' : entry[0].replace(/^\//, '').replace(/\.html$/, '');
          return '<tr><td>' + label + '</td><td>' + entry[1] + '</td></tr>';
        }).join('') || '<tr><td colspan="2" class="muted">No data yet</td></tr>';
      } else if (topPagesBody) {
        topPagesBody.innerHTML = stats.dailyBreakdown.slice(-7).reverse().map(function (d) {
          return '<tr><td>' + d.date + '</td><td>' + d.views + ' views / ' + d.uniques + ' unique</td></tr>';
        }).join('') || '<tr><td colspan="2" class="muted">No data yet</td></tr>';
      }

      // Render active sub-tab
      if (currentSubtab === 'leads') renderLeadsPanel(stats);
      if (currentSubtab === 'inventory-analytics') renderInventoryAnalytics(stats);
      if (currentSubtab === 'insights') renderInsightsPanel(stats);

    } catch (err) {
      console.warn('Dashboard stats unavailable:', err.message);
      var zeroIds = ['kpiVisitors', 'kpiUniques', 'kpiInventory', 'kpiSold', 'kpiLeads', 'kpiCalls', 'kpiForms',
        'kpiConversion', 'kpiDeviceSplit', 'kpiBounce', 'kpiNewReturn', 'kpiSessionDuration'];
      zeroIds.forEach(function (id) { var el = $(id); if (el) el.textContent = '-'; });
      var topPagesBody = $('topPagesBody');
      if (topPagesBody) topPagesBody.innerHTML = '<tr><td colspan="2" class="muted">No data available</td></tr>';
      var actEl = $('recentActivity');
      if (actEl) actEl.innerHTML = '<p class="muted">Analytics will appear after deployment.</p>';
    }
  }

  // ─── Leads & Conversion Sub-Tab ────────────────────────────────────────────
  function renderLeadsPanel(stats) {
    var ls = stats.leadsBySource || {};
    var setVal = function (id, val) { var el = $(id); if (el) el.textContent = String(val); };

    setVal('kpiLeadsTotal2', stats.totalLeads);
    setVal('kpiHotLeads', ls.hot || 0);
    setVal('kpiWarmLeads', ls.warm || 0);
    setVal('kpiColdLeads', ls.cold || 0);
    setVal('kpiPhoneLeads2', stats.callsFromWebsite);
    setVal('kpiFormLeads2', stats.formsSubmitted);
    setVal('kpiLeadConversion', (stats.conversionRate || 0).toFixed(1) + '%');

    // Lead-to-sale estimate
    var leadToSale = stats.totalLeads > 0 ? ((stats.carsSold / stats.totalLeads) * 100) : 0;
    setVal('kpiLeadToSale', leadToSale.toFixed(1) + '%');

    // Lead source doughnut chart
    if (typeof Chart !== 'undefined') {
      var srcCanvas = $('leadSourceChart');
      if (srcCanvas) {
        if (leadSourceChartInstance) { leadSourceChartInstance.destroy(); leadSourceChartInstance = null; }
        leadSourceChartInstance = new Chart(srcCanvas, {
          type: 'doughnut',
          data: {
            labels: ['Phone Calls', 'Form Submissions'],
            datasets: [{
              data: [stats.callsFromWebsite || 0, stats.formsSubmitted || 0],
              backgroundColor: ['#6767f7', '#37bc7b'],
              borderWidth: 0,
            }],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { position: 'bottom', labels: { color: chartTextColor, font: { family: "'Space Grotesk'" } } },
            },
          },
        });
      }

      // Lead trend line chart
      var trendCanvas = $('leadTrendChart');
      if (trendCanvas && stats.dailyBreakdown) {
        if (leadTrendChartInstance) { leadTrendChartInstance.destroy(); leadTrendChartInstance = null; }
        leadTrendChartInstance = new Chart(trendCanvas, {
          type: 'line',
          data: {
            labels: stats.dailyBreakdown.map(function (d) { return d.date.slice(5); }),
            datasets: [
              {
                label: 'Phone Calls',
                data: stats.dailyBreakdown.map(function (d) { return d.calls || 0; }),
                borderColor: '#6767f7',
                tension: 0.3,
                pointRadius: 3,
              },
              {
                label: 'Form Submissions',
                data: stats.dailyBreakdown.map(function (d) { return d.forms || 0; }),
                borderColor: '#37bc7b',
                tension: 0.3,
                pointRadius: 3,
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { labels: { color: chartTextColor, font: { family: "'Space Grotesk'" } } },
              tooltip: { mode: 'index', intersect: false },
            },
            scales: {
              x: { ticks: { color: chartTextColor }, grid: { color: chartGridColor } },
              y: { ticks: { color: chartTextColor }, grid: { color: chartGridColor }, beginAtZero: true },
            },
          },
        });
      }
    }

    // Referrer table
    var refBody = $('referrerTableBody');
    if (refBody && stats.referrerSplit) {
      var rs = stats.referrerSplit;
      var totalRef = Object.values(rs).reduce(function (s, v) { return s + v; }, 0) || 1;
      var refLabels = { direct: 'Direct / Bookmarked', google: 'Google Search', facebook: 'Facebook', social: 'Other Social Media', other: 'Other / Referral' };
      refBody.innerHTML = Object.entries(rs)
        .sort(function (a, b) { return b[1] - a[1]; })
        .map(function (entry) {
          var pct = Math.round((entry[1] / totalRef) * 100);
          return '<tr><td>' + (refLabels[entry[0]] || entry[0]) + '</td><td>' + entry[1] + '</td><td>' + pct + '%</td></tr>';
        }).join('') || '<tr><td colspan="3" class="muted">No data</td></tr>';
    }
  }

  // ─── Inventory Analytics Sub-Tab ───────────────────────────────────────────
  function renderInventoryAnalytics(stats) {
    var setVal = function (id, val) { var el = $(id); if (el) el.textContent = String(val); };

    setVal('kpiDaysOnLot', (stats.avgDaysOnLot || 0) + ' days');
    renderBenchmarkDelta('kpiDaysOnLotVsBenchmark', stats.avgDaysOnLot || 0, BENCHMARKS.avgDaysOnLot, true);
    setVal('kpiInventoryValue', formatMoney(stats.totalInventoryValue || 0));
    setVal('kpiTotalVehicles', stats.totalVehicles || 0);
    var tvMeta = $('kpiTotalVehiclesMeta');
    if (tvMeta) tvMeta.textContent = (stats.carsInInventory || 0) + ' available, ' + (stats.carsSold || 0) + ' sold';

    // Most viewed category
    var catBreakdown = stats.categoryBreakdown || {};
    var catEntries = Object.entries(catBreakdown);
    var mostViewed = catEntries.sort(function (a, b) { return (b[1].totalViews || 0) - (a[1].totalViews || 0); })[0];
    setVal('kpiMostViewed', mostViewed ? mostViewed[0] : '-');
    var mvMeta = $('kpiMostViewedMeta');
    if (mvMeta) mvMeta.textContent = mostViewed ? (mostViewed[1].totalViews || 0) + ' views' : 'no data';

    // Category breakdown table
    var catBody = $('categoryTableBody');
    if (catBody) {
      catBody.innerHTML = catEntries.map(function (entry) {
        var c = entry[1];
        return '<tr><td>' + entry[0] + '</td><td>' + c.count + '</td><td>' + c.available + '</td><td>' + c.sold + '</td><td>' + (c.totalViews || 0) + '</td></tr>';
      }).join('') || '<tr><td colspan="5" class="muted">No data</td></tr>';
    }

    // Category views horizontal bar chart
    if (typeof Chart !== 'undefined') {
      var catCanvas = $('categoryViewsChart');
      if (catCanvas && catEntries.length) {
        if (categoryViewsChartInstance) { categoryViewsChartInstance.destroy(); categoryViewsChartInstance = null; }
        var cats = catEntries.sort(function (a, b) { return (b[1].totalViews || 0) - (a[1].totalViews || 0); });
        categoryViewsChartInstance = new Chart(catCanvas, {
          type: 'bar',
          data: {
            labels: cats.map(function (c) { return c[0]; }),
            datasets: [{
              label: 'Page Views',
              data: cats.map(function (c) { return c[1].totalViews || 0; }),
              backgroundColor: ['#6767f7', '#37bc7b', '#f59e0b', '#f2555e', '#1d7cf2', '#a5b4fc'],
              borderWidth: 0,
              borderRadius: 4,
            }],
          },
          options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { display: false },
            },
            scales: {
              x: { ticks: { color: chartTextColor }, grid: { color: chartGridColor }, beginAtZero: true },
              y: { ticks: { color: chartTextColor }, grid: { display: false } },
            },
          },
        });
      }
    }

    // Top viewed vehicles table
    var tvBody = $('topVehiclesBody');
    if (tvBody && stats.topViewedVehicles && stats.topViewedVehicles.length) {
      tvBody.innerHTML = stats.topViewedVehicles.map(function (v) {
        return '<tr><td>' + (v.name || '-') + '</td><td>' + (v.stockNumber || '-') + '</td>' +
          '<td>' + (v.price ? formatMoney(v.price) : '-') + '</td>' +
          '<td>' + v.views + '</td>' +
          '<td><span class="status-pill status-' + (v.status || 'available') + '">' + (v.status || '-') + '</span></td></tr>';
      }).join('');
    } else if (tvBody) {
      tvBody.innerHTML = '<tr><td colspan="5" class="muted">No vehicle page view data yet</td></tr>';
    }
  }

  // ─── Insights & Goals Sub-Tab ──────────────────────────────────────────────
  async function loadGoals() {
    var authStr = getAuthStr();
    if (!authStr) return null;
    try {
      var res = await fetch(STATS_API + '?action=goals', {
        headers: { 'Authorization': 'Basic ' + authStr },
      });
      if (res.ok) return await res.json();
    } catch (e) { console.warn('Failed to load goals', e); }
    return null;
  }

  async function saveGoals() {
    var authStr = getAuthStr();
    if (!authStr) return;
    var goals = {
      monthlyVisitors: Number($('goalVisitors').value) || 500,
      monthlyLeads: Number($('goalLeads').value) || 50,
      targetDaysOnLot: Number($('goalDaysOnLot').value) || 30,
      targetConversionRate: Number($('goalConvRate').value) || 5,
    };
    try {
      var res = await fetch(STATS_API + '?action=goals', {
        method: 'POST',
        headers: { 'Authorization': 'Basic ' + authStr, 'Content-Type': 'application/json' },
        body: JSON.stringify(goals),
      });
      if (res.ok) {
        showFeedback($('goalsFeedback'), 'Goals saved successfully!');
        renderInsightsPanel(statsCache.data);
        setTimeout(function () { hideFeedback($('goalsFeedback')); }, 3000);
      }
    } catch (e) { showFeedback($('goalsFeedback'), 'Error saving goals', true); }
  }

  var saveGoalsBtn = $('saveGoalsBtn');
  if (saveGoalsBtn) saveGoalsBtn.addEventListener('click', saveGoals);

  function renderGoalProgress(label, current, target) {
    var pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
    var color = pct >= 100 ? 'var(--success)' : pct >= 70 ? 'var(--warning)' : 'var(--danger)';
    return '<div class="goal-row">' +
      '<div class="goal-label">' + label + '</div>' +
      '<div class="goal-bar"><div class="goal-fill" style="width:' + pct + '%;background:' + color + '"></div></div>' +
      '<div class="goal-value">' + current + ' / ' + target + ' (' + pct + '%)</div>' +
    '</div>';
  }

  function generateRecommendations(stats) {
    var tips = [];
    if ((stats.bounceRate || 0) > 50)
      tips.push({ icon: '&#128683;', text: 'Bounce rate is above 50%. Consider improving page load speed and adding more engaging content above the fold.', type: 'rec-warning' });
    var ds = stats.deviceSplit || {};
    var totalDevices = (ds.mobile || 0) + (ds.desktop || 0) + (ds.tablet || 0);
    if (totalDevices > 0 && (ds.mobile || 0) > (ds.desktop || 0) * 1.5)
      tips.push({ icon: '&#128241;', text: 'Mobile traffic dominates (' + Math.round(ds.mobile / totalDevices * 100) + '%). Ensure all vehicle photos, forms, and CTAs are fully mobile-optimized.', type: 'rec-warning' });
    if ((stats.avgDaysOnLot || 0) > 45)
      tips.push({ icon: '&#128197;', text: 'Average days on lot exceeds 45. Consider price adjustments or featuring slow-moving inventory on the homepage.', type: 'rec-danger' });
    if ((stats.conversionRate || 0) < 2)
      tips.push({ icon: '&#127919;', text: 'Conversion rate is below 2%. Add more prominent call-to-action buttons and simplify the contact form.', type: 'rec-danger' });
    if ((stats.conversionRate || 0) >= 4)
      tips.push({ icon: '&#9989;', text: 'Great conversion rate! Your website is effectively turning visitors into leads.', type: 'rec-success' });
    if ((stats.avgSessionDuration || 0) < 60)
      tips.push({ icon: '&#9201;', text: 'Average session duration is under 1 minute. Add detailed vehicle descriptions, more photos, and engaging content to keep visitors browsing.', type: 'rec-warning' });
    var nv = stats.newVsReturning || {};
    if ((nv.returning || 0) > (nv.new || 0))
      tips.push({ icon: '&#128260;', text: 'More returning visitors than new. Invest in SEO and social media to attract fresh traffic.', type: 'rec-warning' });
    if (tips.length === 0)
      tips.push({ icon: '&#128161;', text: 'Dashboard needs more data to generate personalized recommendations. Keep tracking for better insights.', type: '' });
    return tips;
  }

  async function renderInsightsPanel(stats) {
    if (!stats) return;

    // Load goals and populate inputs
    var goals = await loadGoals();
    if (goals) {
      var gv = $('goalVisitors'); if (gv) gv.value = goals.monthlyVisitors || 500;
      var gl = $('goalLeads'); if (gl) gl.value = goals.monthlyLeads || 50;
      var gd = $('goalDaysOnLot'); if (gd) gd.value = goals.targetDaysOnLot || 30;
      var gc = $('goalConvRate'); if (gc) gc.value = goals.targetConversionRate || 5;
    }

    // Goal progress bars (monthly projections)
    var progressEl = $('goalProgressBars');
    if (progressEl && goals) {
      var daysInMonth = 30;
      var daysBack = stats.daysBack || 7;
      var projectedVisitors = daysBack > 0 ? Math.round((stats.visitors.period / daysBack) * daysInMonth) : 0;
      var projectedLeads = daysBack > 0 ? Math.round((stats.totalLeads / daysBack) * daysInMonth) : 0;

      progressEl.innerHTML =
        renderGoalProgress('Monthly Visitors', projectedVisitors, goals.monthlyVisitors || 500) +
        renderGoalProgress('Monthly Leads', projectedLeads, goals.monthlyLeads || 50) +
        renderGoalProgress('Days on Lot', stats.avgDaysOnLot || 0, goals.targetDaysOnLot || 30) +
        renderGoalProgress('Conversion Rate', (stats.conversionRate || 0).toFixed(1), goals.targetConversionRate || 5);
    }

    // Benchmarks
    var benchEl = $('benchmarkRows');
    if (benchEl) {
      var rows = [
        { label: 'Conversion Rate', current: (stats.conversionRate || 0).toFixed(1) + '%', industry: BENCHMARKS.conversionRate + '%', good: (stats.conversionRate || 0) >= BENCHMARKS.conversionRate },
        { label: 'Bounce Rate', current: (stats.bounceRate || 0).toFixed(0) + '%', industry: BENCHMARKS.bounceRate + '%', good: (stats.bounceRate || 0) <= BENCHMARKS.bounceRate },
        { label: 'Avg Days on Lot', current: (stats.avgDaysOnLot || 0) + ' days', industry: BENCHMARKS.avgDaysOnLot + ' days', good: (stats.avgDaysOnLot || 0) <= BENCHMARKS.avgDaysOnLot },
        { label: 'Mobile Traffic', current: (totalDevicesGlobal(stats) > 0 ? Math.round(((stats.deviceSplit || {}).mobile || 0) / totalDevicesGlobal(stats) * 100) : 0) + '%', industry: BENCHMARKS.mobileTrafficPct + '%', good: true },
        { label: 'Avg Session Duration', current: (stats.avgSessionDuration || 0) + 's', industry: BENCHMARKS.avgSessionDuration + 's', good: (stats.avgSessionDuration || 0) >= BENCHMARKS.avgSessionDuration },
      ];
      benchEl.innerHTML = rows.map(function (r) {
        return '<div class="benchmark-row">' +
          '<span class="benchmark-label">' + r.label + '</span>' +
          '<span class="benchmark-current">' + r.current + '</span>' +
          '<span class="benchmark-industry">' + r.industry + '</span>' +
          '<span class="delta ' + (r.good ? 'positive' : 'negative') + '">' + (r.good ? 'Good' : 'Below avg') + '</span>' +
        '</div>';
      }).join('');
    }

    // Recommendations
    var recsEl = $('recommendationsList');
    if (recsEl) {
      var tips = generateRecommendations(stats);
      recsEl.innerHTML = tips.map(function (t) {
        return '<div class="recommendation-card ' + (t.type || '') + '">' +
          '<span class="rec-icon">' + t.icon + '</span>' +
          '<span>' + t.text + '</span>' +
        '</div>';
      }).join('');
    }
  }

  function totalDevicesGlobal(stats) {
    var ds = stats.deviceSplit || {};
    return (ds.mobile || 0) + (ds.desktop || 0) + (ds.tablet || 0);
  }

  function renderLatestInventory() {
    var latest = inventory[0];
    var latestModel = $('latestModel');
    var latestPrice = $('latestPrice');
    var latestFeatures = $('latestFeatures');
    if (latest && latestModel && latestPrice && latestFeatures) {
      var modelLabel = [latest.year, latest.make, latest.model, latest.trim].filter(Boolean).join(' ') || latest.name || 'Unknown';
      latestModel.textContent = modelLabel;
      latestPrice.textContent = formatMoney(latest.price);
      var featureList = Array.isArray(latest.features) && latest.features.length
        ? latest.features.slice(0, 5)
        : [latest.category || 'Vehicle', latest.engine || 'Stock', latest.transmission || 'Auto', (latest.quantity || 0) + ' in stock'];
      latestFeatures.innerHTML = featureList.map(function (f) { return '<span class="chip">' + f + '</span>'; }).join('');
    }
  }

  // Period toggle
  document.querySelectorAll('.period-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.period-btn').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      currentPeriod = btn.dataset.period;
      statsCache = { data: null, time: 0, period: '' };
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
    // Update featured count indicator
    var featuredCount = inventory.filter(function(v) { return v.featured; }).length;
    var featuredStatusEl = $('featuredStatus');
    if (featuredStatusEl) {
      featuredStatusEl.innerHTML = '\u2605 <strong>' + featuredCount + '/5</strong> vehicles featured on homepage' +
        (featuredCount === 0 ? ' (showing last 5 added by default)' : '');
    }
    const search = $('editSearch').value.trim().toLowerCase();
    filteredInventory = inventory.filter((item) => {
      if (!search) return true;
      return [item.sku, item.name, item.category, item.supplier, item.make, item.model, item.vin].some((field) => String(field || '').toLowerCase().includes(search));
    });
    const totalPages = Math.max(1, Math.ceil(filteredInventory.length / pageSize));
    currentPage = Math.min(currentPage, totalPages);
    const start = (currentPage - 1) * pageSize;
    const pageSlice = filteredInventory.slice(start, start + pageSize);
    inventoryTableBody.innerHTML = pageSlice.map(function(item) {
      var canFeature = item.featured || featuredCount < 5;
      return '<tr>' +
      '<td>' + item.sku + '</td>' +
      '<td>' + item.name + '</td>' +
      '<td>' + item.category + '</td>' +
      '<td><span class="status-pill status-' + (item.status || 'available') + '">' + (item.status || 'available') + '</span></td>' +
      '<td class="featured-toggle-cell">' +
        '<button class="featured-star' + (item.featured ? ' active' : '') + '"' +
          ' data-action="toggle-featured" data-sku="' + item.sku + '"' +
          ' type="button"' +
          ' title="' + (item.featured ? 'Remove from featured' : (canFeature ? 'Add to featured' : 'Maximum 5 featured reached')) + '"' +
          (canFeature ? '' : ' disabled') +
        '>' +
          (item.featured ? '\u2605' : '\u2606') +
        '</button>' +
      '</td>' +
      '<td>' + formatMoney(item.price) + '</td>' +
      '<td class="table-actions">' +
        '<button class="ghost-btn" data-action="edit" data-sku="' + item.sku + '">Edit</button>' +
        '<button class="ghost-btn danger-text" data-action="delete" data-sku="' + item.sku + '">Delete</button>' +
      '</td></tr>';
    }).join('');
    $('pageInfo').textContent = 'Page ' + currentPage + ' / ' + totalPages;
  }

  // ─── Inventory Table Actions ────────────────────────────────────────────────
  function handleTableActions(event) {
    if (!event.target.matches('button')) return;
    const action = event.target.dataset.action;
    const sku = event.target.dataset.sku;
    const item = inventory.find((row) => row.sku === sku);
    if (!item) return;
    if (action === 'toggle-featured') {
      var featuredCount = inventory.filter(function(v) { return v.featured; }).length;
      if (item.featured) {
        item.featured = false;
      } else if (featuredCount < 5) {
        item.featured = true;
      } else {
        showFeedback(editFeedback, 'Maximum 5 featured vehicles allowed. Unfeature one first.', true);
        return;
      }
      persistInventory();
      renderInventoryTable();
      showToast('Publishing featured change...');
      autoPublish().then(function () {
        showToast('\u2713 Featured updated & published! Live in ~30 seconds.', 'success');
        setTimeout(hideToast, 5000);
      }).catch(function (err) {
        showToast('Error publishing: ' + err.message, 'error');
        setTimeout(hideToast, 8000);
      });
      return;
    }
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
      editPreviewName = editKeptImages.length ? editKeptImages[0] : null;
      renderEditPhotoPreview();
      // Reset VIN decode display
      $('editVinResult').classList.add('hide');
      editVinDecodeData = null;
      hideFeedback($('editFeedback'));
      // Show/hide photo scan button based on image availability
      var scanBtn = $('editScanPhotosBtn');
      if (scanBtn) scanBtn.classList.toggle('hide', !editKeptImages.length);
      var scanResults = $('editScanResults');
      if (scanResults) { scanResults.classList.add('hide'); scanResults.innerHTML = ''; }
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

      // Upload new photos to Netlify Blobs if any were selected
      var newImageUrls = [];
      if (editPhotoFiles.length > 0) {
        var editStock = editingItem.stockNumber || editingItem.vin || 'UNKNOWN';
        showToast('Uploading photos...');
        newImageUrls = await uploadPhotos(editPhotoFiles, editStock, function (current, total) {
          showToast('Uploading photo ' + current + ' of ' + total + '...');
        });
      }

      // Merge: kept existing images + newly uploaded images
      var mergedImages = (editKeptImages || []).concat(newImageUrls);
      // Move the selected preview image to front
      if (editPreviewName && editPreviewName.startsWith('new-')) {
        var newIdx = parseInt(editPreviewName.replace('new-', ''), 10);
        if (newIdx >= 0 && newIdx < newImageUrls.length) {
          var previewUrl = newImageUrls[newIdx];
          mergedImages = [previewUrl].concat(mergedImages.filter(function (u) { return u !== previewUrl; }));
        }
      } else if (editPreviewName && mergedImages.includes(editPreviewName)) {
        mergedImages = [editPreviewName].concat(mergedImages.filter(function (u) { return u !== editPreviewName; }));
      }
      editingItem.images = mergedImages;

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
          badge: v.badge, featured: v.featured || false,
          drivetrain: v.drivetrain, fuelType: v.fuelType,
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
          badge: v.badge, featured: v.featured || false,
          drivetrain: v.drivetrain, fuelType: v.fuelType,
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
      // Reorder photos so the selected preview is first, then upload
      var imageUrls = [];
      if (addPhotoFiles.length > 0) {
        if (addPreviewIndex > 0 && addPreviewIndex < addPhotoFiles.length) {
          var previewFile = addPhotoFiles.splice(addPreviewIndex, 1)[0];
          addPhotoFiles.unshift(previewFile);
          addPreviewIndex = 0;
        }
        var addStock = $('addStock').value.trim() || $('addVin').value.trim() || sku;
        showToast('Uploading photos...');
        imageUrls = await uploadPhotos(addPhotoFiles, addStock, function (current, total) {
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
        addPreviewIndex = 0;
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
      featured: false,
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
        fuel: result.FuelTypePrimary,
        engine: [result.DisplacementL ? result.DisplacementL + 'L' : '', result.EngineCylinders ? 'V' + result.EngineCylinders : ''].filter(Boolean).join(' '),
        transmission: result.TransmissionStyle || '',
        doors: result.Doors || '',
        engineHP: result.EngineHP || '',
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
    if (vinDecodeData.transmission) $('addTransmission').value = vinDecodeData.transmission;
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
    addPhotoFiles = Array.from(files).slice(0, 25);
    addPreviewIndex = 0;
    renderAddPhotoPreview();
    // Show scan button hint
    var scanBtn = $('addScanPhotosBtn');
    if (scanBtn) scanBtn.classList.remove('hide');
  }

  function renderAddPhotoPreview() {
    var preview = $('photoPreview');
    if (!preview) return;
    preview.innerHTML = '';
    addPhotoFiles.forEach(function (file, i) {
      var div = document.createElement('div');
      div.className = 'photo-thumb' + (i === addPreviewIndex ? ' is-preview' : '');
      var reader = new FileReader();
      reader.onload = function (e) {
        var img = div.querySelector('img');
        if (img) img.src = e.target.result;
      };
      div.innerHTML = '<img src="" alt="Photo ' + (i + 1) + '" title="Click to set as preview">' +
        (i === addPreviewIndex ? '<div class="photo-preview-badge">Preview</div>' : '') +
        '<span class="photo-label">' + (i === addPreviewIndex ? 'Preview' : 'Photo ' + (i + 1)) + '</span>';
      div.addEventListener('click', function () {
        addPreviewIndex = i;
        renderAddPhotoPreview();
      });
      preview.appendChild(div);
      reader.readAsDataURL(file);
    });
  }

  // ─── AI Photo Scan ─────────────────────────────────────────────────────────
  async function scanPhotosWithAI(imageUrls, feedbackEl, resultsEl, btnEl) {
    if (!imageUrls || !imageUrls.length) {
      showFeedback(feedbackEl, 'No photos available to scan.', true);
      return null;
    }

    // Filter to scannable URLs (HTTPS or blob-served photos)
    var validUrls = imageUrls.map(function (u) {
      if (typeof u !== 'string') return null;
      if (u.startsWith('https://')) return u;
      if (u.startsWith('blob:')) return window.location.origin + '/photos/' + u.slice(5);
      return null;
    }).filter(Boolean);
    if (!validUrls.length) {
      showFeedback(feedbackEl, 'No scannable photos. Upload photos first, then try again.', true);
      return null;
    }

    var session = JSON.parse(sessionStorage.getItem('bf_admin_session') || '{}');
    if (!session.username || !session.passwordHash) {
      showFeedback(feedbackEl, 'Not authenticated. Please log in again.', true);
      return null;
    }

    var origText = btnEl.textContent;
    btnEl.disabled = true;
    btnEl.textContent = 'Scanning photos...';
    hideFeedback(feedbackEl);

    try {
      var headers = { 'Content-Type': 'application/json' };
      var apiKey = localStorage.getItem('bf_openai_key');
      if (apiKey) headers['Authorization'] = 'Bearer ' + apiKey;

      var res = await fetch(VISION_API, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          auth: { user: session.username, passwordHash: session.passwordHash },
          imageUrls: validUrls.slice(0, 5),
        }),
      });

      var data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Photo scan failed');

      displayScanResults(data.analysis, resultsEl);
      showFeedback(feedbackEl, 'Photo scan complete. Review results below.');
      return data.analysis;
    } catch (err) {
      showFeedback(feedbackEl, 'Photo scan failed: ' + err.message, true);
      return null;
    } finally {
      btnEl.disabled = false;
      btnEl.textContent = origText;
    }
  }

  function displayScanResults(analysis, container) {
    if (!analysis || !container) return;
    container.classList.remove('hide');

    var html = '<div class="scan-label">AI Photo Analysis Results</div>';
    html += '<div class="scan-grid">';

    var fields = [
      { key: 'exteriorColor', label: 'Exterior Color' },
      { key: 'interiorColor', label: 'Interior Color' },
      { key: 'interiorMaterial', label: 'Interior Material' },
      { key: 'bodyStyle', label: 'Body Style' },
      { key: 'make', label: 'Make' },
      { key: 'model', label: 'Model' },
      { key: 'approximateYear', label: 'Approx. Year' },
      { key: 'condition', label: 'Condition' },
      { key: 'cabType', label: 'Cab Type' },
      { key: 'bedLength', label: 'Bed Length' },
      { key: 'driveType', label: 'Drive Type' },
      { key: 'trimLevel', label: 'Trim Level' },
    ];

    fields.forEach(function (f) {
      if (analysis[f.key]) {
        html += '<div class="scan-item"><span class="muted">' + f.label + '</span><strong>' + analysis[f.key] + '</strong></div>';
      }
    });
    html += '</div>';

    if (analysis.features && analysis.features.length) {
      html += '<div class="scan-features"><span class="muted">Features Detected</span><div class="chip-row">';
      analysis.features.forEach(function (f) {
        html += '<span class="chip">' + f + '</span>';
      });
      html += '</div></div>';
    }

    html += '<div class="scan-actions">';
    html += '<button type="button" class="primary-btn small-btn scan-apply-btn">Apply to Form</button>';
    html += '<button type="button" class="ghost-btn small-btn scan-dismiss-btn">Dismiss</button>';
    html += '</div>';

    container.innerHTML = html;
  }

  function applyEditScanResults(analysis) {
    if (!analysis) return;
    // Colors always come from photos (VIN cannot provide)
    if (analysis.exteriorColor) $('editExteriorColor').value = analysis.exteriorColor;
    if (analysis.interiorColor) {
      var interior = analysis.interiorColor;
      if (analysis.interiorMaterial) interior += ' ' + analysis.interiorMaterial;
      $('editInteriorColor').value = interior;
    }

    // Body style -> category mapping (only if empty)
    if (analysis.bodyStyle) {
      var catMap = { Truck: 'Truck', SUV: 'SUV', Crossover: 'SUV', Sedan: 'Sedan', Coupe: 'Sedan', Van: 'Van', Convertible: 'Sedan', Wagon: 'Sedan', Hatchback: 'Sedan' };
      var cat = catMap[analysis.bodyStyle];
      if (cat && !$('editCategory').value) $('editCategory').value = cat;
    }

    // Only fill make/model/year/trim if form fields are currently empty (VIN priority)
    if (analysis.make && !$('editMake').value) $('editMake').value = analysis.make;
    if (analysis.model && !$('editModel').value) $('editModel').value = analysis.model;
    if (analysis.trimLevel && !$('editTrim').value) $('editTrim').value = analysis.trimLevel;
    if (analysis.approximateYear && !$('editYear').value) {
      var yearMatch = String(analysis.approximateYear).match(/(\d{4})/);
      if (yearMatch) $('editYear').value = yearMatch[1];
    }

    // Drive type — only if empty
    if (analysis.driveType && !$('editDrivetrain').value) {
      var driveMap = { '4WD': '4WD', 'AWD': 'AWD', 'FWD': 'FWD', 'RWD': 'RWD', '4x4': '4WD', '4X4': '4WD' };
      var match = Object.keys(driveMap).find(function (k) { return (analysis.driveType || '').includes(k); });
      if (match) $('editDrivetrain').value = driveMap[match];
    }

    // Merge detected features into existing features
    if (analysis.features && analysis.features.length) {
      var existing = $('editFeatures').value.split(',').map(function (f) { return f.trim(); }).filter(Boolean);
      var existingLower = existing.map(function (f) { return f.toLowerCase(); });
      analysis.features.forEach(function (f) {
        if (!existingLower.includes(f.toLowerCase())) {
          existing.push(f);
        }
      });
      // Add cab type and bed length as features too
      if (analysis.cabType && !existingLower.includes(analysis.cabType.toLowerCase())) existing.push(analysis.cabType);
      if (analysis.bedLength && !existingLower.includes(analysis.bedLength.toLowerCase())) existing.push(analysis.bedLength);
      $('editFeatures').value = existing.join(', ');
    }

    showFeedback($('editFeedback'), 'Photo scan data applied to form.');
  }

  function applyAddScanResults(analysis) {
    if (!analysis) return;
    // Colors always from photos
    if (analysis.exteriorColor) $('addExteriorColor').value = analysis.exteriorColor;
    if (analysis.interiorColor) {
      var interior = analysis.interiorColor;
      if (analysis.interiorMaterial) interior += ' ' + analysis.interiorMaterial;
      $('addInteriorColor').value = interior;
    }

    // Body style -> category (only if empty)
    if (analysis.bodyStyle) {
      var catMap = { Truck: 'Truck', SUV: 'SUV', Crossover: 'SUV', Sedan: 'Sedan', Coupe: 'Sedan', Van: 'Van', Convertible: 'Sedan', Wagon: 'Sedan', Hatchback: 'Sedan' };
      var cat = catMap[analysis.bodyStyle];
      if (cat && !$('addCategory').value) $('addCategory').value = cat;
    }

    // Only fill if empty (VIN priority)
    if (analysis.make && !$('addMake').value) $('addMake').value = analysis.make;
    if (analysis.model && !$('addModel').value) $('addModel').value = analysis.model;
    if (analysis.trimLevel && !$('addTrim').value) $('addTrim').value = analysis.trimLevel;
    if (analysis.approximateYear && !$('addYear').value) {
      var yearMatch = String(analysis.approximateYear).match(/(\d{4})/);
      if (yearMatch) $('addYear').value = yearMatch[1];
    }

    if (analysis.driveType && !$('addDrivetrain').value) {
      var driveMap = { '4WD': '4WD', 'AWD': 'AWD', 'FWD': 'FWD', 'RWD': 'RWD', '4x4': '4WD', '4X4': '4WD' };
      var match = Object.keys(driveMap).find(function (k) { return (analysis.driveType || '').includes(k); });
      if (match) $('addDrivetrain').value = driveMap[match];
    }

    // Merge features
    if (analysis.features && analysis.features.length) {
      var existing = $('addFeatures').value.split(',').map(function (f) { return f.trim(); }).filter(Boolean);
      var existingLower = existing.map(function (f) { return f.toLowerCase(); });
      analysis.features.forEach(function (f) {
        if (!existingLower.includes(f.toLowerCase())) existing.push(f);
      });
      if (analysis.cabType && !existingLower.includes(analysis.cabType.toLowerCase())) existing.push(analysis.cabType);
      if (analysis.bedLength && !existingLower.includes(analysis.bedLength.toLowerCase())) existing.push(analysis.bedLength);
      $('addFeatures').value = existing.join(', ');
    }

    showFeedback(addFeedback, 'Photo scan data applied to form.');
    updateLivePreview();
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
        doors: result.Doors || '',
        engineHP: result.EngineHP || '',
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
    btn.textContent = '⏳ VIN Decode...';
    hideFeedback($('editFeedback'));

    try {
      // Step 1: Decode VIN if available
      var vin = $('editVin').value.trim().toUpperCase();
      if (vin.length === 17) {
        await editDecodeVin();
        if (editVinDecodeData) editApplyVinData();
      }

      // Step 2: Scan photos with AI if available
      btn.textContent = '⏳ Scanning Photos...';
      var allImages = (editKeptImages || []).slice();
      if (allImages.length > 0) {
        var analysis = await scanPhotosWithAI(
          allImages, $('editFeedback'), $('editScanResults'), btn
        );
        if (analysis) {
          applyEditScanResults(analysis);
          // Wire up Apply/Dismiss in results
          var applyBtn = $('editScanResults') && $('editScanResults').querySelector('.scan-apply-btn');
          if (applyBtn) applyBtn.onclick = function () { applyEditScanResults(analysis); };
          var dismissBtn = $('editScanResults') && $('editScanResults').querySelector('.scan-dismiss-btn');
          if (dismissBtn) dismissBtn.onclick = function () { $('editScanResults').classList.add('hide'); };
        }
      }

      // Step 3: Generate AI description
      btn.textContent = '⏳ AI Description...';
      var apiKey = localStorage.getItem('bf_openai_key');
      var make = $('editMake').value;
      var model = $('editModel').value;
      if (apiKey && make && model) {
        await editGenerateDescription();
      } else if (!apiKey) {
        showFeedback($('editFeedback'), 'Set OpenAI key in Settings to generate descriptions.', false);
      }

      showFeedback($('editFeedback'), 'AI analysis complete: VIN + Photos + Description.');
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
    editPhotoFiles = Array.from(files).slice(0, 25);
    renderEditPhotoPreview();
  }

  function renderEditPhotoPreview() {
    var preview = $('editPhotoPreview');
    if (!preview) return;
    preview.innerHTML = '';
    // Determine effective preview
    var effectivePreview = editPreviewName;
    if (!effectivePreview) {
      effectivePreview = editKeptImages.length ? editKeptImages[0] : (editPhotoFiles.length ? 'new-0' : null);
    }
    // Render kept (existing) images
    editKeptImages.forEach(function (url, i) {
      var isPreview = (url === effectivePreview);
      var div = document.createElement('div');
      div.className = 'photo-thumb' + (isPreview ? ' is-preview' : '');
      div.dataset.url = url;
      div.innerHTML = '<img src="' + resolveImageSrc(url) + '" alt="Photo ' + (i + 1) + '" title="Click to set as preview">' +
        '<button type="button" class="photo-remove-btn" title="Remove photo">&times;</button>' +
        (isPreview ? '<div class="photo-preview-badge">Preview</div>' : '') +
        '<span class="photo-label">' + (isPreview ? 'Preview' : 'Photo ' + (i + 1)) + '</span>';
      div.querySelector('.photo-remove-btn').addEventListener('click', function (e) {
        e.stopPropagation();
        editKeptImages = editKeptImages.filter(function (u) { return u !== url; });
        if (editPreviewName === url) editPreviewName = null;
        renderEditPhotoPreview();
      });
      div.addEventListener('click', function () {
        editPreviewName = url;
        renderEditPhotoPreview();
      });
      preview.appendChild(div);
    });
    // Render new (uploaded) files
    editPhotoFiles.forEach(function (file, i) {
      var newId = 'new-' + i;
      var isPreview = (newId === effectivePreview);
      var div = document.createElement('div');
      div.className = 'photo-thumb' + (isPreview ? ' is-preview' : '');
      var reader = new FileReader();
      reader.onload = function (e) {
        var img = div.querySelector('img');
        if (img) img.src = e.target.result;
      };
      div.innerHTML = '<img src="" alt="New photo ' + (i + 1) + '" title="Click to set as preview">' +
        (isPreview ? '<div class="photo-preview-badge">Preview</div>' : '') +
        '<span class="photo-label">' + (isPreview ? 'Preview' : 'New ' + (i + 1)) + '</span>';
      div.addEventListener('click', function () {
        editPreviewName = newId;
        renderEditPhotoPreview();
      });
      preview.appendChild(div);
      reader.readAsDataURL(file);
    });
    // Show/hide scan button
    var scanBtn = $('editScanPhotosBtn');
    if (scanBtn) scanBtn.classList.toggle('hide', !editKeptImages.length && !editPhotoFiles.length);
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
      badge: item.badge, featured: item.featured || false,
      images: item.images || [],
      dateAdded: item.dateAdded || new Date().toISOString().split('T')[0],
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
  async function loadSettings() {
    // Load from localStorage first (instant)
    var openaiKey = localStorage.getItem('bf_openai_key') || '';
    var googleKey = localStorage.getItem('bf_google_key') || '';
    var placeId = localStorage.getItem('bf_place_id') || '';
    if ($('settingsOpenaiKey')) $('settingsOpenaiKey').value = openaiKey ? '********' : '';
    if ($('settingsGoogleKey')) $('settingsGoogleKey').value = googleKey ? '********' : '';
    if ($('settingsPlaceId')) $('settingsPlaceId').value = placeId;

    // Then try to load from server (authoritative, survives browser changes)
    try {
      var session = JSON.parse(sessionStorage.getItem('bf_admin_session') || '{}');
      if (!session.username || !session.passwordHash) return;
      var res = await fetch(SETTINGS_API + '?user=' + encodeURIComponent(session.username) + '&hash=' + encodeURIComponent(session.passwordHash));
      if (!res.ok) return;
      var data = await res.json();
      if (!data.ok || !data.settings) return;
      var s = data.settings;
      // Sync server settings into localStorage
      if (s.openaiKeySet) {
        if ($('settingsOpenaiKey')) $('settingsOpenaiKey').value = '********';
        if (!localStorage.getItem('bf_openai_key')) {
          localStorage.setItem('bf_openai_key', '__server__');
        }
      }
      if (s.placeId) {
        localStorage.setItem('bf_place_id', s.placeId);
        if ($('settingsPlaceId')) $('settingsPlaceId').value = s.placeId;
      }
      if (s.googleKeySet) {
        if ($('settingsGoogleKey')) $('settingsGoogleKey').value = '********';
        if (!localStorage.getItem('bf_google_key')) {
          localStorage.setItem('bf_google_key', '__server__');
        }
      }
    } catch (e) {
      // Server load failed — localStorage values still apply
    }
  }

  async function saveOpenaiKey() {
    const key = $('settingsOpenaiKey').value.trim();
    if (!key || key.startsWith('*')) return;
    // Save to localStorage
    localStorage.setItem('bf_openai_key', key);
    $('settingsOpenaiKey').value = '********';
    // Save to server
    try {
      var session = JSON.parse(sessionStorage.getItem('bf_admin_session') || '{}');
      if (session.username && session.passwordHash) {
        await fetch(SETTINGS_API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            auth: { user: session.username, passwordHash: session.passwordHash },
            settings: { openaiKey: key },
          }),
        });
      }
    } catch (e) { /* server save failed, localStorage still has it */ }
    alert('OpenAI key saved.');
  }

  async function saveGoogleReviewsSettings() {
    const googleKey = $('settingsGoogleKey').value.trim();
    const placeId = $('settingsPlaceId').value.trim();
    if (!googleKey && !placeId) return;
    if (googleKey && !googleKey.startsWith('*')) localStorage.setItem('bf_google_key', googleKey);
    if (placeId) localStorage.setItem('bf_place_id', placeId);
    // Save to server
    try {
      var session = JSON.parse(sessionStorage.getItem('bf_admin_session') || '{}');
      if (session.username && session.passwordHash) {
        await fetch(SETTINGS_API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            auth: { user: session.username, passwordHash: session.passwordHash },
            settings: { googleKey: googleKey.startsWith('*') ? undefined : googleKey, placeId: placeId || undefined },
          }),
        });
      }
    } catch (e) { /* server save failed, localStorage still has it */ }
    if (googleKey && !googleKey.startsWith('*')) $('settingsGoogleKey').value = '********';
    showFeedback($('settingsGoogleStatus'), 'Google Reviews settings saved. Set GOOGLE_PLACES_API_KEY and GOOGLE_PLACE_ID as Netlify environment variables for the reviews to load.');
  }

  // ─── Modal Close ────────────────────────────────────────────────────────────
  function closeModals(event) {
    if (event.target.matches('.modal') || event.target.dataset.close !== undefined) {
      document.querySelectorAll('.modal').forEach((modal) => modal.classList.remove('active'));
    }
  }

  // ─── Dark / Light Theme Toggle ─────────────────────────────────────────────
  var currentThemeMode = localStorage.getItem('bf_theme') || 'dark';
  function applyTheme(mode) {
    currentThemeMode = mode;
    if (mode === 'light') {
      document.body.setAttribute('data-theme', 'light');
      chartTextColor = 'rgba(15,23,42,0.6)';
      chartGridColor = 'rgba(15,23,42,0.08)';
    } else {
      document.body.removeAttribute('data-theme');
      chartTextColor = 'rgba(230,237,247,0.7)';
      chartGridColor = 'rgba(230,237,247,0.08)';
    }
    var toggleBtn = $('themeToggleBtn');
    if (toggleBtn) toggleBtn.innerHTML = mode === 'light' ? '&#9788;' : '&#9790;';
    localStorage.setItem('bf_theme', mode);
  }
  applyTheme(currentThemeMode);

  function toggleTheme() {
    applyTheme(currentThemeMode === 'dark' ? 'light' : 'dark');
    // Re-render sales charts with updated colors
    if (salesOverTimeInstance) renderSalesOverTimeChart(salesData);
    if (salesByTypeInstance) renderSalesByTypeChart(salesPieData);
  }

  // ─── Sales Tab ────────────────────────────────────────────────────────────
  // Sample data (mirrors JSX file — replace with real data when available)
  var salesData = [
    { name: 'Jan', sales: 4000 },
    { name: 'Feb', sales: 3000 },
    { name: 'Mar', sales: 2000 },
    { name: 'Apr', sales: 2780 },
    { name: 'May', sales: 1890 },
    { name: 'Jun', sales: 2390 },
  ];

  var salesPieData = [
    { name: 'SUV', value: 400 },
    { name: 'Sedan', value: 300 },
    { name: 'Truck', value: 200 },
  ];

  var salesTableData = [
    { model: 'Model S', type: 'Sedan', price: 80000, buyer: 'John Smith', date: '6/15/23' },
    { model: 'Model X', type: 'SUV', price: 100000, buyer: 'Jane Doe', date: '6/10/23' },
    { model: 'F-150', type: 'Truck', price: 45000, buyer: 'Bob Jones', date: '6/12/23' },
  ];

  var salesOverTimeInstance = null;
  var salesByTypeInstance = null;

  function renderSalesOverTimeChart(data) {
    var canvas = $('salesOverTimeChart');
    if (!canvas || typeof Chart === 'undefined') return;
    if (salesOverTimeInstance) { salesOverTimeInstance.destroy(); salesOverTimeInstance = null; }

    var labels = data.map(function (d) { return d.name; });
    var values = data.map(function (d) { return d.sales; });

    salesOverTimeInstance = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Sales (Area)',
            type: 'line',
            data: values,
            backgroundColor: 'rgba(103, 103, 247, 0.15)',
            borderColor: '#055C9D',
            fill: true,
            tension: 0.3,
            pointRadius: 0,
            order: 2,
          },
          {
            label: 'Sales (Bar)',
            data: values,
            backgroundColor: 'rgba(103, 103, 247, 0.35)',
            borderRadius: 4,
            barPercentage: 0.5,
            order: 1,
          },
          {
            label: 'Sales (Trend)',
            type: 'line',
            data: values,
            borderColor: '#FF8600',
            borderWidth: 2,
            pointRadius: 3,
            pointBackgroundColor: '#FF8600',
            fill: false,
            tension: 0.3,
            order: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: chartTextColor, font: { family: "'Space Grotesk'" } } },
          tooltip: { mode: 'index', intersect: false },
        },
        scales: {
          x: { ticks: { color: chartTextColor }, grid: { color: chartGridColor } },
          y: { ticks: { color: chartTextColor }, grid: { color: chartGridColor }, beginAtZero: true },
        },
      },
    });
  }

  function renderSalesByTypeChart(data) {
    var canvas = $('salesByTypeChart');
    if (!canvas || typeof Chart === 'undefined') return;
    if (salesByTypeInstance) { salesByTypeInstance.destroy(); salesByTypeInstance = null; }

    var pieColors = ['#6767f7', '#37bc7b', '#f59e0b', '#f2555e', '#1d7cf2'];

    salesByTypeInstance = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: data.map(function (d) { return d.name; }),
        datasets: [{
          data: data.map(function (d) { return d.value; }),
          backgroundColor: pieColors.slice(0, data.length),
          borderWidth: 2,
          borderColor: 'transparent',
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: { color: chartTextColor, font: { family: "'Space Grotesk'" }, padding: 16 },
          },
        },
      },
    });
  }

  function renderSalesTable(data) {
    var tbody = $('salesTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    data.forEach(function (sale) {
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + sale.model + '</td>' +
        '<td>' + sale.type + '</td>' +
        '<td>$' + sale.price.toLocaleString() + '</td>' +
        '<td>' + sale.buyer + '</td>' +
        '<td>' + sale.date + '</td>';
      tbody.appendChild(tr);
    });
  }

  function updateSalesKpis(tableData) {
    var total = tableData.reduce(function (sum, s) { return sum + s.price; }, 0);
    var avg = tableData.length ? Math.round(total / tableData.length) : 0;
    var el;
    el = $('salesKpiTotal');
    if (el) el.textContent = '$' + total.toLocaleString();
    el = $('salesKpiAvg');
    if (el) el.textContent = '$' + avg.toLocaleString();
    el = $('salesKpiUnits');
    if (el) el.textContent = tableData.length;
  }

  function filterSalesData() {
    var typeFilter = ($('salesFilterType') || {}).value || 'All';
    var priceFilter = ($('salesFilterPrice') || {}).value || 'All';

    var filtered = salesTableData.filter(function (sale) {
      if (typeFilter !== 'All' && sale.type !== typeFilter) return false;
      if (priceFilter !== 'All') {
        if (priceFilter === '0-25000' && sale.price > 25000) return false;
        if (priceFilter === '25000-50000' && (sale.price < 25000 || sale.price > 50000)) return false;
        if (priceFilter === '50000+' && sale.price < 50000) return false;
      }
      return true;
    });

    renderSalesTable(filtered);
    updateSalesKpis(filtered);
  }

  var salesTabInitialized = false;
  function initSalesTab() {
    if (salesTabInitialized) return;
    salesTabInitialized = true;
    renderSalesOverTimeChart(salesData);
    renderSalesByTypeChart(salesPieData);
    renderSalesTable(salesTableData);
    updateSalesKpis(salesTableData);
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

    // Edit modal — AI photo scan
    if ($('editScanPhotosBtn')) {
      $('editScanPhotosBtn').addEventListener('click', function () {
        var urls = (editKeptImages || []).slice();
        scanPhotosWithAI(urls, $('editFeedback'), $('editScanResults'), $('editScanPhotosBtn'))
          .then(function (analysis) {
            if (analysis) {
              var applyBtn = $('editScanResults').querySelector('.scan-apply-btn');
              if (applyBtn) applyBtn.onclick = function () { applyEditScanResults(analysis); };
              var dismissBtn = $('editScanResults').querySelector('.scan-dismiss-btn');
              if (dismissBtn) dismissBtn.onclick = function () { $('editScanResults').classList.add('hide'); };
            }
          });
      });
    }

    // Add form — AI photo scan (works only after save since photos need uploaded URLs)
    if ($('addScanPhotosBtn')) {
      $('addScanPhotosBtn').addEventListener('click', function () {
        showFeedback(addFeedback, 'Photos must be uploaded first. Save the vehicle, then edit it to scan photos with AI.', true);
      });
    }

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
    $('saveGoogleReviews').addEventListener('click', saveGoogleReviewsSettings);
    loadSettings();

    // Modals
    previewModal.addEventListener('click', closeModals);
    editModal.addEventListener('click', closeModals);

    // Theme toggle
    var themeBtn = $('themeToggleBtn');
    if (themeBtn) themeBtn.addEventListener('click', toggleTheme);

    // Sales tab filters
    var salesTypeFilter = $('salesFilterType');
    var salesPriceFilter = $('salesFilterPrice');
    if (salesTypeFilter) salesTypeFilter.addEventListener('change', filterSalesData);
    if (salesPriceFilter) salesPriceFilter.addEventListener('change', filterSalesData);

    // Lazy-init sales charts when Sales tab is clicked
    document.querySelectorAll('.tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        if (tab.dataset.tab === 'sales') initSalesTab();
      });
    });

    // Initial render
    renderInventoryTable();
    renderBlogList();
  }

  init();
})();
