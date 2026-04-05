/* global Chart Quill */
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
  const SALES_API = '/.netlify/functions/sales-data';
  const LEADS_API = '/.netlify/functions/leads';
  const OEM_DETECT_API = '/.netlify/functions/oem-label-detect';
  const DESCRIBE_API = '/.netlify/functions/ai-describe';
  const MPG_LOOKUP_API = '/.netlify/functions/ai-mpg-lookup';

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
  let leadsData = [];
  let leadsSummary = {};

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

  // ─── Data Migration: normalize legacy values & set defaults for new fields ──
  inventory.forEach(function(item) {
    if (item.category === 'Sedan') item.category = 'Car';
    if (item.category === 'used') item.category = '';
    if (!item.condition) item.condition = 'Used';
    if (!item.titleState) item.titleState = 'Clean';
    if (!item.warranty) item.warranty = 'Extended Warranty Available';
    if (!item.doors) item.doors = '4D';
    if (!item.cylinders) item.cylinders = '';
  });

  let currentPage = 1;
  const pageSize = 6;

  let editingItem = null;
  let filteredInventory = [];
  let vinDecodeData = null;
  let editVinDecodeData = null;
  let editPhotoFiles = [];
  let addPhotoFiles = [];
  let editKeptImages = []; // existing image keys to keep when editing
  let addPreviewIndex = 0;     // which new photo is the preview in Add form
  let editPreviewName = null;  // URL or 'new-N' identifier for preview in Edit modal
  let editFormSnapshot = null; // snapshot of initial form values for dirty-check
  let selectedSkus = new Set();  // multi-select for bulk delete
  // Deleted vehicles are permanently removed — no tracking needed.
  // Sold vehicles stay in inventory with status 'sold' (filtered from live site).
  localStorage.removeItem('dashboardDeletedVehicles'); // clean up old tracking data

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

  // ─── Chip/Tag Input ─────────────────────────────────────────────────────────
  function initChipInput(wrapId, hiddenId) {
    var wrap = $(wrapId);
    var hiddenInput = $(hiddenId);
    var textInput = wrap && wrap.querySelector('.chips-text-input');
    if (!wrap || !hiddenInput || !textInput) return;

    function syncHidden() {
      var chips = wrap.querySelectorAll('.chip-tag');
      var values = [];
      chips.forEach(function (chip) { values.push(chip.dataset.value); });
      hiddenInput.value = values.join(', ');
      hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function addChip(value) {
      value = value.trim();
      if (!value) return;
      var existing = Array.from(wrap.querySelectorAll('.chip-tag')).map(function (c) { return c.dataset.value; });
      if (existing.indexOf(value) !== -1) return;
      var chip = document.createElement('span');
      chip.className = 'chip-tag';
      chip.dataset.value = value;
      chip.innerHTML = value + '<button type="button" class="chip-remove" aria-label="Remove ' + value + '">&times;</button>';
      chip.querySelector('.chip-remove').addEventListener('click', function () { chip.remove(); syncHidden(); });
      wrap.insertBefore(chip, textInput);
      syncHidden();
    }

    function refreshFromValue() {
      wrap.querySelectorAll('.chip-tag').forEach(function (c) { c.remove(); });
      var val = hiddenInput.value;
      if (val) { val.split(',').forEach(function (v) { if (v.trim()) addChip(v.trim()); }); }
      textInput.value = '';
    }

    textInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        var val = textInput.value.replace(',', '').trim();
        if (val) { addChip(val); textInput.value = ''; }
      } else if (e.key === 'Backspace' && !textInput.value) {
        var chips = wrap.querySelectorAll('.chip-tag');
        if (chips.length) { chips[chips.length - 1].remove(); syncHidden(); }
      }
    });

    textInput.addEventListener('blur', function () {
      var val = textInput.value.trim();
      if (val) { addChip(val); textInput.value = ''; }
    });

    wrap.addEventListener('click', function (e) {
      if (e.target === wrap) textInput.focus();
    });

    refreshFromValue();
    hiddenInput._refreshChips = refreshFromValue;
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


  // Automotive-aware title case normalization
  var DB_UPPER_WORDS = new Set([
    'BMW', 'GMC', 'RAM', 'AMG', 'GT', 'SRT', 'TRD',
    'XLE', 'XSE', 'SE', 'LE', 'LT', 'LTZ', 'AWD', 'FWD', 'RWD', 'SUV',
  ]);
  function normalizeVehicleText(str) {
    var s = String(str == null ? '' : str).trim().replace(/\s+/g, ' ');
    if (!s) return '';
    return s.toLowerCase().split(' ').filter(Boolean).map(function (word) {
      var bare = word.replace(/-/g, '').toUpperCase();
      if (DB_UPPER_WORDS.has(bare)) return bare;
      return word.split('-').map(function (seg) {
        if (!seg) return seg;
        return seg.charAt(0).toUpperCase() + seg.slice(1);
      }).join('-');
    }).join(' ');
  }

  // ─── Custom Confirm Dialog ────────────────────────────────────────────────
  // showConfirm(title, message, { okLabel?, danger? }) → Promise<boolean>
  function showConfirm(title, message, opts) {
    return new Promise(function (resolve) {
      var overlay = $('confirmOverlay');
      var titleEl = $('confirmTitle');
      var msgEl = $('confirmMessage');
      var okBtn = $('confirmOkBtn');
      var cancelBtn = $('confirmCancelBtn');
      if (!overlay || !titleEl || !msgEl || !okBtn || !cancelBtn) {
        resolve(window.confirm(message)); // fallback to native
        return;
      }
      titleEl.textContent = title;
      msgEl.textContent = message;
      okBtn.textContent = (opts && opts.okLabel) ? opts.okLabel : 'Confirm';
      okBtn.className = (opts && opts.danger) ? 'primary-btn danger-btn' : 'primary-btn';
      overlay.classList.remove('hide');
      function cleanup() {
        overlay.classList.add('hide');
        okBtn.removeEventListener('click', onOk);
        cancelBtn.removeEventListener('click', onCancel);
        overlay.removeEventListener('click', onBackdrop);
      }
      function onOk() { cleanup(); resolve(true); }
      function onCancel() { cleanup(); resolve(false); }
      function onBackdrop(e) { if (e.target === overlay) { cleanup(); resolve(false); } }
      okBtn.addEventListener('click', onOk);
      cancelBtn.addEventListener('click', onCancel);
      overlay.addEventListener('click', onBackdrop);
    });
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
  var MAX_PHOTO_SIZE_BYTES = 5 * 1024 * 1024; // 5MB per photo

  async function uploadPhotoToBlobs(file, stockNumber, photoIndex) {
    var session = JSON.parse(sessionStorage.getItem('bf_admin_session') || '{}');
    if (!session.username || !session.passwordHash) {
      throw new Error('Not authenticated. Please log in again.');
    }
    // Client-side file size check to fail fast before base64 encoding
    if (file.size > MAX_PHOTO_SIZE_BYTES) {
      throw new Error('Photo "' + (file.name || 'unknown') + '" exceeds 5MB limit (' + (file.size / 1024 / 1024).toFixed(1) + 'MB).');
    }
    var base64 = await new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result.split(',')[1]); };
      reader.onerror = function () { reject(new Error('Failed to read file: ' + (file.name || 'unknown'))); };
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
      throw new Error(err.error || 'Photo upload failed for ' + (file.name || 'photo ' + photoIndex));
    }
    var data = await res.json();
    return data.key; // e.g. "blob:D2601-01.png"
  }

  async function uploadPhotos(files, stockNumber, progressCb) {
    var keys = [];
    var errors = [];
    for (var i = 0; i < files.length; i++) {
      if (progressCb) progressCb(i + 1, files.length);
      try {
        var key = await uploadPhotoToBlobs(files[i], stockNumber, i + 1);
        keys.push(key);
      } catch (err) {
        errors.push({ index: i, name: files[i].name, error: err.message });
      }
    }
    // If ALL photos failed, throw. If some failed, warn but continue.
    if (keys.length === 0 && errors.length > 0) {
      throw new Error('All photo uploads failed. First error: ' + errors[0].error);
    }
    if (errors.length > 0) {
      console.warn('Photo upload partial failure:', errors);
    }
    return keys;
  }

  // ─── OEM Label Detection ──────────────────────────────────────────────────
  // After upload, scan each photo via GPT-4o Vision to detect OEM labels
  // and extract paint codes / color names.
  async function detectOemLabels(imageKeys) {
    var session = JSON.parse(sessionStorage.getItem('bf_admin_session') || '{}');
    if (!session.username || !session.passwordHash) return { oem_scan: null, photo_roles: [] };

    var siteOrigin = window.location.origin;
    var photoRoles = [];
    var oemScan = null;

    for (var i = 0; i < imageKeys.length; i++) {
      var key = imageKeys[i];
      // Resolve blob key to a public URL the serverless function can fetch
      var imageUrl;
      if (key.startsWith('blob:')) {
        imageUrl = siteOrigin + '/photos/' + key.slice(5);
      } else if (key.startsWith('http')) {
        imageUrl = key;
      } else {
        imageUrl = siteOrigin + '/assets/vehicles/' + key;
      }

      try {
        var res = await fetch(OEM_DETECT_API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            auth: { user: session.username, passwordHash: session.passwordHash },
            imageUrl: imageUrl,
          }),
        });
        if (!res.ok) continue;
        var data = await res.json();
        if (data.ok && data.is_oem_label_photo) {
          photoRoles.push({ filename: key, role: 'oem_label_processing_only' });
          // Keep the first high-confidence detection as the OEM scan
          if (!oemScan || (data.extraction_confidence || 0) > (oemScan.confidence || 0)) {
            oemScan = {
              paint_code: data.extracted_paint_code || '',
              color_name: data.extracted_color_name || '',
              raw_text: data.raw_extracted_text || '',
              confidence: data.extraction_confidence || 0,
              source_image: key,
            };
          }
        }
      } catch (err) {
        console.warn('OEM detection failed for ' + key + ':', err.message);
      }
    }
    return { oem_scan: oemScan, photo_roles: photoRoles };
  }

  // ─── OEM Detection Preview (renders into #oemPreview container) ──────────
  function renderOemPreview(vehicle) {
    var container = document.getElementById('oemPreview');
    if (!container) return;
    var scan = vehicle.oem_scan;
    if (!scan) {
      container.innerHTML = '<span style="color:#999;font-size:.85rem;">No OEM label detected</span>';
      return;
    }
    var swatchHtml = '';
    var cd = vehicle.color_display;
    if (cd && cd.web_swatch_hex) {
      swatchHtml = '<span style="display:inline-block;width:16px;height:16px;border-radius:3px;background:' + cd.web_swatch_hex + ';border:1px solid #ccc;vertical-align:middle;margin-right:6px;"></span>';
    }
    var confPct = Math.round((scan.confidence || 0) * 100);
    var confColor = confPct >= 80 ? '#28a745' : confPct >= 50 ? '#ffc107' : '#dc3545';
    container.innerHTML =
      '<div style="background:#f8f9fa;border:1px solid #dee2e6;border-radius:6px;padding:10px 14px;margin-top:8px;">' +
      '<div style="font-weight:600;margin-bottom:6px;font-size:.9rem;">OEM Label Detected</div>' +
      '<div style="display:grid;grid-template-columns:auto 1fr;gap:4px 12px;font-size:.85rem;">' +
      '<span style="color:#666;">Paint Code:</span><span style="font-weight:600;">' + (scan.paint_code || '—') + '</span>' +
      '<span style="color:#666;">Color Name:</span><span>' + swatchHtml + (scan.color_name || (cd && cd.exterior_color_name) || '—') + '</span>' +
      '<span style="color:#666;">Confidence:</span><span style="color:' + confColor + ';font-weight:600;">' + confPct + '%</span>' +
      '<span style="color:#666;">Source:</span><span style="font-size:.8rem;color:#888;">' + (scan.source_image || '—') + '</span>' +
      '</div></div>';
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
  var autoPublishInProgress = false; // prevent concurrent publishes from same browser

  async function autoPublish() {
    if (autoPublishInProgress) {
      throw new Error('A publish is already in progress. Please wait.');
    }

    var session = JSON.parse(sessionStorage.getItem('bf_admin_session') || '{}');
    if (!session.username) {
      throw new Error('Not authenticated. Please log in again.');
    }

    autoPublishInProgress = true;
    try {
      // Build publish-ready inventory — exclude sold and pending-delete vehicles from live site
      var vehicles = inventory.filter(function (v) { return v.status !== 'sold' && !v._pendingDelete; }).map(function (item) {
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
          condition: item.condition || 'Used',
          titleState: item.titleState || 'Clean',
          warranty: item.warranty || 'Extended Warranty Available',
          cylinders: item.cylinders || '',
          doors: item.doors || '',
          images: item.images || [],
          dateAdded: item.dateAdded || new Date().toISOString().split('T')[0],
          paintCode: item.paintCode || '',
          oem_scan: item.oem_scan || null,
          photo_roles: item.photo_roles || [],
          color_display: item.color_display || null,
        };
      });

      // Pre-publish validation: reject if any vehicle is missing required fields
      var invalid = vehicles.filter(function (v) { return !v.make || !v.model; });
      if (invalid.length > 0) {
        throw new Error(invalid.length + ' vehicle(s) missing Make or Model. Fix before publishing.');
      }

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
      var stageResult = await stageRes.json().catch(function () { return {}; });
      if (!stageRes.ok) {
        var stageMsg = stageResult.error || 'Staging failed (HTTP ' + stageRes.status + ')';
        if (stageResult.details) stageMsg += ': ' + stageResult.details.slice(0, 3).join('; ');
        throw new Error(stageMsg);
      }

      // Publish
      showToast('Publishing to live site...');
      var pubRes = await fetch(PUBLISH_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          auth: { user: session.username, passwordHash: session.passwordHash || authPasswordHash },
        }),
      });
      var pubResult = await pubRes.json().catch(function () { return {}; });
      if (!pubRes.ok) throw new Error(pubResult.error || 'Publish failed (HTTP ' + pubRes.status + ')');

      // Clear draft flags after successful publish
      inventory.forEach(function(v) { delete v._bulkDraft; });
      persistInventory();

      return pubResult;
    } finally {
      autoPublishInProgress = false;
    }
  }

  // ─── Auth ───────────────────────────────────────────────────────────────────
  function toggleAuth(showDashboard, user) {
    authPanel.style.display = showDashboard ? 'none' : 'grid';
    dashboard.style.display = showDashboard ? '' : 'none';
    dashboard.setAttribute('aria-hidden', showDashboard ? 'false' : 'true');
    if (showDashboard) { dashboard.removeAttribute('inert'); } else { dashboard.setAttribute('inert', ''); }
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
        passwordHash: passwordHash, token: data.token, loginTime: Date.now(),
      }));

      toggleAuth(true, blogUser);
      loginFeedback.textContent = '';
      await Promise.all([loadBlogPosts(), loadBlogComments()]);
      // Always sync inventory from live site on login — inventory.json is the
      // source of truth. localStorage is only used as a within-session buffer.
      loadInventoryFromSite();
      // Load dashboard overview stats on login
      renderOverview();
    } catch {
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

  // ─── Add Form Dirty Check ───────────────────────────────────────────────────
  function isAddFormDirty() {
    if (!addForm) return false;
    var fields = ['addName','addSku','addCategory','addYear','addMake','addModel',
      'addTrim','addVin','addPrice','addEngine','addTransmission','addStock',
      'addMileage','addDescription'];
    for (var i = 0; i < fields.length; i++) {
      var el = $(fields[i]);
      if (el && el.value && el.value.trim()) return true;
    }
    if (addPhotoFiles.length > 0) return true;
    return false;
  }

  // ─── Tab Navigation ─────────────────────────────────────────────────────────
  function switchTab(tab) {
    // Guard: warn if leaving the Add Vehicle tab with unsaved data
    var activeTab = document.querySelector('.tab.active');
    if (activeTab && activeTab.dataset.tab === 'add' && tab.dataset.tab !== 'add') {
      if (isAddFormDirty()) {
        if (!confirm('You may lose unsaved data. Are you sure you want to continue?')) return;
      }
    }
    tabs.forEach((t) => t.classList.toggle('active', t === tab));
    panels.forEach((panel) => panel.classList.toggle('active', panel.dataset.panel === tab.dataset.tab));
    // Quill needs a visible container — init on first blog tab visit
    if (tab.dataset.tab === 'blog') initQuillEditor();
  }

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => switchTab(tab));
  });

  // Wire up "View All" / data-goto buttons — use delegation so dynamic buttons work too
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-goto]');
    if (!btn) return;
    var target = btn.dataset.goto;
    var tab = document.querySelector('.tab[data-tab="' + target + '"]');
    if (tab) switchTab(tab);
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
    var leadsData = dailyBreakdown.map(function (d) { return (d.calls || 0) + (d.forms || 0) + (d.prequalify || 0); });

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
          legend: { labels: { color: chartTextColor, font: { family: '\'Space Grotesk\'' } } },
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
  var statsLoadFailed = false; // set true in renderOverview catch, false on success

  function clearSubtabLoadingStates(subtab) {
    if (subtab === 'inventory-analytics') {
      var catBody = $('categoryTableBody');
      if (catBody && catBody.textContent.includes('Loading')) catBody.innerHTML = '<tr><td colspan="5" class="muted">No data available</td></tr>';
      var tvBody = $('topVehiclesBody');
      if (tvBody && tvBody.textContent.includes('Loading')) tvBody.innerHTML = '<tr><td colspan="5" class="muted">No data available</td></tr>';
    }
    if (subtab === 'leads') {
      var refBody = $('referrerTableBody');
      if (refBody && refBody.textContent.includes('Loading')) refBody.innerHTML = '<tr><td colspan="3" class="muted">No data available</td></tr>';
    }
  }

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
        if (currentSubtab === 'leads') { renderLeadsPanel(statsCache.data); fetchLeads('active'); }
        if (currentSubtab === 'inventory-analytics') renderInventoryAnalytics(statsCache.data);
        if (currentSubtab === 'insights') renderInsightsPanel(statsCache.data);
      } else if (statsLoadFailed) {
        clearSubtabLoadingStates(currentSubtab);
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

    var statsLoadTimeout = new Promise(function (_, reject) {
      setTimeout(function () { reject(new Error('timeout')); }, 5000);
    });
    try {
      var stats = await Promise.race([fetchDashboardStats(currentPeriod), statsLoadTimeout]);
      statsLoadFailed = false;
      var errBanner = $('statsErrorBanner');
      if (errBanner) errBanner.classList.add('hide');
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
      $('kpiPrequalify').textContent = String(stats.prequalifySubmitted || 0);
      var pqMeta = $('kpiPrequalifyMeta');
      if (pqMeta) pqMeta.textContent = 'this ' + currentPeriod;
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
          '<div class="activity-item"><strong>' + (today.prequalify || 0) + '</strong> pre-qualify apps today</div>' +
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
      if (currentSubtab === 'leads') { renderLeadsPanel(stats); fetchLeads('active'); }
      if (currentSubtab === 'inventory-analytics') renderInventoryAnalytics(stats);
      if (currentSubtab === 'insights') renderInsightsPanel(stats);

    } catch (err) {
      console.warn('Dashboard stats unavailable:', err.message);
      statsLoadFailed = true;
      var errBanner2 = $('statsErrorBanner');
      if (errBanner2) errBanner2.classList.remove('hide');
      // Numeric KPIs: show 0 rather than blank
      var numericKpiIds = [
        'kpiVisitors', 'kpiUniques', 'kpiInventory', 'kpiSold', 'kpiLeads', 'kpiCalls', 'kpiForms',
        'kpiPrequalify', 'kpiLeadsTotal2', 'kpiHotLeads', 'kpiWarmLeads', 'kpiColdLeads',
        'kpiPhoneLeads2', 'kpiFormLeads2', 'kpiPrequalifyLeads2', 'kpiTotalVehicles',
      ];
      numericKpiIds.forEach(function (id) { var el = $(id); if (el) el.textContent = '0'; });
      // Text/ratio KPIs: show dash
      var dashKpiIds = [
        'kpiConversion', 'kpiDeviceSplit', 'kpiBounce', 'kpiNewReturn', 'kpiSessionDuration',
        'kpiDaysOnLot', 'kpiInventoryValue', 'kpiMostViewed', 'kpiLeadConversion', 'kpiLeadToSale',
      ];
      dashKpiIds.forEach(function (id) { var el = $(id); if (el) el.textContent = '-'; });
      topPagesBody = $('topPagesBody');
      if (topPagesBody) topPagesBody.innerHTML = '<tr><td colspan="2" class="muted">No data available</td></tr>';
      actEl = $('recentActivity');
      if (actEl) actEl.innerHTML = '<p class="muted">Analytics will appear after deployment.</p>';
      var refBody = $('referrerTableBody');
      if (refBody) refBody.innerHTML = '<tr><td colspan="3" class="muted">No data available</td></tr>';
      // Clear inventory-analytics loading states
      var catBody = $('categoryTableBody');
      if (catBody) catBody.innerHTML = '<tr><td colspan="5" class="muted">No data available</td></tr>';
      var tvBody = $('topVehiclesBody');
      if (tvBody) tvBody.innerHTML = '<tr><td colspan="5" class="muted">No data available</td></tr>';
      // Clear leads DB loading state so it doesn't show "Loading leads..." forever
      var leadDbBody = $('leadDbBody');
      if (leadDbBody && leadDbBody.textContent.includes('Loading')) {
        leadDbBody.innerHTML = '<tr><td colspan="7" class="muted">Could not load leads. <button class="ghost-btn" id="leadRetryBtn" type="button">Retry</button></td></tr>';
      }
    }
  }

  // ─── Leads & Conversion Sub-Tab ────────────────────────────────────────────
  function renderLeadsPanel(stats) {
    var setVal = function (id, val) { var el = $(id); if (el) el.textContent = String(val); };

    // Lead KPI cards are populated by fetchLeads() with actual database counts
    setVal('kpiPhoneLeads2', stats.callsFromWebsite);
    setVal('kpiFormLeads2', stats.formsSubmitted);
    setVal('kpiPrequalifyLeads2', stats.prequalifySubmitted || 0);
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
            labels: ['Phone Calls', 'Form Submissions', 'Pre-Qualify (No SSN)'],
            datasets: [{
              data: [stats.callsFromWebsite || 0, stats.formsSubmitted || 0, stats.prequalifySubmitted || 0],
              backgroundColor: ['#6767f7', '#37bc7b', '#f59e0b'],
              borderWidth: 0,
            }],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { position: 'bottom', labels: { color: chartTextColor, font: { family: '\'Space Grotesk\'' } } },
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
              {
                label: 'Pre-Qualify (No SSN)',
                data: stats.dailyBreakdown.map(function (d) { return d.prequalify || 0; }),
                borderColor: '#f59e0b',
                tension: 0.3,
                pointRadius: 3,
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { labels: { color: chartTextColor, font: { family: '\'Space Grotesk\'' } } },
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

  // ─── Lead Manager ──────────────────────────────────────────────────────────

  async function fetchLeads(outcomeFilter) {
    var authStr = getAuthStr();
    if (!authStr) return;
    var url = LEADS_API;
    if (outcomeFilter && outcomeFilter !== 'all') {
      url += '?outcome=' + outcomeFilter;
    }
    try {
      var res = await fetch(url, { headers: { 'Authorization': 'Basic ' + authStr } });
      if (!res.ok) throw new Error('Failed to fetch leads');
      var data = await res.json();
      leadsData = data.leads || [];
      leadsSummary = data.summary || {};
      // Update KPI cards with actual lead counts from database
      var el;
      el = $('kpiLeadsTotal2'); if (el) el.textContent = String(leadsSummary.active || 0);
      el = $('kpiHotLeads'); if (el) el.textContent = String(leadsSummary.hot || 0);
      el = $('kpiWarmLeads'); if (el) el.textContent = String(leadsSummary.warm || 0);
      el = $('kpiColdLeads'); if (el) el.textContent = String(leadsSummary.cold || 0);
      renderLeadPipeline();
      renderLeadDatabase();
    } catch (err) {
      console.error('Fetch leads error:', err);
    }
  }

  function formatLeadDate(ts) {
    if (!ts) return '-';
    var d = new Date(ts);
    var month = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    var yr = String(d.getFullYear()).slice(2);
    return month + '/' + day + '/' + yr;
  }

  function timeAgo(ts) {
    if (!ts) return '';
    var diff = Date.now() - ts;
    var mins = Math.floor(diff / 60000);
    if (mins < 60) return mins + 'm ago';
    var hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + 'h ago';
    var days = Math.floor(hrs / 24);
    if (days === 1) return '1 day ago';
    return days + ' days ago';
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  // Human-readable form type labels for the dashboard
  var formTypeLabels = {
    'financing-application': 'Financing',
    'offer-request': 'Offer',
    'test-drive-request': 'Test Drive',
    'trade-in-request': 'Trade-In',
    'consignment-request': 'Consignment',
    'contact-request': 'Contact',
  };

  function leadTitle(lead) {
    // Use vehicle name/stock if available, otherwise show form type or contact name
    if (lead.vehicleName) return lead.vehicleName;
    if (lead.stockNumber) return lead.stockNumber;
    var ft = formTypeLabels[lead.formType] || lead.formDisplayName || '';
    if (ft) return ft + ' Inquiry';
    if (lead.contactName) return lead.contactName;
    return 'General Inquiry';
  }

  function formTypeBadge(lead) {
    var label = formTypeLabels[lead.formType] || lead.formDisplayName || lead.formType || '';
    if (!label) return '';
    return '<span class="lead-form-badge">' + escapeHtml(label) + '</span>';
  }

  function renderLeadCard(lead) {
    var sourceIcons = { phone: '&#128222;', form: '&#128233;', prequalify: '&#128179;', walkin: '&#128694;', other: '&#128172;' };
    var sourceIcon = sourceIcons[lead.source] || sourceIcons.other;
    var title = leadTitle(lead);
    var contact = lead.contactName || lead.contactPhone || lead.contactEmail || '';
    var decayBadge = lead.decayedFrom ? '<span class="lead-decay-badge">Decayed from ' + lead.decayedFrom + '</span>' : '';
    var ftBadge = formTypeBadge(lead);

    var pdfBtn = lead.dealershipPdfKey
      ? '<button class="lead-action-btn lead-btn-pdf" type="button" data-action="download-pdf" data-id="' + lead.id + '" title="Download Financing PDF">&#128196; PDF</button>'
      : '';

    return '<div class="lead-card" data-lead-id="' + lead.id + '">' +
      '<div class="lead-card-top">' +
        '<span class="lead-source-icon">' + sourceIcon + '</span>' +
        '<div class="lead-card-info">' +
          '<strong class="lead-card-title">' + escapeHtml(title) + '</strong>' +
          (ftBadge ? '<span class="lead-card-type">' + ftBadge + '</span>' : '') +
          (contact ? '<span class="lead-card-contact">' + escapeHtml(contact) + '</span>' : '') +
          (lead.vehiclePrice ? '<span class="lead-card-price">$' + Number(lead.vehiclePrice).toLocaleString() + '</span>' : '') +
        '</div>' +
        '<span class="lead-card-time">' + timeAgo(lead.createdAt) + '</span>' +
      '</div>' +
      (decayBadge ? '<div class="lead-card-decay">' + decayBadge + '</div>' : '') +
      (lead.notes ? '<p class="lead-card-notes">' + escapeHtml(lead.notes).slice(0, 80) + '</p>' : '') +
      '<div class="lead-card-actions">' +
        '<button class="lead-action-btn lead-btn-convert" type="button" data-action="convert" data-id="' + lead.id + '" title="Mark as converted">&#10003; Converted</button>' +
        '<button class="lead-action-btn lead-btn-lost" type="button" data-action="lost" data-id="' + lead.id + '" title="Mark as lost">&#10007; Lost</button>' +
        '<button class="lead-action-btn lead-btn-edit" type="button" data-action="edit" data-id="' + lead.id + '" title="Edit lead">&#9998;</button>' +
        pdfBtn +
      '</div>' +
    '</div>';
  }

  function renderLeadPipeline() {
    var activeLeads = leadsData.filter(function (l) { return l.outcome === 'active'; });
    var hot = activeLeads.filter(function (l) { return l.status === 'hot'; });
    var warm = activeLeads.filter(function (l) { return l.status === 'warm'; });
    var cold = activeLeads.filter(function (l) { return l.status === 'cold'; });

    var hotList = $('leadListHot');
    var warmList = $('leadListWarm');
    var coldList = $('leadListCold');

    if (hotList) hotList.innerHTML = hot.length ? hot.map(renderLeadCard).join('') : '<p class="muted lead-empty">No hot leads</p>';
    if (warmList) warmList.innerHTML = warm.length ? warm.map(renderLeadCard).join('') : '<p class="muted lead-empty">No warm leads</p>';
    if (coldList) coldList.innerHTML = cold.length ? cold.map(renderLeadCard).join('') : '<p class="muted lead-empty">No cold leads</p>';

    var countHot = $('leadCountHot');
    var countWarm = $('leadCountWarm');
    var countCold = $('leadCountCold');
    if (countHot) countHot.textContent = hot.length;
    if (countWarm) countWarm.textContent = warm.length;
    if (countCold) countCold.textContent = cold.length;
  }

  function renderLeadDatabase() {
    var body = $('leadDbBody');
    if (!body) return;

    var searchTerm = ($('leadSearchInput') || {}).value || '';
    var dbFilter = ($('leadDbFilter') || {}).value || 'all';
    var filtered = leadsData;

    if (dbFilter !== 'all') {
      filtered = filtered.filter(function (l) { return l.outcome === dbFilter; });
    }

    if (searchTerm) {
      var lower = searchTerm.toLowerCase();
      filtered = filtered.filter(function (l) {
        return (l.vehicleName || '').toLowerCase().indexOf(lower) !== -1 ||
               (l.stockNumber || '').toLowerCase().indexOf(lower) !== -1 ||
               (l.contactName || '').toLowerCase().indexOf(lower) !== -1 ||
               (l.contactPhone || '').toLowerCase().indexOf(lower) !== -1 ||
               (l.contactEmail || '').toLowerCase().indexOf(lower) !== -1 ||
               (l.formType || '').toLowerCase().indexOf(lower) !== -1;
      });
    }

    // Sort newest first
    filtered = filtered.slice().sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });

    if (!filtered.length) {
      body.innerHTML = '<tr><td colspan="7" class="muted">No leads found</td></tr>';
      return;
    }

    var statusLabels = { hot: '<span class="lead-status-badge hot">Hot</span>', warm: '<span class="lead-status-badge warm">Warm</span>', cold: '<span class="lead-status-badge cold">Cold</span>' };
    var sourceLabels = { phone: 'Phone', form: 'Form', prequalify: 'Pre-Qualify', walkin: 'Walk-in', other: 'Other' };
    var outcomeLabels = { active: '<span class="lead-outcome active">Active</span>', converted: '<span class="lead-outcome converted">Converted</span>', lost: '<span class="lead-outcome lost">Lost</span>' };

    body.innerHTML = filtered.map(function (l) {
      var title = leadTitle(l);
      var contact = l.contactName || l.contactEmail || l.contactPhone || '';
      var ftLabel = formTypeLabels[l.formType] || l.formDisplayName || l.formType || '-';
      return '<tr>' +
        '<td><strong>' + escapeHtml(title) + '</strong>' + (contact ? '<br><span class="muted small">' + escapeHtml(contact) + '</span>' : '') + '</td>' +
        '<td>' + escapeHtml(ftLabel) + '</td>' +
        '<td>' + (statusLabels[l.status] || l.status) + '</td>' +
        '<td>' + (sourceLabels[l.source] || l.source) + '</td>' +
        '<td>' + formatLeadDate(l.createdAt) + '</td>' +
        '<td>' + (outcomeLabels[l.outcome] || l.outcome) + '</td>' +
        '<td class="lead-db-actions">' +
          (l.outcome === 'active' ?
            '<button class="lead-action-btn lead-btn-convert small" data-action="convert" data-id="' + l.id + '">&#10003;</button>' +
            '<button class="lead-action-btn lead-btn-lost small" data-action="lost" data-id="' + l.id + '">&#10007;</button>' : '') +
          '<button class="lead-action-btn lead-btn-edit small" data-action="edit" data-id="' + l.id + '">&#9998;</button>' +
          '<button class="lead-action-btn lead-btn-delete small" data-action="delete" data-id="' + l.id + '">&#128465;</button>' +
        '</td></tr>';
    }).join('');
  }

  async function updateLead(id, updates) {
    var authStr = getAuthStr();
    if (!authStr) return;
    try {
      var res = await fetch(LEADS_API + '?id=' + encodeURIComponent(id), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Basic ' + authStr },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error('Update failed');
      await fetchLeads(($('leadFilterOutcome') || {}).value || 'active');
    } catch (err) {
      console.error('Update lead error:', err);
      alert('Failed to update lead: ' + err.message);
    }
  }

  async function deleteLead(id) {
    if (!confirm('Delete this lead permanently?')) return;
    var authStr = getAuthStr();
    if (!authStr) return;
    try {
      var res = await fetch(LEADS_API + '?id=' + encodeURIComponent(id), {
        method: 'DELETE',
        headers: { 'Authorization': 'Basic ' + authStr },
      });
      if (!res.ok) throw new Error('Delete failed');
      await fetchLeads(($('leadFilterOutcome') || {}).value || 'active');
    } catch (err) {
      console.error('Delete lead error:', err);
      alert('Failed to delete lead: ' + err.message);
    }
  }

  async function downloadDealershipPdf(leadId) {
    var authStr = getAuthStr();
    if (!authStr) return;
    try {
      var res = await fetch(LEADS_API + '?action=download-pdf&id=' + encodeURIComponent(leadId), {
        headers: { 'Authorization': 'Basic ' + authStr },
      });
      if (!res.ok) {
        var errBody = await res.json().catch(function () { return {}; });
        throw new Error(errBody.error || 'Download failed');
      }
      var blob = await res.blob();
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'bellsfork-financing-application.pdf';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('PDF download error:', err);
      alert('Failed to download PDF: ' + err.message);
    }
  }

  async function saveLead(leadData) {
    var authStr = getAuthStr();
    if (!authStr) return;
    var id = leadData.id;
    delete leadData.id;
    try {
      var url = id ? LEADS_API + '?id=' + encodeURIComponent(id) : LEADS_API;
      var method = id ? 'PUT' : 'POST';
      var res = await fetch(url, {
        method: method,
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Basic ' + authStr },
        body: JSON.stringify(leadData),
      });
      if (!res.ok) throw new Error('Save failed');
      closeLeadModal();
      await fetchLeads(($('leadFilterOutcome') || {}).value || 'active');
    } catch (err) {
      console.error('Save lead error:', err);
      alert('Failed to save lead: ' + err.message);
    }
  }

  function openLeadModal(lead) {
    var modal = $('leadModal');
    if (!modal) return;
    var title = $('leadModalTitle');
    if (title) title.textContent = lead ? 'Edit Lead' : 'Add Lead';

    $('leadFormId').value = lead ? lead.id : '';
    $('leadFormStatus').value = lead ? lead.status : 'hot';
    $('leadFormSource').value = lead ? lead.source : 'phone';
    $('leadFormStock').value = lead ? (lead.stockNumber || '') : '';
    $('leadFormVehicle').value = lead ? (lead.vehicleName || '') : '';
    $('leadFormName').value = lead ? (lead.contactName || '') : '';
    $('leadFormPhone').value = lead ? (lead.contactPhone || '') : '';
    $('leadFormEmail').value = lead ? (lead.contactEmail || '') : '';
    $('leadFormPrice').value = lead ? (lead.vehiclePrice || '') : '';
    $('leadFormNotes').value = lead ? (lead.notes || '') : '';

    modal.classList.add('show');
  }

  function closeLeadModal() {
    var modal = $('leadModal');
    if (modal) modal.classList.remove('show');
  }

  // Lead action delegation (convert, lost, edit, delete)
  function handleLeadAction(e) {
    var btn = e.target.closest('[data-action]');
    if (!btn) return;
    var action = btn.getAttribute('data-action');
    var id = btn.getAttribute('data-id');
    if (!action || !id) return;

    if (action === 'convert') {
      updateLead(id, { outcome: 'converted' });
    } else if (action === 'lost') {
      updateLead(id, { outcome: 'lost' });
    } else if (action === 'delete') {
      deleteLead(id);
    } else if (action === 'edit') {
      var lead = leadsData.find(function (l) { return l.id === id; });
      if (lead) openLeadModal(lead);
    } else if (action === 'download-pdf') {
      downloadDealershipPdf(id);
    }
  }

  // Initialize lead manager event listeners
  function initLeadManager() {
    // Pipeline click delegation
    var pipeline = $('leadPipeline');
    if (pipeline) pipeline.addEventListener('click', handleLeadAction);

    // Database click delegation
    var dbTable = $('leadDbTable');
    if (dbTable) dbTable.addEventListener('click', handleLeadAction);

    // Add lead button
    var addBtn = $('addLeadBtn');
    if (addBtn) addBtn.addEventListener('click', function () { openLeadModal(null); });

    // Refresh button
    var refreshBtn = $('refreshLeadsBtn');
    if (refreshBtn) refreshBtn.addEventListener('click', function () {
      fetchLeads(($('leadFilterOutcome') || {}).value || 'active');
    });

    // Outcome filter
    var outcomeFilter = $('leadFilterOutcome');
    if (outcomeFilter) outcomeFilter.addEventListener('change', function () {
      fetchLeads(this.value);
    });

    // Database filter and search
    var dbFilter = $('leadDbFilter');
    if (dbFilter) dbFilter.addEventListener('change', renderLeadDatabase);
    var searchInput = $('leadSearchInput');
    if (searchInput) searchInput.addEventListener('input', renderLeadDatabase);

    // Lead modal
    var modalClose = $('leadModalClose');
    if (modalClose) modalClose.addEventListener('click', closeLeadModal);
    var modalCancel = $('leadFormCancel');
    if (modalCancel) modalCancel.addEventListener('click', closeLeadModal);

    var leadForm = $('leadForm');
    if (leadForm) leadForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var data = {
        id: $('leadFormId').value || undefined,
        status: $('leadFormStatus').value,
        source: $('leadFormSource').value,
        stockNumber: $('leadFormStock').value,
        vehicleName: $('leadFormVehicle').value,
        contactName: $('leadFormName').value,
        contactPhone: $('leadFormPhone').value,
        contactEmail: $('leadFormEmail').value,
        vehiclePrice: $('leadFormPrice').value ? Number($('leadFormPrice').value) : null,
        notes: $('leadFormNotes').value,
      };
      saveLead(data);
    });

    // Close modal on backdrop click
    var modal = $('leadModal');
    if (modal) modal.addEventListener('click', function (e) {
      if (e.target === modal) closeLeadModal();
    });
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
    } catch { showFeedback($('goalsFeedback'), 'Error saving goals', true); }
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
      var modelLabel = [latest.year, normalizeVehicleText(latest.make), normalizeVehicleText(latest.model), latest.trim].filter(Boolean).join(' ') || latest.name || 'Unknown';
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
    // Default sort: highest price first
    filteredInventory.sort(function(a, b) { return (Number(b.price) || 0) - (Number(a.price) || 0); });
    const totalPages = Math.max(1, Math.ceil(filteredInventory.length / pageSize));
    currentPage = Math.min(currentPage, totalPages);
    const start = (currentPage - 1) * pageSize;
    const pageSlice = filteredInventory.slice(start, start + pageSize);
    inventoryTableBody.innerHTML = pageSlice.map(function(item) {
      var canFeature = item.featured || featuredCount < 5;
      var isChecked = selectedSkus.has(item.sku);
      var isPendingDelete = item._pendingDelete;
      var isDraft = item._bulkDraft;
      var rowClass = (isChecked ? 'selected-row' : '') + (isDraft ? (isChecked ? ' draft-row' : 'draft-row') : '');
      return '<tr' + (rowClass ? ' class="' + rowClass.trim() + '"' : '') + '>' +
      '<td><input type="checkbox" class="row-select" data-sku="' + item.sku + '"' + (isChecked ? ' checked' : '') + '></td>' +
      '<td>' + item.sku + '</td>' +
      '<td>' + item.name + (isPendingDelete ? ' <span class="delete-pill">Pending Delete</span>' : (isDraft ? ' <span class="draft-pill">Draft</span>' : '')) + '</td>' +
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
        (isPendingDelete
          ? '<button class="ghost-btn" data-action="undo-delete" data-sku="' + item.sku + '">Undo Delete</button>'
          : '<button class="ghost-btn" data-action="edit" data-sku="' + item.sku + '">Edit</button>' +
            '<button class="ghost-btn sold-btn" data-action="mark-sold" data-sku="' + item.sku + '"' +
              (item.status === 'sold' ? ' title="Edit sale details"' : '') + '>' +
              (item.status === 'sold' ? 'Edit Sale' : 'Mark Sold') +
            '</button>' +
            '<button class="ghost-btn danger-text" data-action="delete" data-sku="' + item.sku + '">Delete</button>'
        ) +
        (isDraft ? ' <button class="ghost-btn" data-action="undo-edit" data-sku="' + item.sku + '" title="Revert to pre-edit state">Undo Edit</button>' : '') +
      '</td></tr>';
    }).join('');
    $('pageInfo').textContent = 'Page ' + currentPage + ' / ' + totalPages;
    updateBulkBar();
    updateDraftBanner();
    // Sync select-all checkbox with current page state
    var selectAll = $('selectAllCheckbox');
    if (selectAll) {
      var pageSkus = pageSlice.map(function(v) { return v.sku; });
      selectAll.checked = pageSkus.length > 0 && pageSkus.every(function(s) { return selectedSkus.has(s); });
    }
  }

  // ─── Inventory Table Actions ────────────────────────────────────────────────
  function handleTableActions(event) {
    if (!event.target.matches('button')) return;
    const action = event.target.dataset.action;
    const sku = event.target.dataset.sku;
    // Handle undo actions (these may not have an inventory item if something went wrong)
    if (action === 'undo-edit') { undoStagedEdit(sku); return; }
    if (action === 'undo-delete') { undoStagedDelete(sku); return; }
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
    if (action === 'mark-sold') {
      openSoldModal(item);
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
      $('editCondition').value = item.condition || 'Used';
      $('editTitleState').value = item.titleState || 'Clean';
      $('editWarranty').value = item.warranty || 'Extended Warranty Available';
      $('editCylinders').value = item.cylinders || '';
      $('editDoors').value = item.doors || '4D';
      $('editDescription').value = item.description || '';
      $('editFeatures').value = Array.isArray(item.features) ? item.features.join(', ') : (item.features || '');
      if ($('editFeatures')._refreshChips) $('editFeatures')._refreshChips();
      if ($('editSwatchHex')) $('editSwatchHex').value = item.swatchHex || '';
      if ($('editSwatchPicker')) $('editSwatchPicker').value = (item.swatchHex && /^#[0-9a-fA-F]{3,6}$/.test(item.swatchHex)) ? item.swatchHex : '#d9d9d6';
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
      // Show AI autofill button if VIN or photos exist
      var editAutofill = $('editAiAutofillBtn');
      if (editAutofill) editAutofill.classList.toggle('hide', !editKeptImages.length && !($('editVin') && $('editVin').value.trim()));
      // Reset AI review panels
      if ($('editAiReview')) $('editAiReview').classList.add('hide');
      if ($('editAiStatus')) $('editAiStatus').classList.add('hide');
      editModal.classList.add('active');
      editFormSnapshot = snapshotEditForm();
    } else if (action === 'delete') {
      if (item._pendingDelete) {
        // Already pending — offer to undo
        undoStagedDelete(sku);
        return;
      }
      showConfirm(
        'Delete ' + item.name + '?',
        'Stage this vehicle for deletion? It will NOT be removed from the live site until you click "Publish to Site."',
        { okLabel: 'Stage for Deletion', danger: true }
      ).then(function (confirmed) {
        if (!confirmed) return;
        item._pendingDelete = true;
        persistInventory();
        renderInventoryTable();
        showFeedback(editFeedback, item.name + ' staged for deletion (not yet published).');
        showToast('Staged for deletion. Publish to remove from live site.', 'info');
        setTimeout(hideToast, 5000);
      });
    }
  }

  // ─── Bulk Select & Delete ──────────────────────────────────────────────────
  function updateBulkBar() {
    var bar = $('bulkBar');
    var countEl = $('bulkCount');
    if (!bar || !countEl) return;
    var hasSelection = selectedSkus.size > 0;
    bar.classList.toggle('hide', !hasSelection);
    countEl.textContent = selectedSkus.size + ' selected';
    // Keep buttons disabled when nothing is selected (defense-in-depth)
    var noSelectionTooltip = 'Select at least one vehicle to use this action';
    var editBtn = $('bulkEditBtn');
    var delBtn = $('bulkDeleteBtn');
    if (editBtn) {
      editBtn.disabled = !hasSelection;
      editBtn.title = hasSelection ? '' : noSelectionTooltip;
    }
    if (delBtn) {
      delBtn.disabled = !hasSelection;
      delBtn.title = hasSelection ? '' : noSelectionTooltip;
    }
  }

  function handleRowCheckbox(event) {
    if (!event.target.matches('.row-select')) return;
    var sku = event.target.dataset.sku;
    if (event.target.checked) {
      selectedSkus.add(sku);
      event.target.closest('tr').classList.add('selected-row');
    } else {
      selectedSkus.delete(sku);
      event.target.closest('tr').classList.remove('selected-row');
    }
    updateBulkBar();
    // Sync select-all checkbox
    var selectAll = $('selectAllCheckbox');
    if (selectAll) {
      var checkboxes = inventoryTableBody.querySelectorAll('.row-select');
      selectAll.checked = checkboxes.length > 0 && Array.from(checkboxes).every(function(cb) { return cb.checked; });
    }
  }

  function handleSelectAll(event) {
    var checked = event.target.checked;
    var checkboxes = inventoryTableBody.querySelectorAll('.row-select');
    checkboxes.forEach(function(cb) {
      cb.checked = checked;
      var sku = cb.dataset.sku;
      if (checked) {
        selectedSkus.add(sku);
        cb.closest('tr').classList.add('selected-row');
      } else {
        selectedSkus.delete(sku);
        cb.closest('tr').classList.remove('selected-row');
      }
    });
    updateBulkBar();
  }

  function handleBulkDelete() {
    if (selectedSkus.size === 0) return;
    var count = selectedSkus.size;
    showConfirm(
      'Stage ' + count + ' vehicle' + (count > 1 ? 's' : '') + ' for deletion?',
      'They will NOT be removed from the live site until you click "Publish to Site."',
      { okLabel: 'Stage for Deletion', danger: true }
    ).then(function (confirmed) {
      if (!confirmed) return;
      var staged = 0;
      inventory.forEach(function(v) {
        if (selectedSkus.has(v.sku) && !v._pendingDelete) {
          v._pendingDelete = true;
          staged++;
        }
      });
      selectedSkus.clear();
      persistInventory();
      renderInventoryTable();
      showFeedback(editFeedback, staged + ' vehicle' + (staged > 1 ? 's' : '') + ' staged for deletion (not yet published).');
      showToast('Staged for deletion. Publish to remove from live site.', 'info');
      setTimeout(hideToast, 5000);
    });
  }

  function handleBulkDeselect() {
    selectedSkus.clear();
    var checkboxes = inventoryTableBody.querySelectorAll('.row-select');
    checkboxes.forEach(function(cb) {
      cb.checked = false;
      cb.closest('tr').classList.remove('selected-row');
    });
    var selectAll = $('selectAllCheckbox');
    if (selectAll) selectAll.checked = false;
    updateBulkBar();
  }

  // ─── Draft Tracking for Bulk Edits ────────────────────────────────────────
  // Vehicles edited via bulk edit get _bulkDraft = true.
  // This flag persists in localStorage and is cleared on successful publish.

  function getDraftCount() {
    return inventory.filter(function(v) { return v._bulkDraft || v._draft || v._pendingDelete; }).length;
  }

  function updateDraftBanner() {
    var banner = $('draftBanner');
    if (!banner) return;
    var editCount = inventory.filter(function(v) { return v._bulkDraft || v._draft; }).length;
    var deleteCount = inventory.filter(function(v) { return v._pendingDelete; }).length;
    var count = editCount + deleteCount;
    if (count > 0) {
      banner.classList.remove('hide');
      var parts = [];
      if (editCount > 0) parts.push(editCount + ' unpublished edit' + (editCount > 1 ? 's' : ''));
      if (deleteCount > 0) parts.push(deleteCount + ' pending deletion' + (deleteCount > 1 ? 's' : ''));
      $('draftBannerText').textContent = parts.join(', ') + '.';
    } else {
      banner.classList.add('hide');
    }
  }

  // eslint-disable-next-line no-unused-vars
  function clearDraftFlags() {
    inventory.forEach(function(v) { delete v._bulkDraft; delete v._draft; delete v._pendingDelete; });
    persistInventory();
    updateDraftBanner();
    renderInventoryTable();
  }

  function undoStagedEdit(sku) {
    var item = inventory.find(function(v) { return v.sku === sku; });
    if (item) { delete item._draft; delete item._bulkDraft; persistInventory(); renderInventoryTable(); updateDraftBanner(); }
  }

  function undoStagedDelete(sku) {
    var item = inventory.find(function(v) { return v.sku === sku; });
    if (item) { delete item._pendingDelete; persistInventory(); renderInventoryTable(); updateDraftBanner(); }
  }

  // ─── Bulk Edit Modal ────────────────────────────────────────────────────────

  function openBulkEditModal() {
    if (selectedSkus.size === 0) return;
    var bulkEditModal = $('bulkEditModal');
    if (!bulkEditModal) return;
    $('bulkEditCount').textContent = selectedSkus.size;
    // Reset all toggles and fields
    bulkEditModal.querySelectorAll('.bulk-field-toggle').forEach(function(cb) {
      cb.checked = false;
      var input = cb.closest('.bulk-field').querySelector('input:not([type="checkbox"]), select');
      if (input) { input.disabled = true; input.value = input.tagName === 'SELECT' ? input.options[0].value : ''; }
    });
    hideFeedback($('bulkEditFeedback'));
    bulkEditModal.classList.add('active');
  }

  function handleBulkEditSubmit(event) {
    event.preventDefault();
    var bulkEditModal = $('bulkEditModal');
    if (!bulkEditModal) return;

    // Collect enabled fields and their values
    var changes = {};
    bulkEditModal.querySelectorAll('.bulk-field-toggle').forEach(function(cb) {
      if (!cb.checked) return;
      var field = cb.dataset.field;
      var input = cb.closest('.bulk-field').querySelector('input:not([type="checkbox"]), select');
      if (!input) return;
      var val = input.value;
      // Convert numeric fields
      if (field === 'price') val = Number(val) || 0;
      changes[field] = val;
    });

    if (Object.keys(changes).length === 0) {
      showFeedback($('bulkEditFeedback'), 'No fields selected. Check at least one field to apply.', true);
      return;
    }

    // Confirmation prompt
    var fieldNames = Object.keys(changes).join(', ');
    var count = selectedSkus.size;
    if (!confirm('Apply changes to ' + fieldNames + ' on ' + count + ' vehicle' + (count > 1 ? 's' : '') + '?\n\nThese changes will be saved as DRAFTS and will NOT go live until you publish.')) {
      return;
    }

    // Apply changes to selected vehicles, mark as draft
    var applied = 0;
    inventory.forEach(function(v) {
      if (!selectedSkus.has(v.sku)) return;
      Object.keys(changes).forEach(function(field) {
        v[field] = changes[field];
      });
      v._bulkDraft = true; // Mark as draft — will NOT auto-publish
      applied++;
    });

    persistInventory();
    renderInventoryTable();
    updateDraftBanner();

    // Close modal, show feedback
    bulkEditModal.classList.remove('active');
    selectedSkus.clear();
    renderInventoryTable();
    showFeedback(editFeedback, applied + ' vehicle' + (applied > 1 ? 's' : '') + ' updated (draft only — not yet published).');
    showToast('Draft saved. Use "Publish to Site" to push changes live.', 'info');
    setTimeout(hideToast, 6000);
  }

  function handleDraftPublish() {
    var count = getDraftCount();
    if (count === 0) return;
    if (!confirm('Publish all changes (' + count + ' vehicle' + (count > 1 ? 's' : '') + ') to the live site?\n\nThis will update bellsforktruckandauto.com.')) {
      return;
    }
    showToast('Publishing draft changes to live site...');
    autoPublish().then(function() {
      // Remove vehicles that were staged for deletion
      inventory = inventory.filter(function(v) { return !v._pendingDelete; });
      // Clear all draft flags after successful publish
      inventory.forEach(function(v) { delete v._bulkDraft; delete v._draft; delete v._draftSnapshot; });
      persistInventory();
      updateDraftBanner();
      renderInventoryTable();
      showToast('\u2713 All drafts published! Live in ~30 seconds.', 'success');
      setTimeout(hideToast, 5000);
    }).catch(function(err) {
      showToast('Publish error: ' + err.message, 'error');
      setTimeout(hideToast, 8000);
    });
  }

  function handleDraftDiscard() {
    var count = getDraftCount();
    if (count === 0) return;
    showConfirm(
      'Discard all unpublished changes?',
      'This will discard all ' + count + ' unpublished change' + (count > 1 ? 's' : '') + ' and reload the last published inventory from the live site. This cannot be undone.',
      { okLabel: 'Discard All', danger: true }
    ).then(function (confirmed) {
      if (!confirmed) return;
      doDiscardDrafts();
    });
  }

  function doDiscardDrafts() {
    // Reload from live site to revert drafts
    showToast('Reverting to published inventory...');
    fetch('/inventory.json')
      .then(function(res) { return res.json(); })
      .then(function(data) {
        var vehicles = data.vehicles || data;
        if (!Array.isArray(vehicles)) throw new Error('Invalid format');
        inventory = vehicles.map(function(v, i) {
          return {
            sku: v.stockNumber || v.vin || ('SITE-' + String(i + 1).padStart(3, '0')),
            name: [v.year, normalizeVehicleText(v.make), normalizeVehicleText(v.model)].filter(Boolean).join(' ') || 'Vehicle',
            category: v.type || v.category || 'Vehicle',
            quantity: 1, price: Number(v.price) || 0,
            description: v.description || '', supplier: '',
            year: v.year, make: v.make, model: v.model, trim: v.trim,
            vin: v.vin, stockNumber: v.stockNumber,
            engine: v.engine, transmission: v.transmission,
            mileage: v.mileage, mpgCity: v.mpgCity, mpgHighway: v.mpgHighway,
            exteriorColor: v.exteriorColor, interiorColor: v.interiorColor,
            features: v.features || [], status: v.status || 'available',
            badge: v.badge, featured: v.featured || false,
            drivetrain: v.drivetrain, fuelType: v.fuelType,
            condition: v.condition || 'Used', titleState: v.titleState || 'Clean',
            warranty: v.warranty || 'Extended Warranty Available',
            cylinders: v.cylinders || '', doors: v.doors || '',
            images: v.images, dateAdded: v.dateAdded,
            paintCode: v.paintCode || '', oem_scan: v.oem_scan || null,
            photo_roles: v.photo_roles || [], color_display: v.color_display || null,
          };
        });
        persistInventory();
        renderInventoryTable();
        updateDraftBanner();
        showToast('\u2713 Reverted to published inventory.', 'success');
        showFeedback(editFeedback, 'Loaded ' + inventory.length + ' vehicles from live site. All drafts discarded.');
        setTimeout(hideToast, 5000);
      })
      .catch(function(err) {
        showToast('Error reverting: ' + err.message, 'error');
        setTimeout(hideToast, 8000);
      });
  }

  // ─── Review Changes Modal ──────────────────────────────────────────────────
  var REVIEW_LABELS = {
    price: 'Price', mileage: 'Mileage', exteriorColor: 'Ext. Color',
    interiorColor: 'Int. Color', engine: 'Engine', transmission: 'Transmission',
    drivetrain: 'Drivetrain', fuelType: 'Fuel Type', mpgCity: 'MPG City',
    mpgHighway: 'MPG Hwy', trim: 'Trim', description: 'Description',
    features: 'Features', status: 'Status', badge: 'Badge', featured: 'Featured',
    condition: 'Condition', titleState: 'Title', warranty: 'Warranty',
    cylinders: 'Cylinders', doors: 'Doors', paintCode: 'Paint Code',
    year: 'Year', make: 'Make', model: 'Model',
  };

  function openReviewChanges() {
    var modal = $('reviewChangesModal');
    var list = $('reviewChangesList');
    if (!modal || !list) return;

    var drafts = inventory.filter(function(v) { return v._draft || v._bulkDraft; });
    var deletes = inventory.filter(function(v) { return v._pendingDelete; });

    if (drafts.length === 0 && deletes.length === 0) {
      list.innerHTML = '<p class="muted">No unpublished changes.</p>';
      modal.classList.add('active');
      return;
    }

    var html = '';

    drafts.forEach(function(v) {
      var snap = v._draftSnapshot;
      html += '<div style="border:1px solid #e0e0e0;border-radius:8px;padding:12px 16px;margin-bottom:12px;">';
      html += '<strong>' + (v.name || [v.year, v.make, v.model].filter(Boolean).join(' ')) + '</strong>';
      html += ' <span class="muted">(' + (v.stockNumber || v.sku) + ')</span>';

      if (snap) {
        var changes = [];
        Object.keys(REVIEW_LABELS).forEach(function(key) {
          var oldVal = snap[key];
          var newVal = v[key];
          // Normalize for comparison
          var oldStr = Array.isArray(oldVal) ? oldVal.join(', ') : String(oldVal || '');
          var newStr = Array.isArray(newVal) ? newVal.join(', ') : String(newVal || '');
          if (oldStr !== newStr) {
            changes.push({ label: REVIEW_LABELS[key], from: oldStr || '(empty)', to: newStr || '(empty)' });
          }
        });
        if (changes.length > 0) {
          html += '<table style="width:100%;margin-top:8px;font-size:13px;border-collapse:collapse;">';
          html += '<tr style="text-align:left;border-bottom:1px solid #eee;"><th style="padding:4px 8px;">Field</th><th style="padding:4px 8px;">Was</th><th style="padding:4px 8px;">Now</th></tr>';
          changes.forEach(function(c) {
            html += '<tr style="border-bottom:1px solid #f5f5f5;">';
            html += '<td style="padding:4px 8px;font-weight:500;">' + c.label + '</td>';
            html += '<td style="padding:4px 8px;color:#999;text-decoration:line-through;">' + escHtml(truncate(c.from, 60)) + '</td>';
            html += '<td style="padding:4px 8px;color:#2563eb;">' + escHtml(truncate(c.to, 60)) + '</td>';
            html += '</tr>';
          });
          html += '</table>';
        } else {
          html += '<p class="muted" style="margin:4px 0 0;">Marked as edited (no field-level diff available)</p>';
        }
      } else {
        html += '<p class="muted" style="margin:4px 0 0;">Edited (no snapshot — bulk edit or new vehicle)</p>';
      }

      html += '<button class="ghost-btn" style="margin-top:6px;font-size:12px;" data-undo-sku="' + (v.sku || '') + '">Undo</button>';
      html += '</div>';
    });

    deletes.forEach(function(v) {
      html += '<div style="border:1px solid #fee2e2;border-radius:8px;padding:12px 16px;margin-bottom:12px;background:#fff5f5;">';
      html += '<strong style="color:#dc2626;">\u2717 Pending Deletion:</strong> ';
      html += (v.name || [v.year, v.make, v.model].filter(Boolean).join(' '));
      html += ' <span class="muted">(' + (v.stockNumber || v.sku) + ')</span>';
      html += '<button class="ghost-btn" style="margin-top:6px;font-size:12px;" data-undo-delete-sku="' + (v.sku || '') + '">Undo Delete</button>';
      html += '</div>';
    });

    list.innerHTML = html;

    // Wire undo buttons
    list.querySelectorAll('[data-undo-sku]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        undoStagedEdit(btn.getAttribute('data-undo-sku'));
        openReviewChanges(); // re-render
      });
    });
    list.querySelectorAll('[data-undo-delete-sku]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        undoStagedDelete(btn.getAttribute('data-undo-delete-sku'));
        openReviewChanges(); // re-render
      });
    });

    modal.classList.add('active');
  }

  function escHtml(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
  function truncate(s, n) { return s.length > n ? s.slice(0, n) + '\u2026' : s; }

  var editSubmitInProgress = false; // double-submit guard

  async function handleEditSubmit(event) {
    event.preventDefault();
    if (!editingItem) return;

    // Prevent double submissions
    if (editSubmitInProgress) return;
    editSubmitInProgress = true;

    // Disable submit button during save
    var submitBtn = event.target.querySelector('[type="submit"]');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Saving...'; }

    try {
      // Snapshot the original state before first draft edit (for undo support)
      if (!editingItem._draft && !editingItem._draftSnapshot) {
        var snap = {};
        Object.keys(editingItem).forEach(function(k) {
          if (k !== '_draft' && k !== '_draftSnapshot' && k !== '_pendingDelete') {
            snap[k] = Array.isArray(editingItem[k]) ? editingItem[k].slice() : editingItem[k];
          }
        });
        editingItem._draftSnapshot = snap;
      }

      // Basic fields
      editingItem.name = $('editName').value.trim();
      editingItem.category = $('editCategory').value.trim();
      editingItem.year = Number($('editYear').value) || editingItem.year;
      editingItem.make = normalizeVehicleText($('editMake').value) || editingItem.make;
      editingItem.model = normalizeVehicleText($('editModel').value) || editingItem.model;
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
      editingItem.condition = $('editCondition').value || 'Used';
      editingItem.titleState = $('editTitleState').value || 'Clean';
      editingItem.warranty = $('editWarranty').value || 'Extended Warranty Available';
      editingItem.cylinders = $('editCylinders').value || '';
      editingItem.doors = $('editDoors').value || '';
      editingItem.description = $('editDescription').value.trim();
      var featVal = $('editFeatures').value.trim();
      editingItem.features = featVal ? featVal.split(',').map(function (f) { return f.trim(); }).filter(Boolean) : (editingItem.features || []);
      if ($('editSwatchHex')) editingItem.swatchHex = $('editSwatchHex').value.trim() || null;

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

      editingItem._draft = true; // Mark as staged draft — will NOT auto-publish

      // Save to localStorage
      persistInventory();
      renderInventoryTable();

      // Close modal (saved, no dirty-check needed)
      editFormSnapshot = null;
      editModal.classList.remove('active');

      showToast('Saved as draft. Use "Publish to Site" to push live.', 'info');
      setTimeout(hideToast, 5000);
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
      // Only show inline feedback if modal is still open (photo upload errors)
      if (editModal.classList.contains('active')) {
        showFeedback(editFeedback, 'Save error: ' + err.message, true);
      }
      setTimeout(hideToast, 8000);
    } finally {
      editSubmitInProgress = false;
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Save Changes'; }
      editPhotoFiles = [];
    }
  }

  // ─── Inventory Import/Export ────────────────────────────────────────────────
  function loadInventoryFromSite() {
    showToast('Loading inventory from site...');
    fetch('/inventory.json?_t=' + Date.now(), { cache: 'no-cache' })
      .then(function (res) {
        if (!res.ok) throw new Error('Server returned ' + res.status);
        return res.json();
      })
      .then(function (data) {
        var vehicles = data.vehicles || data;
        if (!Array.isArray(vehicles)) throw new Error('Invalid format');
        // Convert site format to dashboard format
        inventory = vehicles.map(function (v, i) {
          return {
            sku: v.stockNumber || v.vin || ('SITE-' + String(i + 1).padStart(3, '0')),
            name: [v.year, normalizeVehicleText(v.make), normalizeVehicleText(v.model)].filter(Boolean).join(' ') || 'Vehicle',
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
            condition: v.condition || 'Used',
            titleState: v.titleState || 'Clean',
            warranty: v.warranty || 'Extended Warranty Available',
            cylinders: v.cylinders || '',
            doors: v.doors || '',
            images: v.images,
          };
        });
        persistInventory();
        renderInventoryTable();
        showToast('Loaded ' + inventory.length + ' vehicles from site.', 'success');
        setTimeout(hideToast, 4000);
      })
      .catch(function (err) {
        showToast('Failed to load inventory: ' + err.message, 'error');
        setTimeout(hideToast, 8000);
      });
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
        var mapped = vehicles.map((v, i) => ({
          sku: v.stockNumber || v.sku || v.vin || ('IMP-' + String(i + 1).padStart(3, '0')),
          name: v.name || [v.year, normalizeVehicleText(v.make), normalizeVehicleText(v.model)].filter(Boolean).join(' ') || 'Vehicle',
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
          condition: v.condition || 'Used',
          titleState: v.titleState || 'Clean',
          warranty: v.warranty || 'Extended Warranty Available',
          cylinders: v.cylinders || '',
          doors: v.doors || '',
          images: v.images,
        }));
        inventory = mapped;
        persistInventory();
        renderInventoryTable();
        var msg = 'Imported ' + inventory.length + ' vehicles.';
        showFeedback(editFeedback, msg);
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
  var addSubmitInProgress = false; // double-submit guard

  async function handleAddSubmit(event) {
    event.preventDefault();

    // Prevent double submissions
    if (addSubmitInProgress) return;

    const name = $('addName').value.trim();
    const sku = $('addSku').value.trim();
    const category = $('addCategory').value;
    if (!name || !sku || !category) {
      showFeedback(addFeedback, 'Please fill required fields (Name, SKU, Category).', true);
      return;
    }

    // Additional required field validation for production quality
    var make = $('addMake').value.trim();
    var model = $('addModel').value.trim();
    if (!make || !model) {
      showFeedback(addFeedback, 'Make and Model are required for a valid listing.', true);
      return;
    }

    // Disable submit button and set guard
    addSubmitInProgress = true;
    var submitBtn = event.target.querySelector('[type="submit"]');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Saving...'; }

    try {
      // Check for duplicate SKU early (before photo upload to avoid wasted uploads)
      var isEditMode = $('editModeBadge') && !$('editModeBadge').classList.contains('hide');
      if (!isEditMode && inventory.some((item) => item.sku === sku)) {
        showFeedback(addFeedback, 'SKU already exists. Choose a different SKU.', true);
        return;
      }

      // Also check for duplicate VIN if provided
      var vin = $('addVin').value.trim().toUpperCase();
      if (!isEditMode && vin && inventory.some((item) => item.vin && item.vin.toUpperCase() === vin)) {
        showFeedback(addFeedback, 'A vehicle with this VIN already exists.', true);
        return;
      }

      // Upload photos FIRST — do not create vehicle record if photos fail
      var imageUrls = [];
      if (addPhotoFiles.length > 0) {
        if (addPreviewIndex > 0 && addPreviewIndex < addPhotoFiles.length) {
          var previewFile = addPhotoFiles.splice(addPreviewIndex, 1)[0];
          addPhotoFiles.unshift(previewFile);
          addPreviewIndex = 0;
        }
        var addStock = $('addStock').value.trim() || vin || sku;
        showToast('Uploading photos...');
        imageUrls = await uploadPhotos(addPhotoFiles, addStock, function (current, total) {
          showToast('Uploading photo ' + current + ' of ' + total + '...');
        });
      }

      var vehicle = buildVehicleFromForm();
      vehicle.images = imageUrls;
      vehicle.dateAdded = vehicle.dateAdded || new Date().toISOString().split('T')[0];

      // Run OEM label detection on newly uploaded photos
      if (imageUrls.length > 0) {
        showToast('Scanning photos for OEM labels...');
        try {
          var oemResult = await detectOemLabels(imageUrls);
          if (oemResult.photo_roles.length > 0) {
            vehicle.photo_roles = oemResult.photo_roles;
          }
          if (oemResult.oem_scan) {
            vehicle.oem_scan = oemResult.oem_scan;
            // Auto-fill paint code if extracted and not already set
            if (oemResult.oem_scan.paint_code && !vehicle.paintCode) {
              vehicle.paintCode = oemResult.oem_scan.paint_code;
            }
            // Resolve color display using ColorLookup if available
            if (window.ColorLookup && window.ColorLookup.resolveVehicleColorDisplay) {
              vehicle.color_display = window.ColorLookup.resolveVehicleColorDisplay(vehicle);
            }
            showToast('OEM label detected — paint code: ' + (oemResult.oem_scan.paint_code || 'N/A'), 'success');
          }
        } catch (oemErr) {
          console.warn('OEM detection error (non-fatal):', oemErr.message);
        }
        // Show OEM preview after detection
        renderOemPreview(vehicle);
      }

      if (isEditMode) {
        // Edit mode - update existing
        const idx = inventory.findIndex((item) => item.sku === sku);
        if (idx >= 0) {
          // Keep existing images if no new ones uploaded
          if (imageUrls.length === 0 && inventory[idx].images) {
            vehicle.images = inventory[idx].images;
          }
          // Preserve OEM metadata from existing record when no new photos uploaded
          if (imageUrls.length === 0) {
            vehicle.oem_scan = inventory[idx].oem_scan || vehicle.oem_scan;
            vehicle.photo_roles = inventory[idx].photo_roles || vehicle.photo_roles;
            vehicle.paintCode = inventory[idx].paintCode || vehicle.paintCode;
            vehicle.color_display = inventory[idx].color_display || vehicle.color_display;
          }
          // Preserve original dateAdded
          vehicle.dateAdded = inventory[idx].dateAdded || vehicle.dateAdded;
          inventory[idx] = vehicle;
          persistInventory();
          renderInventoryTable();
          showFeedback(addFeedback, 'Vehicle updated.');
          exitEditMode();
        }
      } else {
        inventory.unshift(vehicle);
        persistInventory();
        renderInventoryTable();
        showFeedback(addFeedback, 'Vehicle saved.');
        addForm.reset();
        addPhotoFiles = [];
        addPreviewIndex = 0;
        thumbnailCache.forEach(function (url) { if (url && url.startsWith('blob:')) URL.revokeObjectURL(url); });
        thumbnailCache.clear();
        if ($('photoPreview')) $('photoPreview').innerHTML = '';
        if ($('uploadGalleryHeader')) $('uploadGalleryHeader').classList.add('hide');
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
      addSubmitInProgress = false;
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = isEditMode ? 'Update Vehicle' : 'Save Vehicle'; }
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
      make: normalizeVehicleText($('addMake').value),
      model: normalizeVehicleText($('addModel').value),
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
      condition: $('addCondition').value || 'Used',
      titleState: $('addTitleState').value || 'Clean',
      warranty: $('addWarranty').value || 'Extended Warranty Available',
      cylinders: $('addCylinders').value,
      doors: $('addDoors').value || '4D',
      featured: false,
      images: [],
      paintCode: '',
      oem_scan: null,
      photo_roles: [],
      color_display: null,
      swatchHex: ($('addSwatchHex') ? $('addSwatchHex').value.trim() : null) || null,
    };
  }

  // eslint-disable-next-line no-unused-vars
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
    $('addCondition').value = item.condition || 'Used';
    $('addTitleState').value = item.titleState || 'Clean';
    $('addWarranty').value = item.warranty || 'Extended Warranty Available';
    $('addCylinders').value = item.cylinders || '';
    $('addDoors').value = item.doors || '4D';
    $('addDescription').value = item.description || '';
    $('addFeatures').value = (item.features || []).join(', ');
    if ($('addFeatures')._refreshChips) $('addFeatures')._refreshChips();
    if ($('addSwatchHex')) $('addSwatchHex').value = item.swatchHex || '';
    if ($('addSwatchPicker')) $('addSwatchPicker').value = (item.swatchHex && /^#[0-9a-fA-F]{3,6}$/.test(item.swatchHex)) ? item.swatchHex : '#d9d9d6';
    showWizardStep(1);

    // Store OEM metadata on the form element for preservation during edits
    var addFormEl = document.getElementById('addForm') || document.querySelector('form');
    if (addFormEl) {
      addFormEl._oemScan = item.oem_scan || null;
      addFormEl._photoRoles = item.photo_roles || [];
      addFormEl._paintCode = item.paintCode || '';
      addFormEl._colorDisplay = item.color_display || null;
    }

    // Render OEM detection preview if data exists
    renderOemPreview(item);

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
      if (!res.ok) throw new Error('VIN lookup failed (HTTP ' + res.status + ')');
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
    if (vinDecodeData.make) $('addMake').value = normalizeVehicleText(vinDecodeData.make);
    if (vinDecodeData.model) $('addModel').value = normalizeVehicleText(vinDecodeData.model);
    if (vinDecodeData.trim) $('addTrim').value = vinDecodeData.trim;
    if (vinDecodeData.engine) {
      $('addEngine').value = vinDecodeData.engine;
      var cylMatch = vinDecodeData.engine.match(/V(\d+)/i) || vinDecodeData.engine.match(/(\d+)-cyl/i);
      if (cylMatch) $('addCylinders').value = cylMatch[1];
    }
    if (vinDecodeData.transmission) {
      var transLower = vinDecodeData.transmission.toLowerCase();
      $('addTransmission').value = transLower.includes('manual') ? 'Manual' : 'Automatic';
    }
    if (vinDecodeData.doors) {
      var doorVal = String(vinDecodeData.doors).trim();
      $('addDoors').value = (doorVal === '2' || doorVal.includes('2')) ? '2D' : '4D';
    }
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
    const autoName = [vinDecodeData.year, normalizeVehicleText(vinDecodeData.make), normalizeVehicleText(vinDecodeData.model)].filter(Boolean).join(' ');
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
    const make = $('addMake').value;
    const model = $('addModel').value;
    if (!make || !model) {
      showFeedback(addFeedback, 'Enter at least Make and Model first.', true);
      return;
    }

    var session = JSON.parse(sessionStorage.getItem('bf_admin_session') || '{}');
    if (!session.username || !session.passwordHash) {
      showFeedback(addFeedback, 'Not authenticated. Please log in again.', true);
      return;
    }

    $('generateDescBtn').disabled = true;
    $('generateDescBtn').textContent = 'Generating...';

    try {
      const res = await fetch(DESCRIBE_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          auth: { user: session.username, passwordHash: session.passwordHash },
          vehicle: {
            year: $('addYear').value,
            make: make,
            model: model,
            trim: $('addTrim').value,
            engine: $('addEngine').value,
            mileage: $('addMileage').value,
            features: $('addFeatures').value,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'AI generation failed');
      if (data.description) {
        $('addDescription').value = data.description;
        updateLivePreview();
      }
    } catch (err) {
      showFeedback(addFeedback, 'AI generation failed: ' + err.message, true);
    } finally {
      $('generateDescBtn').disabled = false;
      $('generateDescBtn').textContent = 'Generate with AI';
    }
  }

  // ─── AI MPG Lookup ─────────────────────────────────────────────────────────

  /**
   * Core MPG lookup — calls the ai-mpg-lookup serverless function.
   * @param {object} opts  { year, make, model, trim, engine, drivetrain }
   * @returns {Promise<object>}  { ok, found, mpgCity, mpgHighway, exact, source, note, message }
   */
  async function fetchMpgLookup(opts) {
    var session = JSON.parse(sessionStorage.getItem('bf_admin_session') || '{}');
    if (!session.username || !session.passwordHash) {
      throw new Error('Not authenticated. Please log in again.');
    }
    var res = await fetch(MPG_LOOKUP_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth: { user: session.username, passwordHash: session.passwordHash },
        vehicle: opts,
      }),
    });
    var data = await res.json();
    if (!res.ok) throw new Error(data.error || 'MPG lookup failed');
    return data;
  }

  /**
   * Show MPG status message next to the lookup button.
   */
  function showMpgStatus(statusEl, text, type) {
    statusEl.textContent = text;
    statusEl.className = 'mpg-status mpg-' + type; // loading | success | approx | error
    statusEl.classList.remove('hide');
  }
  // eslint-disable-next-line no-unused-vars
  function hideMpgStatus(statusEl) {
    statusEl.classList.add('hide');
    statusEl.className = 'mpg-status hide';
  }

  /**
   * MPG Lookup for Add Vehicle form.
   * @param {boolean} force  If true, overwrite existing MPG values.
   */
  async function addMpgLookup(force) {
    var make = $('addMake').value.trim();
    var model = $('addModel').value.trim();
    var statusEl = $('addMpgStatus');
    var btn = $('addMpgLookupBtn');

    if (!make || !model) {
      showMpgStatus(statusEl, 'Enter at least Make and Model first.', 'error');
      return;
    }

    // Don't overwrite existing values unless forced
    var cityEl = $('addMpgCity');
    var hwyEl = $('addMpgHighway');
    if (!force && cityEl.value && hwyEl.value) {
      showMpgStatus(statusEl, 'MPG already filled. Click again to replace.', 'approx');
      // Set a one-time flag so next click forces
      btn._mpgForceNext = true;
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Looking up MPG...';
    showMpgStatus(statusEl, 'Searching web for EPA data...', 'loading');

    try {
      var result = await fetchMpgLookup({
        year: $('addYear').value,
        make: make,
        model: model,
        trim: $('addTrim').value,
        engine: $('addEngine').value,
        drivetrain: $('addDrivetrain').value,
      });

      if (result.found && result.mpgCity && result.mpgHighway) {
        cityEl.value = result.mpgCity;
        hwyEl.value = result.mpgHighway;
        updateLivePreview();

        var statusMsg = 'City: ' + result.mpgCity + ' / Hwy: ' + result.mpgHighway;
        if (!result.exact) statusMsg += ' (approx. match)';
        if (result.source) statusMsg += ' — ' + result.source;
        showMpgStatus(statusEl, statusMsg, result.exact ? 'success' : 'approx');
      } else {
        showMpgStatus(statusEl, result.message || 'MPG data not found. Please enter manually.', 'error');
      }
    } catch (err) {
      showMpgStatus(statusEl, 'MPG lookup failed: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '\uD83D\uDD0D Look Up MPG';
      btn._mpgForceNext = false;
    }
  }

  /**
   * MPG Lookup for Edit Vehicle form.
   * @param {boolean} force  If true, overwrite existing MPG values.
   */
  async function editMpgLookup(force) {
    var make = $('editMake').value.trim();
    var model = $('editModel').value.trim();
    var statusEl = $('editMpgStatus');
    var btn = $('editMpgLookupBtn');

    if (!make || !model) {
      showMpgStatus(statusEl, 'Enter at least Make and Model first.', 'error');
      return;
    }

    // Don't overwrite existing values unless forced
    var cityEl = $('editMpgCity');
    var hwyEl = $('editMpgHighway');
    if (!force && cityEl.value && hwyEl.value) {
      showMpgStatus(statusEl, 'MPG already filled. Click again to replace.', 'approx');
      btn._mpgForceNext = true;
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Looking up MPG...';
    showMpgStatus(statusEl, 'Searching web for EPA data...', 'loading');

    try {
      var result = await fetchMpgLookup({
        year: $('editYear').value,
        make: make,
        model: model,
        trim: $('editTrim').value,
        engine: $('editEngine').value,
        drivetrain: $('editDrivetrain').value,
      });

      if (result.found && result.mpgCity && result.mpgHighway) {
        cityEl.value = result.mpgCity;
        hwyEl.value = result.mpgHighway;

        var statusMsg = 'City: ' + result.mpgCity + ' / Hwy: ' + result.mpgHighway;
        if (!result.exact) statusMsg += ' (approx. match)';
        if (result.source) statusMsg += ' — ' + result.source;
        showMpgStatus(statusEl, statusMsg, result.exact ? 'success' : 'approx');
      } else {
        showMpgStatus(statusEl, result.message || 'MPG data not found. Please enter manually.', 'error');
      }
    } catch (err) {
      showMpgStatus(statusEl, 'MPG lookup failed: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '\uD83D\uDD0D Look Up MPG';
      btn._mpgForceNext = false;
    }
  }

  // ─── Photo Validation ──────────────────────────────────────────────────────
  const ALLOWED_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
  const ALLOWED_PHOTO_EXTS = ['.jpg', '.jpeg', '.png', '.webp'];
  const MAX_PHOTOS = 25;

  function validatePhotoFiles(files) {
    var valid = [];
    var rejected = [];
    var oversized = [];
    Array.from(files).forEach(function (f) {
      var ext = (f.name || '').toLowerCase().match(/\.[^.]+$/);
      var extOk = ext && ALLOWED_PHOTO_EXTS.includes(ext[0]);
      var typeOk = ALLOWED_PHOTO_TYPES.includes(f.type);
      if (!extOk && !typeOk) {
        rejected.push(f.name + ' (invalid type)');
      } else if (f.size > MAX_PHOTO_SIZE_BYTES) {
        oversized.push(f.name + ' (' + (f.size / 1024 / 1024).toFixed(1) + 'MB)');
      } else {
        valid.push(f);
      }
    });
    return { valid: valid.slice(0, MAX_PHOTOS), rejected: rejected, oversized: oversized };
  }

  function showPhotoError(elId, msg) {
    var el = $(elId);
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hide');
    setTimeout(function () { el.classList.add('hide'); }, 6000);
  }

  function updatePhotoCount(elId, count) {
    var el = $(elId);
    if (el) el.textContent = count + ' / ' + MAX_PHOTOS;
  }

  // ─── Batch Media Upload System ──────────────────────────────────────────────
  // Replaces old single-select photo handler with drag-and-drop folder support,
  // real-time progress gallery, and instant thumbnail generation.

  function setupBatchUploadZone() {
    var dropZone = $('batchDropZone');
    var fileInput = $('addPhotos');
    var folderInput = $('addPhotoFolder');
    var browseFilesBtn = $('batchBrowseFiles');
    var browseFolderBtn = $('batchBrowseFolder');
    if (!dropZone) return;

    // Browse buttons
    if (browseFilesBtn) browseFilesBtn.addEventListener('click', function (e) {
      e.stopPropagation(); fileInput.click();
    });
    if (browseFolderBtn) browseFolderBtn.addEventListener('click', function (e) {
      e.stopPropagation(); folderInput.click();
    });
    dropZone.addEventListener('click', function () { fileInput.click(); });

    // File input change
    fileInput.addEventListener('change', function (e) {
      var files = Array.from(e.target.files || []);
      if (files.length) processBatchFiles(files);
      fileInput.value = '';
    });
    // Folder input change
    if (folderInput) folderInput.addEventListener('change', function (e) {
      var files = Array.from(e.target.files || []);
      if (files.length) processBatchFiles(files);
      folderInput.value = '';
    });

    // Drag-and-drop with recursive folder scanning
    dropZone.addEventListener('dragenter', function (e) { e.preventDefault(); dropZone.classList.add('drag-over'); });
    dropZone.addEventListener('dragover', function (e) { e.preventDefault(); dropZone.classList.add('drag-over'); });
    dropZone.addEventListener('dragleave', function (e) {
      if (!dropZone.contains(e.relatedTarget)) dropZone.classList.remove('drag-over');
    });
    dropZone.addEventListener('drop', function (e) {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      var items = Array.from(e.dataTransfer.items || []);
      var entries = items.map(function (item) {
        return item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
      }).filter(Boolean);

      if (entries.length > 0 && entries.some(function (en) { return en.isDirectory; })) {
        // Has folders — do recursive scan
        var allFiles = [];
        var pending = entries.length;
        entries.forEach(function (entry) {
          scanEntryRecursive(entry, allFiles, function () {
            pending--;
            if (pending <= 0) processBatchFiles(allFiles);
          });
        });
      } else {
        // Plain file drop
        var files = Array.from(e.dataTransfer.files || []);
        if (files.length) processBatchFiles(files);
      }
    });
  }

  // Recursively scan a FileSystemEntry (file or directory) for images
  function scanEntryRecursive(entry, results, done) {
    if (entry.isFile) {
      entry.file(function (file) {
        results.push(file);
        done();
      }, function () { done(); });
    } else if (entry.isDirectory) {
      var reader = entry.createReader();
      var readBatch = function () {
        reader.readEntries(function (batch) {
          if (!batch || batch.length === 0) {
            done();
            return;
          }
          var batchPending = batch.length;
          batch.forEach(function (child) {
            scanEntryRecursive(child, results, function () {
              batchPending--;
              if (batchPending <= 0) readBatch(); // readEntries returns batches of ~100
            });
          });
        }, function () { done(); });
      };
      readBatch();
    } else {
      done();
    }
  }

  // Process collected files: validate, generate thumbnails, add to addPhotoFiles
  function processBatchFiles(files) {
    var result = validatePhotoFiles(files);
    var msgs = [];
    if (result.rejected.length) {
      msgs.push('Skipped ' + result.rejected.length + ' file(s): invalid type');
    }
    if (result.oversized && result.oversized.length) {
      msgs.push('Skipped ' + result.oversized.length + ' file(s) over 5MB');
    }

    var space = MAX_PHOTOS - addPhotoFiles.length;
    if (result.valid.length > space) {
      result.valid = result.valid.slice(0, Math.max(0, space));
      msgs.push('Only ' + result.valid.length + ' added (25 max reached)');
    }
    if (msgs.length) {
      showPhotoError('addPhotoError', msgs.join('. ') + '.');
    }
    if (!result.valid.length) return;

    // Sort alphabetically by name for deterministic ordering when dropping folders
    result.valid.sort(function (a, b) { return (a.name || '').localeCompare(b.name || ''); });

    addPhotoFiles = addPhotoFiles.concat(result.valid).slice(0, MAX_PHOTOS);
    if (addPreviewIndex >= addPhotoFiles.length) addPreviewIndex = 0;

    // Generate thumbnails for new files
    result.valid.forEach(function (file) {
      generatePhotoThumbnail(file);
    });

    renderBatchGallery();
    updatePhotoCount('addPhotoCount', addPhotoFiles.length);
    updateAiButtonVisibility();
  }

  // Generate a fast client-side thumbnail using OffscreenCanvas or regular canvas
  var thumbnailCache = new Map(); // file -> objectURL
  function generatePhotoThumbnail(file) {
    if (thumbnailCache.has(file)) return;
    // Try OffscreenCanvas first, fallback to regular canvas
    if (typeof createImageBitmap === 'function') {
      createImageBitmap(file).then(function (bitmap) {
        var w = 140, h = 105;
        var canvas;
        var ctx;
        if (typeof OffscreenCanvas !== 'undefined') {
          canvas = new OffscreenCanvas(w, h);
          ctx = canvas.getContext('2d');
        } else {
          canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          ctx = canvas.getContext('2d');
        }
        // Cover-fit crop
        var scale = Math.max(w / bitmap.width, h / bitmap.height);
        var sw = bitmap.width * scale;
        var sh = bitmap.height * scale;
        ctx.drawImage(bitmap, (w - sw) / 2, (h - sh) / 2, sw, sh);
        bitmap.close();

        if (canvas.convertToBlob) {
          canvas.convertToBlob({ type: 'image/jpeg', quality: 0.7 }).then(function (blob) {
            thumbnailCache.set(file, URL.createObjectURL(blob));
            renderBatchGallery();
          });
        } else {
          canvas.toBlob(function (blob) {
            if (blob) thumbnailCache.set(file, URL.createObjectURL(blob));
            renderBatchGallery();
          }, 'image/jpeg', 0.7);
        }
      }).catch(function () {
        // Fallback: use FileReader for thumbnail
        var reader = new FileReader();
        reader.onload = function (ev) {
          thumbnailCache.set(file, ev.target.result);
          renderBatchGallery();
        };
        reader.readAsDataURL(file);
      });
    } else {
      // No createImageBitmap — use FileReader
      var reader = new FileReader();
      reader.onload = function (ev) {
        thumbnailCache.set(file, ev.target.result);
        renderBatchGallery();
      };
      reader.readAsDataURL(file);
    }
  }

  function updateAiButtonVisibility() {
    var scanBtn = $('addScanPhotosBtn');
    if (scanBtn) scanBtn.classList.toggle('hide', !addPhotoFiles.length);
    var autofillBtn = $('addAiAutofillBtn');
    if (autofillBtn) autofillBtn.classList.toggle('hide', !addPhotoFiles.length && !($('addVin') && $('addVin').value.trim()));
  }

  // Render the batch upload gallery with status indicators and drag-to-reorder
  function renderBatchGallery() {
    var preview = $('photoPreview');
    var headerEl = $('uploadGalleryHeader');
    var summaryEl = $('uploadProgressSummary');
    if (!preview) return;
    preview.innerHTML = '';

    // Show/hide gallery header
    if (headerEl) headerEl.classList.toggle('hide', addPhotoFiles.length === 0);

    // Summary text
    if (summaryEl) {
      summaryEl.textContent = addPhotoFiles.length + ' of 25';
    }

    addPhotoFiles.forEach(function (file, i) {
      var card = document.createElement('div');
      card.className = 'upload-card';
      card.draggable = true;
      card.dataset.idx = i;

      // Featured badge for first photo
      if (i === addPreviewIndex) {
        card.classList.add('is-featured');
        var badge = document.createElement('div');
        badge.className = 'featured-badge';
        badge.textContent = '\u2605 Cover';
        card.appendChild(badge);
      }

      // Thumbnail image
      var img = document.createElement('img');
      var thumbUrl = thumbnailCache.get(file);
      if (thumbUrl) {
        img.src = thumbUrl;
      } else {
        // Placeholder while thumbnail generates
        img.style.background = 'var(--surface2)';
        img.alt = 'Loading...';
      }
      img.alt = 'Photo ' + (i + 1);
      img.title = 'Click to set as cover photo';
      card.appendChild(img);

      // Status badge (ready)
      var status = document.createElement('div');
      status.className = 'upload-status status-complete';
      status.innerHTML = '&#10003;';
      card.appendChild(status);

      // Remove button
      var removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'card-remove';
      removeBtn.innerHTML = '&times;';
      removeBtn.title = 'Remove photo';
      removeBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        var removed = addPhotoFiles.splice(i, 1)[0];
        if (thumbnailCache.has(removed)) {
          var url = thumbnailCache.get(removed);
          if (url && url.startsWith('blob:')) URL.revokeObjectURL(url);
          thumbnailCache.delete(removed);
        }
        if (addPreviewIndex >= addPhotoFiles.length) addPreviewIndex = Math.max(0, addPhotoFiles.length - 1);
        if (addPreviewIndex > i) addPreviewIndex--;
        renderBatchGallery();
        updatePhotoCount('addPhotoCount', addPhotoFiles.length);
        updateAiButtonVisibility();
      });
      card.appendChild(removeBtn);

      // Click to set as cover
      card.addEventListener('click', function (e) {
        if (e.target.closest('.card-remove') || e.target.closest('.retry-btn')) return;
        addPreviewIndex = i;
        renderBatchGallery();
      });

      // Drag-to-reorder
      card.addEventListener('dragstart', function (e) {
        e.dataTransfer.setData('text/plain', String(i));
        card.classList.add('dragging');
      });
      card.addEventListener('dragend', function () { card.classList.remove('dragging'); });
      card.addEventListener('dragover', function (e) { e.preventDefault(); card.classList.add('drag-over'); });
      card.addEventListener('dragleave', function () { card.classList.remove('drag-over'); });
      card.addEventListener('drop', function (e) {
        e.preventDefault();
        card.classList.remove('drag-over');
        var fromIdx = parseInt(e.dataTransfer.getData('text/plain'), 10);
        if (isNaN(fromIdx) || fromIdx === i) return;
        var moved = addPhotoFiles.splice(fromIdx, 1)[0];
        addPhotoFiles.splice(i, 0, moved);
        if (addPreviewIndex === fromIdx) addPreviewIndex = i;
        else if (fromIdx < addPreviewIndex && i >= addPreviewIndex) addPreviewIndex--;
        else if (fromIdx > addPreviewIndex && i <= addPreviewIndex) addPreviewIndex++;
        renderBatchGallery();
      });

      preview.appendChild(card);
    });
  }

  // Legacy compatibility alias
  function handlePhotoSelect(event) {
    var files = event.target.files;
    if (!files || !files.length) return;
    processBatchFiles(Array.from(files));
  }

  // eslint-disable-next-line no-unused-vars
  function renderAddPhotoPreview() {
    renderBatchGallery();
  }

  // ─── Unified AI Autofill ──────────────────────────────────────────────────
  async function runAiAutofill(mode) {
    // mode = 'add' or 'edit'
    var prefix = mode === 'edit' ? 'edit' : 'add';
    var statusPanel = $(prefix + 'AiStatus');
    var statusText = $(prefix + 'AiStatusText');
    var statusIcon = $(prefix + 'AiIcon');
    var reviewPanel = $(prefix + 'AiReview');
    var reviewGrid = $(prefix + 'AiReviewGrid');
    var feedbackEl = mode === 'edit' ? $('editFeedback') : addFeedback;
    var vinInput = mode === 'edit' ? $('editVin') : $('addVin');
    var vin = vinInput ? vinInput.value.trim().toUpperCase() : '';
    var merged = {};

    // Show status panel
    if (statusPanel) { statusPanel.classList.remove('hide'); }
    if (statusText) statusText.textContent = 'Starting AI autofill\u2026';
    if (statusIcon) statusIcon.innerHTML = '&#9889;';

    try {
      // Step 1: VIN decode
      if (vin.length === 17) {
        if (statusText) statusText.textContent = 'Decoding VIN\u2026';
        try {
          var vinRes = await fetch(NHTSA_API + '/' + vin + '?format=json');
          if (!vinRes.ok) throw new Error('VIN lookup failed');
          var vinJson = await vinRes.json();
          var r = (vinJson.Results && vinJson.Results[0]) || {};
          var clean = function (v) { return (v && v !== 'Not Applicable' && v !== 'N/A') ? v.trim() : ''; };
          if (clean(r.ModelYear)) merged.year = clean(r.ModelYear);
          if (clean(r.Make)) merged.make = normalizeVehicleText(clean(r.Make));
          if (clean(r.Model)) merged.model = normalizeVehicleText(clean(r.Model));
          if (clean(r.Trim)) merged.trim = clean(r.Trim);
          if (clean(r.DisplacementL)) merged.engine = clean(r.DisplacementL) + 'L' + (clean(r.EngineCylinders) ? ' ' + clean(r.EngineCylinders) + '-cyl' : '');
          if (clean(r.TransmissionStyle)) merged.transmission = clean(r.TransmissionStyle);
          if (clean(r.DriveType)) merged.drivetrain = clean(r.DriveType);
          if (clean(r.FuelTypePrimary)) merged.fuelType = clean(r.FuelTypePrimary);
          if (clean(r.BodyClass)) merged.bodyStyle = clean(r.BodyClass);
          if (clean(r.EngineCylinders)) merged.cylinders = clean(r.EngineCylinders);
          if (clean(r.Doors)) {
            var d = clean(r.Doors);
            merged.doors = (d === '2' || d.includes('2')) ? '2D' : '4D';
          }
        } catch { /* VIN decode failed, continue */ }
      }

      // Step 2: Photo analysis (if photos uploaded or existing)
      var imageUrls = [];
      if (mode === 'edit') {
        imageUrls = (editKeptImages || []).slice();
      }
      // For Add form, photos aren't uploaded yet — skip photo scan
      // (photo scan requires server-accessible URLs)

      if (imageUrls.length > 0) {
        if (statusText) statusText.textContent = 'Analyzing vehicle photos\u2026';
        try {
          var session = JSON.parse(sessionStorage.getItem('bf_admin_session') || '{}');
          var headers = { 'Content-Type': 'application/json' };
          var validUrls = imageUrls.map(function (u) {
            if (typeof u !== 'string') return null;
            if (u.startsWith('https://')) return u;
            if (u.startsWith('blob:')) return window.location.origin + '/photos/' + u.slice(5);
            return null;
          }).filter(Boolean);
          if (validUrls.length) {
            var res = await fetch(VISION_API, {
              method: 'POST',
              headers: headers,
              body: JSON.stringify({
                auth: { user: session.username, passwordHash: session.passwordHash },
                imageUrls: validUrls.slice(0, 5),
              }),
            });
            var data = await res.json();
            if (res.ok && data.analysis) {
              if (data.analysis.exteriorColor) merged.exteriorColor = data.analysis.exteriorColor;
              if (data.analysis.interiorColor) merged.interiorColor = data.analysis.interiorColor;
              if (data.analysis.bodyStyle && !merged.bodyStyle) merged.bodyStyle = data.analysis.bodyStyle;
            }
          }
        } catch { /* Photo scan failed, continue with VIN data */ }
      }

      // Step 3: MPG Lookup (if we have enough vehicle info)
      var mpgMake = merged.make || ($(prefix + 'Make') ? $(prefix + 'Make').value.trim() : '');
      var mpgModel = merged.model || ($(prefix + 'Model') ? $(prefix + 'Model').value.trim() : '');
      if (mpgMake && mpgModel) {
        var mpgCityEl = $(prefix + 'MpgCity');
        var mpgHwyEl = $(prefix + 'MpgHighway');
        if (!mpgCityEl || !mpgCityEl.value || !mpgHwyEl || !mpgHwyEl.value) {
          if (statusText) statusText.textContent = 'Looking up MPG data\u2026';
          try {
            var mpgResult = await fetchMpgLookup({
              year: merged.year || ($(prefix + 'Year') ? $(prefix + 'Year').value : ''),
              make: mpgMake,
              model: mpgModel,
              trim: merged.trim || ($(prefix + 'Trim') ? $(prefix + 'Trim').value : ''),
              engine: merged.engine || ($(prefix + 'Engine') ? $(prefix + 'Engine').value : ''),
              drivetrain: merged.drivetrain || ($(prefix + 'Drivetrain') ? $(prefix + 'Drivetrain').value : ''),
            });
            if (mpgResult.found && mpgResult.mpgCity && mpgResult.mpgHighway) {
              merged.mpgCity = String(mpgResult.mpgCity);
              merged.mpgHighway = String(mpgResult.mpgHighway);
            }
          } catch { /* MPG lookup failed, continue */ }
        }
      }

      // Step 4: Show review panel
      if (statusPanel) statusPanel.classList.add('hide');
      var keys = Object.keys(merged);
      if (keys.length === 0) {
        showFeedback(feedbackEl, 'AI autofill found no new data. Check VIN or upload photos.', true);
        return;
      }

      if (statusText) statusText.textContent = 'Review AI suggestions\u2026';

      // Build review grid
      var fieldLabels = {
        year: 'Year', make: 'Make', model: 'Model', trim: 'Trim',
        engine: 'Engine', cylinders: 'Cylinders', transmission: 'Transmission',
        drivetrain: 'Drivetrain', doors: 'Doors',
        fuelType: 'Fuel Type', bodyStyle: 'Body Style',
        exteriorColor: 'Exterior Color', interiorColor: 'Interior Color',
        mpgCity: 'MPG City', mpgHighway: 'MPG Hwy'
      };

      // Check which fields already have values (manual = don't overwrite)
      var formFieldMap = mode === 'edit' ? {
        year: 'editYear', make: 'editMake', model: 'editModel', trim: 'editTrim',
        engine: 'editEngine', cylinders: 'editCylinders', transmission: 'editTransmission',
        drivetrain: 'editDrivetrain', doors: 'editDoors',
        fuelType: 'editFuelType', exteriorColor: 'editExteriorColor', interiorColor: 'editInteriorColor',
        mpgCity: 'editMpgCity', mpgHighway: 'editMpgHighway'
      } : {
        year: 'addYear', make: 'addMake', model: 'addModel', trim: 'addTrim',
        engine: 'addEngine', cylinders: 'addCylinders', transmission: 'addTransmission',
        drivetrain: 'addDrivetrain', doors: 'addDoors',
        fuelType: 'addFuelType', exteriorColor: 'addExteriorColor', interiorColor: 'addInteriorColor',
        mpgCity: 'addMpgCity', mpgHighway: 'addMpgHighway'
      };

      var reviewHtml = '';
      keys.forEach(function (key) {
        var label = fieldLabels[key] || key;
        var value = merged[key];
        var fieldId = formFieldMap[key];
        var currentVal = fieldId ? ($(fieldId) ? $(fieldId).value.trim() : '') : '';
        var hasManual = !!currentVal;
        var checked = !hasManual ? 'checked' : '';
        var manualNote = hasManual ? '<span class="ai-manual-note">Manual: ' + currentVal + '</span>' : '';
        reviewHtml += '<label class="ai-review-item' + (hasManual ? ' has-manual' : '') + '">' +
          '<input type="checkbox" data-key="' + key + '" data-value="' + value.replace(/"/g, '&quot;') + '" ' + checked + '>' +
          '<span class="ai-review-label">' + label + '</span>' +
          '<span class="ai-review-value">' + value + '</span>' +
          manualNote + '</label>';
      });

      if (reviewGrid) reviewGrid.innerHTML = reviewHtml;
      if (reviewPanel) reviewPanel.classList.remove('hide');

    } catch (err) {
      if (statusPanel) statusPanel.classList.add('hide');
      showFeedback(feedbackEl, 'AI autofill error: ' + err.message, true);
    }
  }

  function applyAiReviewSelections(mode) {
    var prefix = mode === 'edit' ? 'edit' : 'add';
    var reviewPanel = $(prefix + 'AiReview');
    var feedbackEl = mode === 'edit' ? $('editFeedback') : addFeedback;
    if (!reviewPanel) return;

    var formFieldMap = mode === 'edit' ? {
      year: 'editYear', make: 'editMake', model: 'editModel', trim: 'editTrim',
      engine: 'editEngine', cylinders: 'editCylinders', transmission: 'editTransmission',
      drivetrain: 'editDrivetrain', doors: 'editDoors',
      fuelType: 'editFuelType', exteriorColor: 'editExteriorColor', interiorColor: 'editInteriorColor'
    } : {
      year: 'addYear', make: 'addMake', model: 'addModel', trim: 'addTrim',
      engine: 'addEngine', cylinders: 'addCylinders', transmission: 'addTransmission',
      drivetrain: 'addDrivetrain', doors: 'addDoors',
      fuelType: 'addFuelType', exteriorColor: 'addExteriorColor', interiorColor: 'addInteriorColor'
    };

    var driveMap = { '4WD': '4WD', 'AWD': 'AWD', 'FWD': 'FWD', 'RWD': 'RWD', 'Four': '4WD', 'All': 'AWD', 'Front': 'FWD', 'Rear': 'RWD' };
    var fuelMap = { Gasoline: 'Gasoline', Diesel: 'Diesel', Hybrid: 'Hybrid', Electric: 'Electric', Flex: 'Flex Fuel', Ethanol: 'Flex Fuel' };
    var applied = 0;
    var checkboxes = reviewPanel.querySelectorAll('input[type="checkbox"]:checked');
    checkboxes.forEach(function (cb) {
      var key = cb.dataset.key;
      var value = cb.dataset.value;
      var fieldId = formFieldMap[key];
      if (!fieldId || !value) return;
      var el = $(fieldId);
      if (!el) return;
      // For select elements, try to match value
      if (el.tagName === 'SELECT') {
        if (key === 'drivetrain') {
          var match = Object.keys(driveMap).find(function (k) { return value.includes(k); });
          if (match) { el.value = driveMap[match]; applied++; }
        } else if (key === 'fuelType') {
          var match2 = Object.keys(fuelMap).find(function (k) { return value.includes(k); });
          if (match2) { el.value = fuelMap[match2]; applied++; }
        } else if (key === 'transmission') {
          el.value = value.toLowerCase().includes('manual') ? 'Manual' : 'Automatic';
          applied++;
        } else if (key === 'cylinders') {
          var cylNum = String(value).match(/(\d+)/);
          if (cylNum) { el.value = cylNum[1]; applied++; }
        } else if (key === 'doors') {
          el.value = value;
          applied++;
        }
      } else {
        el.value = value;
        applied++;
      }
    });

    reviewPanel.classList.add('hide');
    showFeedback(feedbackEl, 'Applied ' + applied + ' AI-suggested value' + (applied !== 1 ? 's' : '') + '. Manual edits always take priority.');
    if (mode === 'add') updateLivePreview();
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
    if (analysis.interiorColor) $('editInteriorColor').value = analysis.interiorColor;

    // Body style -> category mapping (only if empty)
    if (analysis.bodyStyle) {
      var catMap = { Truck: 'Truck', Pickup: 'Truck', SUV: 'SUV', Crossover: 'SUV', Sedan: 'Car', Car: 'Car', Coupe: 'Car', Convertible: 'Car', Wagon: 'Car', Hatchback: 'Car', Van: 'Van', Minivan: 'Van' };
      var cat = catMap[analysis.bodyStyle];
      if (cat && !$('editCategory').value) $('editCategory').value = cat;
    }

    // Only fill make/model/year/trim if form fields are currently empty (VIN priority)
    if (analysis.make && !$('editMake').value) $('editMake').value = normalizeVehicleText(analysis.make);
    if (analysis.model && !$('editModel').value) $('editModel').value = normalizeVehicleText(analysis.model);
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
      if ($('editFeatures')._refreshChips) $('editFeatures')._refreshChips();
    }

    showFeedback($('editFeedback'), 'Photo scan data applied to form.');
  }

  // eslint-disable-next-line no-unused-vars
  function applyAddScanResults(analysis) {
    if (!analysis) return;
    // Colors always from photos
    if (analysis.exteriorColor) $('addExteriorColor').value = analysis.exteriorColor;
    if (analysis.interiorColor) $('addInteriorColor').value = analysis.interiorColor;

    // Body style -> category (only if empty)
    if (analysis.bodyStyle) {
      var catMap = { Truck: 'Truck', Pickup: 'Truck', SUV: 'SUV', Crossover: 'SUV', Sedan: 'Car', Car: 'Car', Coupe: 'Car', Convertible: 'Car', Wagon: 'Car', Hatchback: 'Car', Van: 'Van', Minivan: 'Van' };
      var cat = catMap[analysis.bodyStyle];
      if (cat && !$('addCategory').value) $('addCategory').value = cat;
    }

    // Only fill if empty (VIN priority)
    if (analysis.make && !$('addMake').value) $('addMake').value = normalizeVehicleText(analysis.make);
    if (analysis.model && !$('addModel').value) $('addModel').value = normalizeVehicleText(analysis.model);
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
      if ($('addFeatures')._refreshChips) $('addFeatures')._refreshChips();
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
      if (!res.ok) throw new Error('VIN lookup failed (HTTP ' + res.status + ')');
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
    if (editVinDecodeData.engine) {
      $('editEngine').value = editVinDecodeData.engine;
      var cylMatch = editVinDecodeData.engine.match(/V(\d+)/i) || editVinDecodeData.engine.match(/(\d+)-cyl/i);
      if (cylMatch) $('editCylinders').value = cylMatch[1];
    }
    if (editVinDecodeData.transmission) {
      var transLower = editVinDecodeData.transmission.toLowerCase();
      $('editTransmission').value = transLower.includes('manual') ? 'Manual' : 'Automatic';
    }
    if (editVinDecodeData.doors) {
      var doorVal = String(editVinDecodeData.doors).trim();
      $('editDoors').value = (doorVal === '2' || doorVal.includes('2')) ? '2D' : '4D';
    }
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
    var make = $('editMake').value;
    var model = $('editModel').value;
    if (!make || !model) {
      showFeedback($('editFeedback'), 'Enter at least Make and Model first.', true);
      return;
    }

    var session = JSON.parse(sessionStorage.getItem('bf_admin_session') || '{}');
    if (!session.username || !session.passwordHash) {
      showFeedback($('editFeedback'), 'Not authenticated. Please log in again.', true);
      return;
    }

    if ($('editGenDescBtn')) {
      $('editGenDescBtn').disabled = true;
      $('editGenDescBtn').textContent = 'Generating...';
    }

    try {
      var res = await fetch(DESCRIBE_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          auth: { user: session.username, passwordHash: session.passwordHash },
          vehicle: {
            year: $('editYear').value,
            make: make,
            model: model,
            trim: $('editTrim').value,
            engine: $('editEngine').value,
            mileage: $('editMileage').value,
            features: $('editFeatures').value,
          },
        }),
      });
      var data = await res.json();
      if (!res.ok) throw new Error(data.error || 'AI generation failed');
      if (data.description) {
        $('editDescription').value = data.description;
        showFeedback($('editFeedback'), 'AI description generated.');
      }
    } catch (err) {
      showFeedback($('editFeedback'), 'AI generation failed: ' + err.message, true);
    } finally {
      if ($('editGenDescBtn')) {
        $('editGenDescBtn').disabled = false;
        $('editGenDescBtn').textContent = 'Generate with AI';
      }
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
      var make = $('editMake').value;
      var model = $('editModel').value;
      if (make && model) {
        await editGenerateDescription();
      }

      // Step 4: Look up MPG if fields are empty
      var cityVal = $('editMpgCity').value;
      var hwyVal = $('editMpgHighway').value;
      if (make && model && (!cityVal || !hwyVal)) {
        btn.textContent = '⏳ MPG Lookup...';
        try {
          await editMpgLookup(false);
        } catch (mpgErr) {
          // Non-fatal — just log and continue
          console.warn('[editMasterAI] MPG lookup failed:', mpgErr.message);
        }
      }

      showFeedback($('editFeedback'), 'AI analysis complete: VIN + Photos + Description + MPG.');
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
    var result = validatePhotoFiles(files);
    if (result.rejected.length) {
      showPhotoError('editPhotoError', 'Skipped ' + result.rejected.length + ' file(s): only JPG, PNG, WebP allowed.');
    }
    if (result.oversized && result.oversized.length) {
      showPhotoError('editPhotoError', 'Skipped ' + result.oversized.length + ' file(s) over 5MB: ' + result.oversized.join(', '));
    }
    var totalExisting = editKeptImages.length + editPhotoFiles.length;
    var space = MAX_PHOTOS - totalExisting;
    if (result.valid.length > space) {
      result.valid = result.valid.slice(0, Math.max(0, space));
      showPhotoError('editPhotoError', 'Max ' + MAX_PHOTOS + ' photos total. Only ' + result.valid.length + ' added.');
    }
    editPhotoFiles = editPhotoFiles.concat(result.valid);
    renderEditPhotoPreview();
    updatePhotoCount('editPhotoCount', editKeptImages.length + editPhotoFiles.length);
  }

  function renderEditPhotoPreview() {
    var preview = $('editPhotoPreview');
    if (!preview) return;
    preview.innerHTML = '';
    var totalCount = editKeptImages.length + editPhotoFiles.length;
    updatePhotoCount('editPhotoCount', totalCount);

    // Determine effective preview
    var effectivePreview = editPreviewName;
    if (!effectivePreview) {
      effectivePreview = editKeptImages.length ? editKeptImages[0] : (editPhotoFiles.length ? 'new-0' : null);
    }
    // Render kept (existing) images with drag-to-reorder
    editKeptImages.forEach(function (url, i) {
      var isPreview = (url === effectivePreview);
      var globalIdx = i;
      var div = document.createElement('div');
      div.className = 'photo-thumb' + (isPreview ? ' is-preview' : '');
      div.dataset.url = url;
      div.dataset.type = 'kept';
      div.dataset.idx = i;
      div.draggable = true;
      div.innerHTML = '<img src="' + resolveImageSrc(url) + '" alt="Photo ' + (i + 1) + '" title="Click to set as featured">' +
        '<button type="button" class="photo-remove-btn" title="Remove photo">&times;</button>' +
        (isPreview ? '<div class="photo-preview-badge">Featured</div>' : '') +
        '<span class="photo-label">' + (isPreview ? 'Featured' : (globalIdx + 1) + ' of ' + totalCount) + '</span>';
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
      // Drag-to-reorder within kept images
      div.addEventListener('dragstart', function (e) {
        e.dataTransfer.setData('text/plain', 'kept:' + i);
        div.classList.add('dragging');
      });
      div.addEventListener('dragend', function () { div.classList.remove('dragging'); });
      div.addEventListener('dragover', function (e) { e.preventDefault(); div.classList.add('drag-over'); });
      div.addEventListener('dragleave', function () { div.classList.remove('drag-over'); });
      div.addEventListener('drop', function (e) {
        e.preventDefault();
        div.classList.remove('drag-over');
        var payload = e.dataTransfer.getData('text/plain');
        if (!payload.startsWith('kept:')) return;
        var fromIdx = parseInt(payload.split(':')[1], 10);
        if (isNaN(fromIdx) || fromIdx === i) return;
        var moved = editKeptImages.splice(fromIdx, 1)[0];
        editKeptImages.splice(i, 0, moved);
        renderEditPhotoPreview();
      });
      preview.appendChild(div);
    });
    // Render new (uploaded) files
    editPhotoFiles.forEach(function (file, i) {
      var newId = 'new-' + i;
      var isPreview = (newId === effectivePreview);
      var globalIdx = editKeptImages.length + i;
      var div = document.createElement('div');
      div.className = 'photo-thumb' + (isPreview ? ' is-preview' : '');
      div.draggable = true;
      var reader = new FileReader();
      reader.onload = function (e) {
        var img = div.querySelector('img');
        if (img) img.src = e.target.result;
      };
      div.innerHTML = '<img src="" alt="New photo ' + (i + 1) + '" title="Click to set as featured">' +
        '<button type="button" class="photo-remove-btn" title="Remove">&times;</button>' +
        (isPreview ? '<div class="photo-preview-badge">Featured</div>' : '') +
        '<span class="photo-label">' + (isPreview ? 'Featured' : (globalIdx + 1) + ' of ' + totalCount) + '</span>';
      div.querySelector('.photo-remove-btn').addEventListener('click', function (e) {
        e.stopPropagation();
        editPhotoFiles.splice(i, 1);
        if (editPreviewName === newId) editPreviewName = null;
        renderEditPhotoPreview();
      });
      div.addEventListener('click', function () {
        editPreviewName = newId;
        renderEditPhotoPreview();
      });
      preview.appendChild(div);
      reader.readAsDataURL(file);
    });
    // Show/hide AI buttons
    var hasPhotos = editKeptImages.length > 0 || editPhotoFiles.length > 0;
    var scanBtn = $('editScanPhotosBtn');
    if (scanBtn) scanBtn.classList.toggle('hide', !hasPhotos);
    var autofillBtn = $('editAiAutofillBtn');
    if (autofillBtn) autofillBtn.classList.toggle('hide', !hasPhotos && !($('editVin') && $('editVin').value.trim()));
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
        $('publishDropZone').classList.add('file-ready');
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

      // Clear draft flags after successful publish
      inventory.forEach(function(v) { delete v._bulkDraft; });
      persistInventory();
      updateDraftBanner();
      renderInventoryTable();

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
        } catch {
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
    $('blogSlug').dispatchEvent(new Event('input', { bubbles: true }));
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
    $('blogSlug').dispatchEvent(new Event('input', { bubbles: true }));
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

  // Auto-generate slug from title + live preview
  function setupBlogSlugGen() {
    function updateSlugPreview() {
      var preview = $('blogSlugPreview');
      if (!preview) return;
      var slug = ($('blogSlug').value || '').trim();
      if (!slug) { preview.textContent = ''; preview.className = 'slug-preview'; return; }
      var invalid = /[^a-z0-9-]/.test(slug);
      if (invalid) {
        preview.textContent = 'Use only lowercase letters, numbers, and hyphens.';
        preview.className = 'slug-preview slug-error';
      } else {
        preview.textContent = '/blog/' + slug;
        preview.className = 'slug-preview';
      }
    }
    $('blogTitle').addEventListener('input', () => {
      if (!currentBlogSlug) {
        $('blogSlug').value = slugify($('blogTitle').value);
        updateSlugPreview();
      }
    });
    $('blogSlug').addEventListener('input', updateSlugPreview);
    updateSlugPreview();
  }

  // ─── Comment Moderation ─────────────────────────────────────────────────────
  async function loadBlogComments() {
    if (!blogToken) return;
    try {
      const comments = await blogAdminRequest('?action=admin-comments');
      blogComments = Array.isArray(comments) ? comments : [];
      renderComments();
    } catch {
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
        } catch {
          // silently fail
        }
      });
    });
  }

  // ─── Settings ───────────────────────────────────────────────────────────────
  async function loadSettings() {
    // Load display state from server (authoritative)
    var googleKey = localStorage.getItem('bf_google_key') || '';
    var placeId = localStorage.getItem('bf_place_id') || '';
    if ($('settingsOpenaiKey')) $('settingsOpenaiKey').value = '';
    if ($('settingsGoogleKey')) $('settingsGoogleKey').value = googleKey ? '********' : '';
    if ($('settingsPlaceId')) $('settingsPlaceId').value = placeId;

    try {
      var session = JSON.parse(sessionStorage.getItem('bf_admin_session') || '{}');
      if (!session.username || !session.passwordHash) return;
      var res = await fetch(SETTINGS_API + '?user=' + encodeURIComponent(session.username) + '&hash=' + encodeURIComponent(session.passwordHash));
      if (!res.ok) return;
      var data = await res.json();
      if (!data.ok || !data.settings) return;
      var s = data.settings;
      if (s.openaiKeySet) {
        if ($('settingsOpenaiKey')) $('settingsOpenaiKey').value = '********';
      }
      if (s.placeId) {
        localStorage.setItem('bf_place_id', s.placeId);
        if ($('settingsPlaceId')) $('settingsPlaceId').value = s.placeId;
      }
      if (s.googleKeySet) {
        if ($('settingsGoogleKey')) $('settingsGoogleKey').value = '********';
      }
      // Clean up any old client-side key storage
      localStorage.removeItem('bf_openai_key');
    } catch {
      // Server load failed — display fields remain as-is
    }
  }

  async function saveOpenaiKey() {
    const key = $('settingsOpenaiKey').value.trim();
    if (!key || key.startsWith('*')) return;
    // Save to server only — never store the key client-side
    try {
      var session = JSON.parse(sessionStorage.getItem('bf_admin_session') || '{}');
      if (!session.username || !session.passwordHash) {
        alert('Not authenticated. Please log in again.');
        return;
      }
      var res = await fetch(SETTINGS_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          auth: { user: session.username, passwordHash: session.passwordHash },
          settings: { openaiKey: key },
        }),
      });
      var data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      // Clear any old localStorage key
      localStorage.removeItem('bf_openai_key');
      $('settingsOpenaiKey').value = '********';
      alert('OpenAI key saved securely on the server.');
    } catch (e) {
      alert('Failed to save OpenAI key: ' + e.message);
    }
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
    } catch { /* server save failed, localStorage still has it */ }
    if (googleKey && !googleKey.startsWith('*')) $('settingsGoogleKey').value = '********';
    showFeedback($('settingsGoogleStatus'), 'Google Reviews settings saved. Set GOOGLE_PLACES_API_KEY and GOOGLE_PLACE_ID as Netlify environment variables for the reviews to load.');
  }

  // ─── Lead Types ────────────────────────────────────────────────────────────
  var LEAD_TYPES = [
    'Website', 'Call from Website', 'Email from Website', 'Text from Website',
    'Form from Website', 'Phone Inquiry', 'Personal', 'Walk-In', 'Referral',
    'Repeat Customer', 'Facebook', 'Instagram', 'Google Business Profile',
    'Marketplace / Classifieds', 'Third-Party Listing Site', 'Dealer Referral',
    'Employee Referral', 'Other'
  ];

  // ─── Sold Workflow ────────────────────────────────────────────────────────
  var soldModalVehicle = null;

  function openSoldModal(item) {
    soldModalVehicle = item;
    var modal = $('soldModal');
    var summary = $('soldVehicleSummary');
    var title = $('soldModalTitle');

    // Summary line
    var ymm = [item.year, item.make, item.model, item.trim].filter(Boolean).join(' ');
    summary.textContent = ymm + (item.stockNumber ? ' | Stock #' + item.stockNumber : '') + ' | Asking: ' + formatMoney(item.price);

    // Title
    title.textContent = item.status === 'sold' ? 'Edit Sale Details' : 'Mark Vehicle as Sold';
    $('soldSubmitBtn').textContent = item.status === 'sold' ? 'Update Sale' : 'Complete Sale';

    // Populate lead type dropdown
    var leadSelect = $('soldLeadType');
    leadSelect.innerHTML = '<option value="">Select lead source...</option>';
    LEAD_TYPES.forEach(function (lt) {
      var opt = document.createElement('option');
      opt.value = lt;
      opt.textContent = lt;
      leadSelect.appendChild(opt);
    });

    // Pre-fill values
    $('soldDate').value = item.soldDate || new Date().toISOString().split('T')[0];
    $('soldSalePrice').value = item.salePrice || item.price || '';
    leadSelect.value = item.leadType || '';
    $('soldLeadSourceDetail').value = item.leadSourceDetail || '';
    $('soldSalesperson').value = item.salesperson || '';
    $('soldBuyerName').value = item.buyerName || '';
    $('soldNotes').value = item.soldNotes || '';

    // Toggle "Other" detail
    toggleLeadDetail();

    hideFeedback($('soldFeedback'));
    $('soldSubmitBtn').disabled = false;
    $('soldSubmitBtn').textContent = item.status === 'sold' ? 'Update Sale' : 'Complete Sale';
    modal.classList.add('active');
  }

  function toggleLeadDetail() {
    var wrap = $('soldLeadDetailWrap');
    var input = $('soldLeadSourceDetail');
    if ($('soldLeadType').value === 'Other') {
      wrap.classList.remove('hide');
      input.required = true;
    } else {
      wrap.classList.add('hide');
      input.required = false;
      input.value = '';
    }
  }

  function validateSoldForm() {
    var errors = [];
    if (!$('soldDate').value) errors.push('Sold date is required.');
    var price = Number($('soldSalePrice').value);
    if (!$('soldSalePrice').value || isNaN(price) || price < 0) errors.push('Valid sale price is required.');
    if (!$('soldLeadType').value) errors.push('Lead source is required.');
    if ($('soldLeadType').value === 'Other' && !$('soldLeadSourceDetail').value.trim()) errors.push('Lead source detail is required when "Other" is selected.');
    if (!$('soldSalesperson').value.trim()) errors.push('Salesperson is required.');
    return errors;
  }

  function prepareSoldPayload(vehicle, formData) {
    return {
      vehicleId: vehicle.sku,
      vin: vehicle.vin || '',
      stockNumber: vehicle.stockNumber || vehicle.sku,
      year: vehicle.year || '',
      make: vehicle.make || '',
      model: vehicle.model || '',
      trim: vehicle.trim || '',
      mileage: vehicle.mileage || 0,
      exteriorColor: vehicle.exteriorColor || '',
      interiorColor: vehicle.interiorColor || '',
      transmission: vehicle.transmission || '',
      engine: vehicle.engine || '',
      fuelType: vehicle.fuelType || '',
      category: vehicle.category || '',
      originalAskingPrice: vehicle.price || 0,
      salePrice: Number(formData.salePrice),
      soldDate: formData.soldDate,
      status: 'sold',
      leadType: formData.leadType,
      leadSourceDetail: formData.leadSourceDetail || '',
      salesperson: formData.salesperson,
      buyerName: formData.buyerName || '',
      soldNotes: formData.soldNotes || '',
      inventoryCreatedAt: vehicle.dateAdded || '',
      soldAt: new Date().toISOString(),
      sourceRecordId: vehicle.sku,
    };
  }

  async function writeSalesBlob(payload) {
    var session = JSON.parse(sessionStorage.getItem('bf_admin_session') || '{}');
    if (!session.username || !session.passwordHash) throw new Error('Not authenticated.');
    var authStr = btoa(session.username + ':' + (session.passwordHash || authPasswordHash));
    var res = await fetch(SALES_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Basic ' + authStr },
      body: JSON.stringify({ record: payload }),
    });
    if (!res.ok) {
      var err = await res.json().catch(function () { return {}; });
      throw new Error(err.error || 'Failed to write sales record');
    }
    return res.json();
  }

  async function readSalesBlob() {
    var session = JSON.parse(sessionStorage.getItem('bf_admin_session') || '{}');
    if (!session.username || !session.passwordHash) return [];
    var authStr = btoa(session.username + ':' + (session.passwordHash || authPasswordHash));
    try {
      var res = await fetch(SALES_API, {
        method: 'GET',
        headers: { 'Authorization': 'Basic ' + authStr },
      });
      if (!res.ok) return [];
      return await res.json();
    } catch {
      return [];
    }
  }

  function applySoldToInventory(vehicleIndex, soldFields) {
    Object.keys(soldFields).forEach(function (key) {
      inventory[vehicleIndex][key] = soldFields[key];
    });
  }

  function rollbackInventory(snapshot) {
    inventory = JSON.parse(JSON.stringify(snapshot));
    persistInventory();
  }

  async function handleSoldSubmit(event) {
    event.preventDefault();
    if (!soldModalVehicle) return;

    var errors = validateSoldForm();
    if (errors.length) {
      showFeedback($('soldFeedback'), errors.join(' '), true);
      return;
    }

    var btn = $('soldSubmitBtn');
    btn.disabled = true;
    btn.textContent = 'Saving...';
    hideFeedback($('soldFeedback'));

    var formData = {
      soldDate: $('soldDate').value,
      salePrice: $('soldSalePrice').value,
      leadType: $('soldLeadType').value,
      leadSourceDetail: $('soldLeadSourceDetail').value.trim(),
      salesperson: $('soldSalesperson').value.trim(),
      buyerName: $('soldBuyerName').value.trim(),
      soldNotes: $('soldNotes').value.trim(),
    };

    var payload = prepareSoldPayload(soldModalVehicle, formData);
    var inventorySnapshot = JSON.parse(JSON.stringify(inventory));

    // Step 1: Write to blob first (defensive ordering)
    try {
      await writeSalesBlob(payload);
    } catch (err) {
      showFeedback($('soldFeedback'), 'Failed to save sale record: ' + err.message, true);
      btn.disabled = false;
      btn.textContent = soldModalVehicle.status === 'sold' ? 'Update Sale' : 'Complete Sale';
      return;
    }

    // Step 2: Update local inventory
    var idx = inventory.findIndex(function (v) { return v.sku === soldModalVehicle.sku; });
    if (idx < 0) {
      showFeedback($('soldFeedback'), 'Vehicle not found in inventory.', true);
      btn.disabled = false;
      btn.textContent = 'Complete Sale';
      return;
    }

    try {
      var soldFields = {
        status: 'sold',
        soldDate: formData.soldDate,
        salePrice: Number(formData.salePrice),
        leadType: formData.leadType,
        leadSourceDetail: formData.leadSourceDetail,
        salesperson: formData.salesperson,
        buyerName: formData.buyerName,
        soldNotes: formData.soldNotes,
        soldAt: payload.soldAt,
        updatedAt: new Date().toISOString(),
      };
      applySoldToInventory(idx, soldFields);
      persistInventory();

      // Step 3: Publish (excludes sold vehicles)
      showToast('Publishing updated inventory...');
      await autoPublish();
      showToast('\u2713 Vehicle sold & published! Live in ~30 seconds.', 'success');
      setTimeout(hideToast, 5000);

      // Step 4: Refresh views
      renderInventoryTable();
      salesTabInitialized = false; // force re-init with real data
      refreshSalesViews();

      // Close modal
      $('soldModal').classList.remove('active');
      soldModalVehicle = null;
    } catch (err) {
      // Rollback on failure
      rollbackInventory(inventorySnapshot);
      renderInventoryTable();
      showFeedback($('soldFeedback'), 'Sale recorded in blob but local update failed: ' + err.message + '. Please try again.', true);
      showToast('Error: ' + err.message, 'error');
      setTimeout(hideToast, 8000);
      btn.disabled = false;
      btn.textContent = 'Complete Sale';
    }
  }

  // ─── Edit Modal Unsaved Changes Guard ──────────────────────────────────────
  function snapshotEditForm() {
    var editFields = ['editName','editSku','editCategory','editYear','editMake','editModel',
      'editTrim','editVin','editQuantity','editPrice','editEngine','editCylinders','editTransmission',
      'editStatus','editStock','editMileage','editDrivetrain','editDoors','editFuelType','editMpgCity',
      'editMpgHighway','editExteriorColor','editInteriorColor','editBadge','editSupplier',
      'editCondition','editTitleState','editWarranty',
      'editDescription','editFeatures'];
    var snap = {};
    editFields.forEach(function(id) { var el = $(id); snap[id] = el ? el.value : ''; });
    snap._keptImages = editKeptImages.slice();
    snap._photoFileCount = editPhotoFiles.length;
    return snap;
  }

  function isEditFormDirty() {
    if (!editFormSnapshot) return false;
    var current = snapshotEditForm();
    for (var key in editFormSnapshot) {
      if (key === '_keptImages') {
        if (JSON.stringify(editFormSnapshot._keptImages) !== JSON.stringify(current._keptImages)) return true;
      } else if (editFormSnapshot[key] !== current[key]) {
        return true;
      }
    }
    return false;
  }

  function tryCloseEditModal() {
    if (isEditFormDirty()) {
      if (!confirm('You may lose unsaved data. Are you sure you want to continue?')) return;
    }
    editFormSnapshot = null;
    editModal.classList.remove('active');
  }

  // ─── Modal Close ────────────────────────────────────────────────────────────
  function closeModals(event) {
    if (event.target.matches('.modal') || event.target.dataset.close !== undefined) {
      // Edit modal is locked — only closeable via Cancel / X button (routed through tryCloseEditModal)
      if (editModal.classList.contains('active') &&
          (event.target === editModal || editModal.contains(event.target))) {
        // Clicking the backdrop (the .modal overlay itself) is blocked
        if (event.target === editModal) {
          event.stopPropagation();
          return; // do nothing — modal is locked
        }
        // Explicit close button inside the modal
        if (event.target.dataset.close !== undefined) {
          event.stopPropagation();
          tryCloseEditModal();
          return;
        }
        return;
      }
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
    if (salesTabInitialized) filterSalesData();
  }

  // ─── Sales Tab ────────────────────────────────────────────────────────────
  var allSalesRecords = []; // merged local sold + blob records
  var salesOverTimeInstance = null;
  var salesByTypeInstance = null;
  var salesByLeadInstance = null;

  function getSoldFromInventory() {
    return inventory.filter(function (v) { return v.status === 'sold'; }).map(function (v) {
      return {
        vehicleId: v.sku,
        year: v.year || '', make: v.make || '', model: v.model || '', trim: v.trim || '',
        stockNumber: v.stockNumber || v.sku,
        category: v.category || '',
        salePrice: v.salePrice || v.price || 0,
        soldDate: v.soldDate || '',
        salesperson: v.salesperson || '',
        leadType: v.leadType || '',
        buyerName: v.buyerName || '',
      };
    });
  }

  function mergeSalesRecords(localSold, blobRecords) {
    var map = {};
    // Blob records are authoritative
    blobRecords.forEach(function (r) { map[r.vehicleId] = r; });
    // Local sold fill gaps (if blob hasn't persisted yet)
    localSold.forEach(function (r) { if (!map[r.vehicleId]) map[r.vehicleId] = r; });
    var list = Object.values(map);
    // Sort by soldDate descending
    list.sort(function (a, b) {
      return (b.soldDate || '').localeCompare(a.soldDate || '');
    });
    return list;
  }

  function populateSalesFilterDropdowns(records) {
    // Lead type dropdown
    var leadSelect = $('salesFilterLeadType');
    if (leadSelect) {
      var currentVal = leadSelect.value;
      var leads = {};
      records.forEach(function (r) { if (r.leadType) leads[r.leadType] = true; });
      leadSelect.innerHTML = '<option value="All">All</option>';
      Object.keys(leads).sort().forEach(function (lt) {
        var opt = document.createElement('option');
        opt.value = lt; opt.textContent = lt;
        leadSelect.appendChild(opt);
      });
      leadSelect.value = currentVal || 'All';
    }
    // Salesperson dropdown
    var spSelect = $('salesFilterSalesperson');
    if (spSelect) {
      var currentVal2 = spSelect.value;
      var people = {};
      records.forEach(function (r) { if (r.salesperson) people[r.salesperson] = true; });
      spSelect.innerHTML = '<option value="All">All</option>';
      Object.keys(people).sort().forEach(function (sp) {
        var opt = document.createElement('option');
        opt.value = sp; opt.textContent = sp;
        spSelect.appendChild(opt);
      });
      spSelect.value = currentVal2 || 'All';
    }
  }

  function filterSalesRecords(records) {
    var dateRange = ($('salesFilterDateRange') || {}).value || 'All';
    var leadFilter = ($('salesFilterLeadType') || {}).value || 'All';
    var spFilter = ($('salesFilterSalesperson') || {}).value || 'All';
    var typeFilter = ($('salesFilterType') || {}).value || 'All';

    var now = new Date();
    var todayStr = now.toISOString().split('T')[0];

    return records.filter(function (r) {
      // Date range filter
      if (dateRange !== 'All' && r.soldDate) {
        var sd = r.soldDate;
        if (dateRange === 'today' && sd !== todayStr) return false;
        if (dateRange === '7d') {
          var d7 = new Date(now.getTime() - 7 * 86400000).toISOString().split('T')[0];
          if (sd < d7) return false;
        }
        if (dateRange === '30d') {
          var d30 = new Date(now.getTime() - 30 * 86400000).toISOString().split('T')[0];
          if (sd < d30) return false;
        }
        if (dateRange === 'thisMonth') {
          var monthStart = todayStr.slice(0, 7);
          if (!sd.startsWith(monthStart)) return false;
        }
      }
      if (leadFilter !== 'All' && r.leadType !== leadFilter) return false;
      if (spFilter !== 'All' && r.salesperson !== spFilter) return false;
      if (typeFilter !== 'All' && r.category !== typeFilter) return false;
      return true;
    });
  }

  function buildSalesOverTimeData(records) {
    var months = {};
    records.forEach(function (r) {
      if (!r.soldDate) return;
      var m = r.soldDate.slice(0, 7); // YYYY-MM
      if (!months[m]) months[m] = 0;
      months[m] += Number(r.salePrice) || 0;
    });
    var keys = Object.keys(months).sort();
    return keys.map(function (k) {
      var parts = k.split('-');
      var label = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(parts[1], 10) - 1] + ' ' + parts[0].slice(2);
      return { name: label, sales: months[k] };
    });
  }

  function buildSalesByTypeData(records) {
    var types = {};
    records.forEach(function (r) {
      var cat = r.category || 'Other';
      if (!types[cat]) types[cat] = 0;
      types[cat]++;
    });
    return Object.keys(types).map(function (k) { return { name: k, value: types[k] }; });
  }

  function buildSalesByLeadData(records) {
    var leads = {};
    records.forEach(function (r) {
      var lt = r.leadType || 'Unknown';
      if (!leads[lt]) leads[lt] = 0;
      leads[lt]++;
    });
    return Object.keys(leads).map(function (k) { return { name: k, value: leads[k] }; });
  }

  function renderSalesOverTimeChart(data) {
    var canvas = $('salesOverTimeChart');
    if (!canvas || typeof Chart === 'undefined') return;
    if (salesOverTimeInstance) { salesOverTimeInstance.destroy(); salesOverTimeInstance = null; }

    var labels = data.map(function (d) { return d.name; });
    var values = data.map(function (d) { return d.sales; });

    if (!labels.length) { labels = ['No data']; values = [0]; }

    salesOverTimeInstance = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Revenue (Area)',
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
            label: 'Revenue (Bar)',
            data: values,
            backgroundColor: 'rgba(103, 103, 247, 0.35)',
            borderRadius: 4,
            barPercentage: 0.5,
            order: 1,
          },
          {
            label: 'Trend',
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
          legend: { labels: { color: chartTextColor, font: { family: '\'Space Grotesk\'' } } },
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

    var pieColors = ['#6767f7', '#37bc7b', '#f59e0b', '#f2555e', '#1d7cf2', '#e879f9', '#38bdf8', '#fb923c'];

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
            labels: { color: chartTextColor, font: { family: '\'Space Grotesk\'' }, padding: 16 },
          },
        },
      },
    });
  }

  function renderSalesByLeadChart(data) {
    var canvas = $('salesByLeadChart');
    if (!canvas || typeof Chart === 'undefined') return;
    if (salesByLeadInstance) { salesByLeadInstance.destroy(); salesByLeadInstance = null; }

    var pieColors = ['#37bc7b', '#6767f7', '#f59e0b', '#f2555e', '#1d7cf2', '#e879f9', '#38bdf8', '#fb923c', '#a78bfa', '#34d399', '#fbbf24', '#f87171', '#60a5fa', '#c084fc', '#22d3ee', '#fb7185', '#a3e635', '#facc15'];

    renderDoughnut(canvas, data, pieColors, function (instance) { salesByLeadInstance = instance; });
  }

  function renderDoughnut(canvas, data, colors, setInstance) {
    var instance = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: data.map(function (d) { return d.name; }),
        datasets: [{
          data: data.map(function (d) { return d.value; }),
          backgroundColor: colors.slice(0, data.length),
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
            labels: { color: chartTextColor, font: { family: '\'Space Grotesk\'' }, padding: 12, boxWidth: 12 },
          },
        },
      },
    });
    if (setInstance) setInstance(instance);
  }

  function renderSalesTable(data) {
    var tbody = $('salesTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (!data.length) {
      tbody.innerHTML = '<tr><td colspan="7"><div class="sales-empty-state">' +
        '<p>No sales recorded yet \u2014 mark a vehicle as sold to get started.</p>' +
        '<button class="ghost-btn" type="button" data-goto="inventory">Go to Inventory</button>' +
        '</div></td></tr>';
      return;
    }
    data.forEach(function (sale) {
      var ymm = [sale.year, sale.make, sale.model].filter(Boolean).join(' ') || sale.vehicleId || '-';
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + ymm + '</td>' +
        '<td>' + (sale.stockNumber || '-') + '</td>' +
        '<td>' + formatMoney(sale.salePrice || 0) + '</td>' +
        '<td>' + (sale.soldDate || '-') + '</td>' +
        '<td>' + (sale.salesperson || '-') + '</td>' +
        '<td>' + (sale.leadType || '-') + '</td>' +
        '<td>' + (sale.buyerName || '-') + '</td>';
      tbody.appendChild(tr);
    });
  }

  function updateSalesKpis(records) {
    var total = records.reduce(function (sum, s) { return sum + (Number(s.salePrice) || 0); }, 0);
    var avg = records.length ? Math.round(total / records.length) : 0;
    var el;
    el = $('salesKpiTotal');
    if (el) el.textContent = formatMoney(total);
    el = $('salesKpiAvg');
    if (el) el.textContent = formatMoney(avg);
    el = $('salesKpiUnits');
    if (el) el.textContent = records.length;
  }

  function filterSalesData() {
    var filtered = filterSalesRecords(allSalesRecords);
    renderSalesTable(filtered);
    updateSalesKpis(filtered);
    renderSalesOverTimeChart(buildSalesOverTimeData(filtered));
    renderSalesByTypeChart(buildSalesByTypeData(filtered));
    renderSalesByLeadChart(buildSalesByLeadData(filtered));
  }

  async function refreshSalesViews() {
    // Merge local sold inventory with blob records
    var localSold = getSoldFromInventory();
    var blobRecords = [];
    try { blobRecords = await readSalesBlob(); } catch { /* local only */ }
    allSalesRecords = mergeSalesRecords(localSold, blobRecords);
    populateSalesFilterDropdowns(allSalesRecords);
    filterSalesData();
  }

  var salesTabInitialized = false;
  function initSalesTab() {
    if (salesTabInitialized) return;
    salesTabInitialized = true;
    refreshSalesViews();
  }

  // ─── Add Vehicle Wizard ─────────────────────────────────────────────────────
  var addWizardStep = 1;
  var ADD_WIZARD_TOTAL = 5;

  function showWizardStep(n) {
    addWizardStep = Math.max(1, Math.min(n, ADD_WIZARD_TOTAL));
    document.querySelectorAll('#addInventoryForm .wizard-step-panel').forEach(function (panel) {
      panel.hidden = (parseInt(panel.dataset.wstep, 10) !== addWizardStep);
    });
    var vinSection = $('addVinSection');
    if (vinSection) vinSection.hidden = (addWizardStep !== 1);
    document.querySelectorAll('#addWizardProgress .wizard-step-dot').forEach(function (dot) {
      var s = parseInt(dot.dataset.wstep, 10);
      dot.classList.toggle('active', s === addWizardStep);
      dot.classList.toggle('done', s < addWizardStep);
    });
    var label = $('addWizardStepLabel');
    if (label) label.textContent = 'Step ' + addWizardStep + ' of ' + ADD_WIZARD_TOTAL;
    var backBtn = $('addWizardBack');
    var nextBtn = $('addWizardNext');
    if (backBtn) backBtn.hidden = (addWizardStep === 1);
    if (nextBtn) nextBtn.hidden = (addWizardStep === ADD_WIZARD_TOTAL);
  }

  function initAddVehicleWizard() {
    showWizardStep(1);
    var nextBtn = $('addWizardNext');
    if (nextBtn) nextBtn.addEventListener('click', function () { showWizardStep(addWizardStep + 1); });
    var backBtn = $('addWizardBack');
    if (backBtn) backBtn.addEventListener('click', function () { showWizardStep(addWizardStep - 1); });
    document.querySelectorAll('#addWizardProgress .wizard-step-dot').forEach(function (dot) {
      dot.addEventListener('click', function () { showWizardStep(parseInt(dot.dataset.wstep, 10)); });
    });
  }

  // ─── Init ───────────────────────────────────────────────────────────────────
  function init() {
    // Auto-restore session (eliminates double-login after edge function auth)
    try {
      var saved = sessionStorage.getItem('bf_admin_session');
      if (saved) {
        var session = JSON.parse(saved);
        if (session.authenticated && session.token) {
          blogToken = session.token;
          blogUser = session.user || '';
          authPasswordHash = session.passwordHash || '';
          toggleAuth(true, blogUser);
          Promise.all([loadBlogPosts(), loadBlogComments()]).then(function () {
            renderOverview();
          });
          loadInventoryFromSite();
        }
      }
    } catch {
      // Corrupt session data — ignore, user will see login form
    }

    // Auth
    loginForm.addEventListener('submit', handleLogin);
    logoutBtn.addEventListener('click', () => {
      blogToken = '';
      blogUser = '';
      authPasswordHash = '';
      sessionStorage.removeItem('bf_admin_session');
      // Clear the server-side auth cookie
      document.cookie = 'bf_admin_token=; Path=/; Max-Age=0; SameSite=Strict';
      toggleAuth(false);
      // Reload to trigger edge function auth gate
      window.location.reload();
    });

    // Inventory table
    $('inventoryTable').addEventListener('click', handleTableActions);
    $('inventoryTable').addEventListener('change', handleRowCheckbox);
    if ($('selectAllCheckbox')) $('selectAllCheckbox').addEventListener('change', handleSelectAll);
    if ($('bulkDeleteBtn')) $('bulkDeleteBtn').addEventListener('click', handleBulkDelete);
    if ($('bulkDeselectBtn')) $('bulkDeselectBtn').addEventListener('click', handleBulkDeselect);
    // Bulk edit
    if ($('bulkEditBtn')) $('bulkEditBtn').addEventListener('click', openBulkEditModal);
    if ($('bulkEditForm')) $('bulkEditForm').addEventListener('submit', handleBulkEditSubmit);
    if ($('cancelBulkEdit')) $('cancelBulkEdit').addEventListener('click', function() { $('bulkEditModal').classList.remove('active'); });
    // Bulk field toggles — enable/disable corresponding input when checkbox changes
    document.querySelectorAll('.bulk-field-toggle').forEach(function(cb) {
      cb.addEventListener('change', function() {
        var input = cb.closest('.bulk-field').querySelector('input:not([type="checkbox"]), select');
        if (input) { input.disabled = !cb.checked; if (cb.checked) input.focus(); }
      });
    });
    // Draft banner actions
    if ($('draftPublishBtn')) $('draftPublishBtn').addEventListener('click', handleDraftPublish);
    if ($('draftDiscardBtn')) $('draftDiscardBtn').addEventListener('click', handleDraftDiscard);
    if ($('draftReviewToggle')) $('draftReviewToggle').addEventListener('click', openReviewChanges);
    if ($('reviewCloseBtn')) $('reviewCloseBtn').addEventListener('click', function() { $('reviewChangesModal').classList.remove('active'); });
    if ($('reviewPublishBtn')) $('reviewPublishBtn').addEventListener('click', function() { $('reviewChangesModal').classList.remove('active'); handleDraftPublish(); });
    if ($('reviewChangesModal')) $('reviewChangesModal').addEventListener('click', function(e) { if (e.target === $('reviewChangesModal')) $('reviewChangesModal').classList.remove('active'); });
    // Close bulk edit modal on backdrop click
    if ($('bulkEditModal')) $('bulkEditModal').addEventListener('click', function(e) { if (e.target === $('bulkEditModal')) $('bulkEditModal').classList.remove('active'); });
    $('editForm').addEventListener('submit', handleEditSubmit);
    $('cancelEdit').addEventListener('click', () => tryCloseEditModal());
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
    if ($('editGenDescBtn')) $('editGenDescBtn').addEventListener('click', editGenerateDescription);
    $('editAiMasterBtn').addEventListener('click', editMasterAI);
    $('editMpgLookupBtn').addEventListener('click', function () {
      editMpgLookup(this._mpgForceNext || false);
    });
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

    // Unified AI Autofill — Add form
    if ($('addAiAutofillBtn')) {
      $('addAiAutofillBtn').addEventListener('click', function () { runAiAutofill('add'); });
    }
    if ($('addAiApplyBtn')) {
      $('addAiApplyBtn').addEventListener('click', function () { applyAiReviewSelections('add'); });
    }
    if ($('addAiDismissBtn')) {
      $('addAiDismissBtn').addEventListener('click', function () {
        var panel = $('addAiReview');
        if (panel) panel.classList.add('hide');
      });
    }

    // Unified AI Autofill — Edit modal
    if ($('editAiAutofillBtn')) {
      $('editAiAutofillBtn').addEventListener('click', function () { runAiAutofill('edit'); });
    }
    if ($('editAiApplyBtn')) {
      $('editAiApplyBtn').addEventListener('click', function () { applyAiReviewSelections('edit'); });
    }
    if ($('editAiDismissBtn')) {
      $('editAiDismissBtn').addEventListener('click', function () {
        var panel = $('editAiReview');
        if (panel) panel.classList.add('hide');
      });
    }

    // Stats error retry
    if ($('statsRetryBtn')) $('statsRetryBtn').addEventListener('click', function () {
      statsCache = { data: null, time: 0, period: '' };
      var banner = $('statsErrorBanner');
      if (banner) banner.classList.add('hide');
      renderOverview();
    });

    // Inventory import/export
    $('loadFromSiteBtn').addEventListener('click', loadInventoryFromSite);
    $('importInventoryFile').addEventListener('change', importInventoryFile);
    $('clearLocalBtn').addEventListener('click', clearLocalInventory);

    // Add Vehicle wizard + chip inputs
    initAddVehicleWizard();
    initChipInput('addChipsWrap', 'addFeatures');
    initChipInput('editChipsWrap', 'editFeatures');
    addForm.addEventListener('submit', handleAddSubmit);
    $('clearAdd').addEventListener('click', () => {
      addForm.reset(); hideFeedback(addFeedback); updateLivePreview();
      showWizardStep(1);
      if ($('addFeatures')._refreshChips) $('addFeatures')._refreshChips();
      addPhotoFiles = []; addPreviewIndex = 0;
      // Clean up thumbnail object URLs
      thumbnailCache.forEach(function (url) { if (url && url.startsWith('blob:')) URL.revokeObjectURL(url); });
      thumbnailCache.clear();
      if ($('photoPreview')) $('photoPreview').innerHTML = '';
      if ($('uploadGalleryHeader')) $('uploadGalleryHeader').classList.add('hide');
      updatePhotoCount('addPhotoCount', 0);
      updateAiButtonVisibility();
      if ($('addAiReview')) $('addAiReview').classList.add('hide');
      if ($('addAiStatus')) $('addAiStatus').classList.add('hide');
    });
    $('cancelEditVehicle').addEventListener('click', exitEditMode);
    $('decodeVinBtn').addEventListener('click', decodeVin);
    $('applyVinBtn').addEventListener('click', applyVinData);
    $('addVin').addEventListener('input', function () {
      this.value = this.value.toUpperCase();
      var autofillBtn = $('addAiAutofillBtn');
      if (autofillBtn) autofillBtn.classList.toggle('hide', !this.value.trim() && !addPhotoFiles.length);
    });
    $('generateDescBtn').addEventListener('click', generateAIDescription);
    $('addMpgLookupBtn').addEventListener('click', function () {
      addMpgLookup(this._mpgForceNext || false);
    });
    setupBatchUploadZone();
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

    // Blog (Quill init deferred to switchTab — needs visible container)
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

    // Escape key — edit modal is locked (must use Cancel button), other modals close normally
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        var leadModal = $('leadModal');
        if (leadModal && leadModal.classList.contains('show')) {
          closeLeadModal();
        } else if (editModal.classList.contains('active')) {
          // Edit modal is locked — Escape triggers the unsaved-changes guard
          tryCloseEditModal();
        } else {
          document.querySelectorAll('.modal.active').forEach(function(m) { m.classList.remove('active'); });
        }
      }
    });

    // Sold modal
    var soldModal = $('soldModal');
    if (soldModal) soldModal.addEventListener('click', closeModals);
    $('soldForm').addEventListener('submit', handleSoldSubmit);
    $('soldLeadType').addEventListener('change', toggleLeadDetail);

    // Bookings collapsible toggle
    var bookingsToggle = $('bookingsToggle');
    var bookingsMenu = $('bookingsMenu');
    if (bookingsToggle && bookingsMenu) {
      bookingsToggle.addEventListener('click', function () {
        var expanded = bookingsToggle.getAttribute('aria-expanded') === 'true';
        bookingsToggle.setAttribute('aria-expanded', String(!expanded));
        bookingsMenu.classList.toggle('collapsed', expanded);
        var arrow = bookingsToggle.querySelector('.collapse-arrow');
        if (arrow) arrow.style.transform = expanded ? 'rotate(-90deg)' : '';
      });
    }

    // Color picker ↔ hex text sync (add form)
    (function () {
      var hexAdd = $('addSwatchHex'), pickerAdd = $('addSwatchPicker');
      if (hexAdd && pickerAdd) {
        pickerAdd.addEventListener('input', function () { hexAdd.value = pickerAdd.value; });
        hexAdd.addEventListener('input', function () {
          if (/^#[0-9a-fA-F]{6}$/.test(hexAdd.value.trim())) pickerAdd.value = hexAdd.value.trim();
        });
      }
      var hexEdit = $('editSwatchHex'), pickerEdit = $('editSwatchPicker');
      if (hexEdit && pickerEdit) {
        pickerEdit.addEventListener('input', function () { hexEdit.value = pickerEdit.value; });
        hexEdit.addEventListener('input', function () {
          if (/^#[0-9a-fA-F]{6}$/.test(hexEdit.value.trim())) pickerEdit.value = hexEdit.value.trim();
        });
      }
    })();

    // Theme toggle
    var themeBtn = $('themeToggleBtn');
    if (themeBtn) themeBtn.addEventListener('click', toggleTheme);

    // Sales tab filters
    var salesTypeFilter = $('salesFilterType');
    if (salesTypeFilter) salesTypeFilter.addEventListener('change', filterSalesData);
    var salesDateFilter = $('salesFilterDateRange');
    if (salesDateFilter) salesDateFilter.addEventListener('change', filterSalesData);
    var salesLeadFilter = $('salesFilterLeadType');
    if (salesLeadFilter) salesLeadFilter.addEventListener('change', filterSalesData);
    var salesSpFilter = $('salesFilterSalesperson');
    if (salesSpFilter) salesSpFilter.addEventListener('change', filterSalesData);

    // Lazy-init sales charts when Sales tab is clicked
    document.querySelectorAll('.tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        if (tab.dataset.tab === 'sales') initSalesTab();
      });
    });

    // Lead manager
    initLeadManager();

    // Initial render
    renderInventoryTable();
    renderBlogList();
  }

  init();
})();
