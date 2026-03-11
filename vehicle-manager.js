// vehicle-manager.js
// Inventory admin logic (VIN decode + add/edit/delete + photo filename tooling).
// Works on a static site by storing changes in localStorage and downloading inventory.json.

// ─── State ─────────────────────────────────────────────────────────────────────
let EDIT_INDEX = null;
let EDIT_ORIGINAL_DATE = null;
let EXISTING_IMAGE_NAMES = [];   // filenames/keys already in inventory
let NEW_IMAGE_FILES = [];        // File objects selected in this session
let PREVIEW_IMAGE_NAME = null;  // user-chosen preview image (null = first image)
let VM_SUBMIT_IN_PROGRESS = false; // double-submit guard
const VM_MAX_PHOTO_SIZE = 5 * 1024 * 1024; // 5 MB per photo

// ─── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function () {
  initDynamicYearMax();
  setupAdminTools();
  setupExportButton();
  setupVinDecoder();
  setupVinUppercase();
  setupImageHandlers();
  setupLivePreview();
  setupFormHandlers();
  setupInventorySearch();
  setupAISettings();
  setupAIDescription();
  setupSwatchPreviews();
  loadInventoryTable();
  renderImagePreview();
  updateInventoryStatus();
});

// ─── Helpers ───────────────────────────────────────────────────────────────────
function $(id) { return document.getElementById(id); }

function readInventory() {
  try {
    const inv = JSON.parse(localStorage.getItem('bellsfork_inventory') || '{"vehicles":[]}');
    if (!inv || typeof inv !== 'object') return { vehicles: [] };
    if (!Array.isArray(inv.vehicles)) inv.vehicles = [];
    return inv;
  } catch {
    return { vehicles: [] };
  }
}

function writeInventory(inv) {
  inv.lastUpdated = new Date().toISOString();
  localStorage.setItem('bellsfork_inventory', JSON.stringify(inv));
}

function downloadInventoryJSON(inv) {
  const dataStr  = JSON.stringify(inv, null, 2);
  const dataUri  = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);
  const link     = document.createElement('a');
  link.setAttribute('href', dataUri);
  link.setAttribute('download', 'inventory.json');
  link.click();
}

function safeSlug(str) {
  return (str || '')
    .toString()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9\-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

// Conservative Title Case: only normalize ALL-CAPS strings.
function toTitleCase(str) {
  const s = (str || '').toString().trim();
  if (!s) return '';
  const hasLower = /[a-z]/.test(s);
  const hasUpper = /[A-Z]/.test(s);
  if (hasUpper && !hasLower) {
    return s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  }
  return s;
}

function uniqueKeepOrder(arr) {
  const out = [];
  const seen = new Set();
  for (const x of (arr || [])) {
    if (!x) continue;
    if (seen.has(x)) continue;
    seen.add(x);
    out.push(x);
  }
  return out;
}

function getEffectivePreviewName() {
  if (PREVIEW_IMAGE_NAME) return PREVIEW_IMAGE_NAME;
  if (EXISTING_IMAGE_NAMES.length) return EXISTING_IMAGE_NAMES[0];
  return null;
}

// ─── Blob upload ────────────────────────────────────────────────────────────
// Uploads a photo to Netlify Blobs. Original filename is ignored; the server
// creates a standardized key like STOCKNUMBER-01.jpg and returns blob:key.
async function uploadPhotoToBlobs(file, stockNumber, photoIndex) {
  if (file.size > VM_MAX_PHOTO_SIZE) {
    throw new Error('Photo "' + file.name + '" exceeds 5 MB limit.');
  }
  const session = JSON.parse(sessionStorage.getItem('bf_admin_session') || '{}');
  if (!session.username || !session.passwordHash) {
    throw new Error('Not authenticated. Please log in again.');
  }
  const base64 = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
  const res = await fetch('/.netlify/functions/photo-upload', {
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
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Photo upload failed');
  }
  const data = await res.json();
  return data.key; // e.g. "blob:STOCK-01.jpg"
}

async function uploadPhotos(files, stockNumber, progressCb) {
  const keys = [];
  const errors = [];
  for (let i = 0; i < files.length; i++) {
    if (progressCb) progressCb(i + 1, files.length);
    try {
      const key = await uploadPhotoToBlobs(files[i], stockNumber, i + 1);
      keys.push(key);
    } catch (err) {
      console.error('Photo upload failed for ' + files[i].name + ':', err);
      errors.push(files[i].name + ': ' + err.message);
    }
  }
  if (keys.length === 0 && errors.length > 0) {
    throw new Error('All photo uploads failed:\n' + errors.join('\n'));
  }
  if (errors.length > 0) {
    console.warn('Some photos failed to upload:', errors);
  }
  return keys;
}

// ─── OEM Label Detection ────────────────────────────────────────────────────
const OEM_DETECT_API = '/.netlify/functions/oem-label-detect';

async function detectOemLabels(imageKeys) {
  const session = JSON.parse(sessionStorage.getItem('bf_admin_session') || '{}');
  if (!session.username || !session.passwordHash) return { oem_scan: null, photo_roles: [] };

  const siteOrigin = window.location.origin;
  const photoRoles = [];
  let oemScan = null;

  for (let i = 0; i < imageKeys.length; i++) {
    const key = imageKeys[i];
    let imageUrl;
    if (key.startsWith('blob:')) {
      imageUrl = siteOrigin + '/photos/' + key.slice(5);
    } else if (key.startsWith('http')) {
      imageUrl = key;
    } else {
      imageUrl = siteOrigin + '/assets/vehicles/' + key;
    }

    try {
      const res = await fetch(OEM_DETECT_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          auth: { user: session.username, passwordHash: session.passwordHash },
          imageUrl: imageUrl,
        }),
      });
      if (!res.ok) continue;
      const data = await res.json();
      if (data.ok && data.is_oem_label_photo) {
        photoRoles.push({ filename: key, role: 'oem_label_processing_only' });
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

// ─── Swatch Hex Preview ──────────────────────────────────────────────────────
function updateSwatchPreview(inputId, previewId) {
  const input = $(inputId);
  const chip = $(previewId);
  if (!input || !chip) return;
  const hex = (input.value || '').trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(hex)) {
    chip.style.background = hex;
  } else {
    chip.style.background = '#eee';
  }
}

function setupSwatchPreviews() {
  const addInput = $('addSwatchHex');
  if (addInput) {
    addInput.addEventListener('input', function () {
      updateSwatchPreview('addSwatchHex', 'addSwatchPreview');
    });
  }
  const editInput = $('editSwatchHex');
  if (editInput) {
    editInput.addEventListener('input', function () {
      updateSwatchPreview('editSwatchHex', 'editSwatchPreview');
    });
  }
}

// ─── OEM/Color Detection Preview Panel ───────────────────────────────────────
function renderOemColorPreview(vehicle) {
  var panel = $('oemColorDetection');
  if (!panel) return;

  var v = vehicle || {};
  var oemScan = v.oem_scan || {};
  var hasOemData = !!(oemScan.paint_code || oemScan.color_name || oemScan.confidence);
  var hasColorDisplay = !!(v.color_display || v.paintCode || v.swatchHex);

  if (!hasOemData && !hasColorDisplay) {
    panel.classList.add('hide');
    return;
  }

  panel.classList.remove('hide');

  // Resolve color display for preview
  var cd = v.color_display;
  if (!cd && window.ColorLookup && window.ColorLookup.resolveVehicleColorDisplay) {
    cd = window.ColorLookup.resolveVehicleColorDisplay(v);
  }
  cd = cd || {};

  // Populate fields
  var el;
  el = $('oemDetectedLabel');
  if (el) el.textContent = hasOemData ? 'Yes' : 'No';

  el = $('oemConfidenceLabel');
  if (el) {
    var conf = oemScan.confidence || 0;
    if (conf >= 0.8) el.textContent = 'High (' + Math.round(conf * 100) + '%)';
    else if (conf >= 0.5) el.textContent = 'Medium (' + Math.round(conf * 100) + '%)';
    else if (conf > 0) el.textContent = 'Low (' + Math.round(conf * 100) + '%)';
    else el.textContent = '—';
  }

  el = $('oemExtPaintCode');
  if (el) el.textContent = oemScan.paint_code || '—';

  el = $('oemExtColor');
  if (el) el.textContent = oemScan.color_name || '—';

  el = $('oemFinalColor');
  if (el) el.textContent = cd.exterior_color_name || v.exteriorColor || '—';

  el = $('oemFinalPaintCode');
  if (el) el.textContent = cd.paint_code || v.paintCode || '—';

  // Swatch
  var swatchHex = v.swatchHex || cd.web_swatch_hex || '';
  el = $('oemSwatchChip');
  if (el) el.style.background = /^#[0-9A-Fa-f]{6}$/.test(swatchHex) ? swatchHex : '#eee';

  el = $('oemSwatchLabel');
  if (el) el.textContent = swatchHex ? (cd.web_swatch_label || 'Approximate website sample') : '—';
}

// ─── Dynamic year max ──────────────────────────────────────────────────────────
function initDynamicYearMax() {
  const yearInput = $('year');
  if (!yearInput) return;
  const max = new Date().getFullYear() + 1;
  yearInput.max = String(max);
}

// ─── Admin Tools ───────────────────────────────────────────────────────────────
function setupAdminTools() {
  const loadBtn  = $('loadFromSiteBtn');
  const importEl = $('importInventoryFile');
  const clearBtn = $('clearLocalBtn');

  if (loadBtn) {
    loadBtn.addEventListener('click', async () => {
      try {
        const res = await fetch('inventory.json', { cache: 'no-store' });
        if (!res.ok) throw new Error('Could not load inventory.json from this site');
        const data = await res.json();
        if (!data || !Array.isArray(data.vehicles)) throw new Error('inventory.json format invalid');
        writeInventory({ vehicles: data.vehicles, lastUpdated: data.lastUpdated || new Date().toISOString() });
        loadInventoryTable();
        updateInventoryStatus();
        alert(`Loaded ${data.vehicles.length} vehicles from inventory.json into local inventory.`);
      } catch (e) {
        console.error(e);
        alert(`Load failed: ${e.message}`);
      }
    });
  }

  if (importEl) {
    importEl.addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (!data || !Array.isArray(data.vehicles)) throw new Error('Invalid inventory.json: missing vehicles[]');
        writeInventory({ vehicles: data.vehicles, lastUpdated: data.lastUpdated || new Date().toISOString() });
        loadInventoryTable();
        updateInventoryStatus();
        alert(`Imported ${data.vehicles.length} vehicles into local inventory.`);
      } catch (err) {
        console.error(err);
        alert(`Import failed: ${err.message}`);
      } finally {
        e.target.value = '';
      }
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (!confirm('Clear local inventory in this browser? This does NOT change your live site until you upload a new inventory.json.')) return;
      localStorage.removeItem('bellsfork_inventory');
      cancelEdit();
      loadInventoryTable();
      updateInventoryStatus();
      alert('Local inventory cleared.');
    });
  }
}

function updateInventoryStatus() {
  const el = $('inventoryStatus');
  if (!el) return;
  const inv = readInventory();
  const count = inv.vehicles.length;
  const updated = inv.lastUpdated ? new Date(inv.lastUpdated).toLocaleString() : '—';
  el.textContent = `Local inventory: ${count} vehicle${count === 1 ? '' : 's'} · Last updated: ${updated}`;
}

// ─── Export button ─────────────────────────────────────────────────────────────
function setupExportButton() {
  const btn = $('exportBtn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const inv = readInventory();
    if (!inv.vehicles.length) {
      alert('No vehicles in local inventory yet. Add or load inventory first.');
      return;
    }
    downloadInventoryJSON(inv);
    alert('Downloaded inventory.json from your local inventory. Upload it to your website root.');
  });
}

// ─── VIN Decoder ───────────────────────────────────────────────────────────────
function setupVinDecoder() {
  const btn = $('decodeBtn');
  if (!btn) return;

  btn.addEventListener('click', async function () {
    const vinInput = $('vin');
    const vin      = (vinInput?.value || '').trim().toUpperCase();
    const spinner  = $('decodeSpinner');
    const errEl    = $('vinError');

    if (!vinInput) return;

    // Validate
    if (vin.length !== 17) {
      vinInput.classList.add('is-invalid');
      if (errEl) errEl.textContent = 'VIN must be exactly 17 characters.';
      return;
    }

    vinInput.classList.remove('is-invalid');
    if (errEl) errEl.textContent = '';

    // Loading
    btn.disabled = true;
    if (spinner) spinner.classList.remove('d-none');
    const label = btn.querySelector('.btn-label');
    if (label) label.textContent = 'Decoding…';

    try {
      const response = await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVin/${vin}?format=json`);
      if (!response.ok) throw new Error('Network error reaching VIN database.');

      const data = await response.json();
      if (!data || !data.Results) throw new Error('Invalid response from VIN database.');

      const results = data.Results;
      const get = (name) => {
        const item = results.find(r => r.Variable === name);
        return item && item.Value && item.Value !== 'Not Applicable' ? item.Value : '';
      };

      const year         = get('Model Year');
      const make         = get('Make');
      const model        = get('Model');
      const trim         = get('Trim') || get('Trim2');
      const displacement = get('Displacement (L)');
      const cylinders    = get('Engine Number of Cylinders');
      const engineModel  = get('Engine Model');
      const transmission = get('Transmission Style');
      const driveType    = get('Drive Type');
      const bodyClass    = get('Body Class');
      const fuelType     = get('Fuel Type - Primary');
      const doors        = get('Doors');

      // Populate basic fields
      if ($('year'))  $('year').value  = year;
      if ($('make'))  $('make').value  = toTitleCase(make);
      if ($('model')) $('model').value = toTitleCase(model);
      if ($('trim'))  $('trim').value  = trim;

      // Engine
      const engineStr = displacement && cylinders
        ? `${parseFloat(displacement).toFixed(1)}L ${cylinders}-Cyl`
        : (engineModel || '');
      if ($('engine')) $('engine').value = engineStr;

      // Transmission
      if ($('transmission') && transmission) $('transmission').value = transmission;

      // Fuel
      const fuelSelect = $('fuelType');
      if (fuelSelect && fuelType) {
        const fuelMap = {
          'Gasoline': 'Gasoline',
          'Diesel': 'Diesel',
          'Electric': 'Electric',
          'Flexible Fuel Vehicle': 'Flex Fuel',
          'Hybrid': 'Hybrid'
        };
        const mapped = fuelMap[fuelType] || '';
        if (mapped) fuelSelect.value = mapped;
      }

      // Drivetrain
      const driveSelect = $('drivetrain');
      if (driveSelect && driveType) {
        const driveMap = {
          'Four-Wheel Drive': '4WD',
          '4WD/4-Wheel Drive/4x4': '4WD',
          'All-Wheel Drive': 'AWD',
          'AWD/All-Wheel Drive': 'AWD',
          'Front-Wheel Drive': 'FWD',
          'FWD/Front-Wheel Drive': 'FWD',
          'Rear-Wheel Drive': 'RWD',
          'RWD/Rear-Wheel Drive': 'RWD'
        };
        const mapped = driveMap[driveType] || '';
        if (mapped) driveSelect.value = mapped;
      }

      // Vehicle type
      const typeSelect = $('type');
      if (typeSelect && bodyClass) {
        const bl = bodyClass.toLowerCase();
        if (bl.includes('truck') || bl.includes('pickup')) typeSelect.value = 'truck';
        else if (bl.includes('suv') || bl.includes('sport utility')) typeSelect.value = 'suv';
        else if (bl.includes('sedan') || bl.includes('coupe') || bl.includes('hatchback')) typeSelect.value = 'car';
        else if (bl.includes('van')) typeSelect.value = 'van';

        if (fuelType && fuelType.toLowerCase().includes('diesel')) typeSelect.value = 'diesel';
      }

      // Auto-populate Features & Tags from decoded data
      const featuresField = $('features');
      if (featuresField) {
        const existing = featuresField.value.split(',').map(f => f.trim()).filter(Boolean);
        const decoded = [];

        // Drivetrain tag
        const dtVal = driveSelect?.value;
        if (dtVal && (dtVal === '4WD' || dtVal === 'AWD')) decoded.push(dtVal);

        // Engine tags
        if (cylinders) decoded.push(`V${cylinders}`);
        if (displacement) decoded.push(`${parseFloat(displacement).toFixed(1)}L`);
        const turbo = get('Turbo');
        if (turbo) decoded.push('Turbo');

        // Safety & ADAS features (only "Standard" = confirmed installed)
        const stdFeatures = [
          ['Backup Camera',                            'Backup Camera'],
          ['Anti-lock Braking System (ABS)',            'ABS'],
          ['Traction Control',                         'Traction Control'],
          ['Electronic Stability Control (ESC)',       'Stability Control'],
          ['Tire Pressure Monitoring System Type',     'TPMS'],
          ['Keyless Ignition',                         'Push Button Start'],
          ['Daytime Running Light (DRL)',              'Daytime Running Lights'],
          ['Forward Collision Warning (FCW)',          'Forward Collision Warning'],
          ['Lane Departure Warning (LDW)',             'Lane Departure Warning'],
          ['Lane Keeping Assistance (LKA)',            'Lane Keeping Assist'],
          ['Adaptive Cruise Control (ACC)',            'Adaptive Cruise Control'],
          ['Blind Spot Warning (BSW)',                 'Blind Spot Monitor'],
          ['Rear Cross Traffic Alert',                 'Rear Cross Traffic Alert'],
          ['Parking Assist',                           'Parking Assist'],
          ['Crash Imminent Braking (CIB)',             'Automatic Emergency Braking'],
          ['Auto-Reverse System for Windows and Sunroofs', 'Auto-Reverse Windows'],
        ];
        for (const [nhtsaField, label] of stdFeatures) {
          const val = get(nhtsaField);
          if (val && val.toLowerCase() === 'standard') decoded.push(label);
        }

        // Transmission tag
        if (transmission) {
          const tl = transmission.toLowerCase();
          if (tl.includes('automatic')) decoded.push('Automatic');
          else if (tl.includes('manual')) decoded.push('Manual');
        }

        // Body info
        if (bodyClass) {
          const bl = bodyClass.toLowerCase();
          if (bl.includes('crew') || bl.includes('super crew')) decoded.push('Crew Cab');
          else if (bl.includes('extended') || bl.includes('super cab')) decoded.push('Extended Cab');
        }
        const seats = get('Number of Seats');
        if (seats) decoded.push(`${seats}-Passenger`);

        // Merge: add decoded tags not already present (case-insensitive)
        const lowerExisting = new Set(existing.map(f => f.toLowerCase()));
        for (const tag of decoded) {
          if (!lowerExisting.has(tag.toLowerCase())) {
            existing.push(tag);
            lowerExisting.add(tag.toLowerCase());
          }
        }
        featuresField.value = existing.join(', ');
      }

      // Clear description so AI can generate it fresh
      const descField = $('description');
      if (descField && !descField.value.trim()) {
        descField.value = '';
        descField.placeholder = 'Click "Generate with AI" or type a description';
      }

      // Decoded panel
      const panel = $('decodedData');
      if (panel) {
        panel.classList.remove('d-none');
        const setField = (id, val) => { const el = $(id); if (el) el.textContent = val || '–'; };
        setField('decodedYear', year);
        setField('decodedMake', toTitleCase(make));
        setField('decodedModel', toTitleCase(model));
        setField('decodedTrim', trim);
        setField('decodedBody', bodyClass);
        setField('decodedDrive', driveType);
        setField('decodedFuel', fuelType);
      }

      updateLivePreview();

    } catch (error) {
      console.error('VIN Decode Error:', error);
      alert(`Could not decode VIN: ${error.message}\n\nPlease verify the VIN or enter details manually.`);
    } finally {
      btn.disabled = false;
      if (spinner) spinner.classList.add('d-none');
      const label2 = btn.querySelector('.btn-label');
      if (label2) label2.textContent = 'Decode VIN';
    }
  });
}

// ─── VIN Uppercase ─────────────────────────────────────────────────────────────
function setupVinUppercase() {
  const vinInput = $('vin');
  if (!vinInput) return;

  vinInput.addEventListener('input', function () {
    const pos = this.selectionStart;
    this.value = this.value.toUpperCase();
    this.setSelectionRange(pos, pos);
  });

  vinInput.addEventListener('keypress', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      $('decodeBtn')?.click();
    }
  });
}

// ─── Image tooling ─────────────────────────────────────────────────────────────
function setupImageHandlers() {
  const photosInput = $('photos');
  if (photosInput) {
    photosInput.addEventListener('change', function (e) {
      const files = Array.from(e.target.files || []);
      if (files.length > 10) {
        alert('Maximum 10 images allowed.');
        e.target.value = '';
        return;
      }
      NEW_IMAGE_FILES = files;
      renderImagePreview();
    });
  }
}

// Resolve an image key to a displayable URL for thumbnails
function resolveImageSrc(name) {
  if (!name) return '';
  if (String(name).startsWith('http')) return name;
  if (String(name).startsWith('blob:')) return 'photos/' + name.slice(5);
  return 'assets/vehicles/' + name;
}

function renderImagePreview() {
  const preview = $('imagePreview');
  if (!preview) return;
  preview.innerHTML = '';

  const allExisting = Array.isArray(EXISTING_IMAGE_NAMES) ? EXISTING_IMAGE_NAMES : [];
  const allNew = Array.isArray(NEW_IMAGE_FILES) ? NEW_IMAGE_FILES : [];
  const effectivePreview = getEffectivePreviewName();

  // Existing images (click X to remove, click image to set as preview)
  allExisting.forEach((name, idx) => {
    const wrap = document.createElement('div');
    wrap.className = 'img-wrap';

    const img = document.createElement('img');
    const isPreview = (name === effectivePreview);
    img.className = 'img-thumb' + (isPreview ? ' is-preview' : '');
    img.alt = `Photo ${idx + 1}`;
    img.title = 'Click to set as preview image';
    img.src = resolveImageSrc(name);
    img.onerror = () => {
      img.style.objectFit = 'contain';
      img.style.padding = '18px';
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 16 16"><rect x="1" y="3" width="14" height="12" rx="1" fill="none" stroke="#adb5bd"/><circle cx="5.2" cy="14" r="1.2" fill="#adb5bd"/><circle cx="12.8" cy="14" r="1.2" fill="#adb5bd"/></svg>');
    };
    img.addEventListener('click', () => {
      PREVIEW_IMAGE_NAME = name;
      renderImagePreview();
    });

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'img-remove';
    btn.setAttribute('aria-label', 'Remove photo');
    btn.innerHTML = '&times;';
    btn.addEventListener('click', () => {
      const removedName = EXISTING_IMAGE_NAMES[idx];
      EXISTING_IMAGE_NAMES.splice(idx, 1);
      if (PREVIEW_IMAGE_NAME === removedName) PREVIEW_IMAGE_NAME = null;
      renderImagePreview();
    });

    wrap.appendChild(btn);
    wrap.appendChild(img);
    if (isPreview) {
      const badge = document.createElement('div');
      badge.className = 'img-preview-badge';
      badge.textContent = 'Preview';
      wrap.appendChild(badge);
    }
    preview.appendChild(wrap);
  });

  // New images (preview from file, will be uploaded on save)
  allNew.forEach((file, idx) => {
    const wrap = document.createElement('div');
    wrap.className = 'img-wrap';
    const isPreview = (idx === 0 && !effectivePreview && !allExisting.length);

    const img = document.createElement('img');
    img.className = 'img-thumb' + (isPreview ? ' is-preview' : '');
    img.alt = `New photo ${idx + 1}`;
    img.title = 'Click to set as preview image';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'img-remove';
    btn.setAttribute('aria-label', 'Remove photo');
    btn.innerHTML = '&times;';
    btn.addEventListener('click', () => {
      NEW_IMAGE_FILES.splice(idx, 1);
      if (!NEW_IMAGE_FILES.length) {
        const photos = $('photos');
        if (photos) photos.value = '';
      }
      renderImagePreview();
    });

    wrap.appendChild(btn);
    wrap.appendChild(img);
    if (isPreview) {
      const badge = document.createElement('div');
      badge.className = 'img-preview-badge';
      badge.textContent = 'Preview';
      wrap.appendChild(badge);
    }
    preview.appendChild(wrap);

    const reader = new FileReader();
    reader.onload = (ev) => { img.src = ev.target.result; };
    reader.readAsDataURL(file);
  });
}

// ─── Live preview ──────────────────────────────────────────────────────────────
function setupLivePreview() {
  const watchIds = ['year','make','model','trim','price','mileage','type','badge','mpgCity','mpgHighway','fuelType','stockNumber','description'];
  watchIds.forEach(id => {
    const el = $(id);
    if (!el) return;
    el.addEventListener('input', updateLivePreview);
    el.addEventListener('change', updateLivePreview);
  });
}

function updateLivePreview() {
  const preview = $('preview');
  if (!preview) return;

  const year    = $('year')?.value || '';
  const make    = $('make')?.value || '';
  const model   = $('model')?.value || '';
  const trim    = $('trim')?.value || '';
  const price   = $('price')?.value || '';
  const mileage = $('mileage')?.value || '';
  const badge   = $('badge')?.value || '';
  const mpgCity = $('mpgCity')?.value || '';
  const mpgHwy  = $('mpgHighway')?.value || '';
  const fuel    = $('fuelType')?.value || '';
  const stock   = $('stockNumber')?.value || '';
  const desc    = $('description')?.value || '';

  if (!year || !make || !model) {
    preview.innerHTML = '<div class="text-center text-muted py-5"><small>Fill in Year, Make, and Model to see a live preview.</small></div>';
    return;
  }

  const badgeColor = badge === 'Diesel' ? 'warning text-dark' : badge === 'Low Miles' ? 'success' : 'danger';

  preview.innerHTML = `
    <article class="card shadow-sm h-100">
      <div style="position:relative;height:180px;background:#e9ecef;display:flex;align-items:center;justify-content:center;">
        ${badge ? `<span class="badge bg-${badgeColor}" style="position:absolute;top:.5rem;left:.5rem;">${badge}</span>` : ''}
        <svg width="48" height="48" fill="#adb5bd" viewBox="0 0 16 16" aria-hidden="true">
          <rect x="1" y="3" width="15" height="13" rx="1" fill="none" stroke="currentColor" stroke-width="1"/>
          <circle cx="5.5" cy="14.5" r="1.5" fill="none" stroke="currentColor"/>
          <circle cx="12.5" cy="14.5" r="1.5" fill="none" stroke="currentColor"/>
        </svg>
      </div>
      <div class="card-body">
        ${stock ? `<span class="badge bg-secondary mb-2">Stock #${stock}</span>` : ''}
        <div class="d-flex justify-content-between align-items-start mb-2">
          <h6 class="fw-bold mb-0">${year} ${make} ${model}${trim ? ' ' + trim : ''}</h6>
          ${price ? `<span class="badge bg-danger ms-1">$${parseInt(price,10).toLocaleString()}</span>` : ''}
        </div>
        ${desc ? `<p class="text-muted small mb-2">${desc}</p>` : ''}
        <p class="text-muted small mb-2">
          ${mileage ? `<strong>${parseInt(mileage,10).toLocaleString()} miles</strong>` : ''}
          ${fuel ? ` · ${fuel}` : ''}
          ${(mpgCity && mpgHwy) ? ` · ${mpgCity}/${mpgHwy} MPG` : ''}
        </p>
        <a href="#" class="btn btn-sm btn-outline-dark w-100" onclick="return false;">Inquire About This Vehicle</a>
      </div>
    </article>
  `;
}

// ─── Form submission / edit mode ───────────────────────────────────────────────
function setupFormHandlers() {
  const form = $('vehicleForm');
  if (!form) return;

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    if (VM_SUBMIT_IN_PROGRESS) return;
    VM_SUBMIT_IN_PROGRESS = true;

    const submitBtn = form.querySelector('button[type="submit"]');
    try {
      const g = (id) => { const el = $(id); return el ? el.value.trim() : ''; };

      const vin = g('vin').toUpperCase();
      if (vin && vin.length !== 17) {
        alert('VIN must be 17 characters.');
        return;
      }

      const stockNumber = g('stockNumber');
      const makeName = toTitleCase(g('make'));
      const modelName = toTitleCase(g('model'));

      // Required field validation
      if (!makeName) { alert('Make is required.'); return; }
      if (!modelName) { alert('Model is required.'); return; }

      const isEdit = EDIT_INDEX !== null;

      // Duplicate check BEFORE photo upload (fail fast)
      if (!isEdit) {
        const inv = readInventory();
        if (vin && inv.vehicles.some(v => v.vin && v.vin.toUpperCase() === vin)) {
          if (!confirm('A vehicle with the same VIN already exists. Add anyway?')) return;
        }
        if (stockNumber && inv.vehicles.some(v => v.stockNumber && v.stockNumber === stockNumber)) {
          if (!confirm('A vehicle with the same Stock # already exists. Add anyway?')) return;
        }
      }

      const vehicle = {
        vin:           vin,
        stockNumber:   stockNumber,
        year:          g('year') ? parseInt(g('year'), 10) : null,
        make:          makeName,
        model:         modelName,
        trim:          g('trim'),
        engine:        g('engine'),
        transmission:  g('transmission'),
        drivetrain:    g('drivetrain'),
        fuelType:      g('fuelType'),
        mpgCity:       g('mpgCity') ? parseInt(g('mpgCity'), 10) : null,
        mpgHighway:    g('mpgHighway') ? parseInt(g('mpgHighway'), 10) : null,
        mileage:       g('mileage') ? parseInt(g('mileage'), 10) : null,
        price:         g('price') ? parseInt(g('price'), 10) : null,
        type:          g('type'),
        exteriorColor: g('exteriorColor'),
        interiorColor: g('interiorColor'),
        description:   g('description'),
        features:      g('features').split(',').map(f => f.trim()).filter(Boolean),
        status:        g('status') || 'available',
        badge:         g('badge'),
        images:        [],
        dateAdded:     new Date().toISOString(),
        paintCode:     g('paintCode') || '',
        swatchHex:     g('swatchHex') || '',
        oem_scan:      null,
        photo_roles:   [],
        color_display: null,
      };

      // Auto-description if still empty
      if (!vehicle.description) {
        const parts = [];
        if (vehicle.drivetrain) parts.push(vehicle.drivetrain);
        if (vehicle.engine) parts.push(vehicle.engine);
        if (vehicle.mileage) parts.push(`${vehicle.mileage.toLocaleString()} miles`);
        vehicle.description = parts.join(', ');
      }

      // Upload new photos to Netlify Blobs
      let newImageKeys = [];
      if (NEW_IMAGE_FILES.length) {
        const uploadId = stockNumber || vin || String(Date.now());
        try {
          if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Uploading photos…'; }
          newImageKeys = await uploadPhotos(NEW_IMAGE_FILES, uploadId, (current, total) => {
            if (submitBtn) submitBtn.textContent = `Uploading photo ${current}/${total}…`;
          });
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = isEdit ? 'Update Vehicle' : 'Add Vehicle'; }
        } catch (err) {
          alert('Photo upload failed: ' + err.message);
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = isEdit ? 'Update Vehicle' : 'Add Vehicle'; }
          return;
        }
      }

      // Run OEM label detection on newly uploaded photos
      if (newImageKeys.length > 0 && typeof detectOemLabels === 'function') {
        try {
          if (submitBtn) submitBtn.textContent = 'Scanning for OEM labels…';
          const oemResult = await detectOemLabels(newImageKeys);
          if (oemResult.photo_roles.length > 0) {
            vehicle.photo_roles = oemResult.photo_roles;
          }
          if (oemResult.oem_scan) {
            vehicle.oem_scan = oemResult.oem_scan;
            if (oemResult.oem_scan.paint_code && !vehicle.paintCode) {
              vehicle.paintCode = oemResult.oem_scan.paint_code;
            }
            if (window.ColorLookup && window.ColorLookup.resolveVehicleColorDisplay) {
              vehicle.color_display = window.ColorLookup.resolveVehicleColorDisplay(vehicle);
            }
          }
          renderOemColorPreview(vehicle);
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = isEdit ? 'Update Vehicle' : 'Add Vehicle'; }
        } catch (oemErr) {
          console.warn('OEM detection error (non-fatal):', oemErr.message);
        }
      }

      // Images: combine new blob keys with existing, move preview to front
      let combined = newImageKeys.length
        ? [...newImageKeys, ...EXISTING_IMAGE_NAMES]
        : [...EXISTING_IMAGE_NAMES];
      combined = uniqueKeepOrder(combined);
      if (PREVIEW_IMAGE_NAME && combined.includes(PREVIEW_IMAGE_NAME)) {
        combined = [PREVIEW_IMAGE_NAME, ...combined.filter(n => n !== PREVIEW_IMAGE_NAME)];
      }
      vehicle.images = combined;

      const inv = readInventory();
      const editTarget = isEdit && inv.vehicles[EDIT_INDEX];

      if (editTarget) {
        vehicle.dateAdded = EDIT_ORIGINAL_DATE || inv.vehicles[EDIT_INDEX].dateAdded || vehicle.dateAdded;
        // Preserve OEM metadata from existing record when no new photos uploaded
        if (!newImageKeys.length) {
          vehicle.oem_scan = editTarget.oem_scan || vehicle.oem_scan;
          vehicle.photo_roles = editTarget.photo_roles || vehicle.photo_roles;
          vehicle.paintCode = vehicle.paintCode || editTarget.paintCode || '';
          vehicle.swatchHex = vehicle.swatchHex || editTarget.swatchHex || '';
          vehicle.color_display = editTarget.color_display || vehicle.color_display;
        }
        inv.vehicles[EDIT_INDEX] = vehicle;
      } else {
        inv.vehicles.push(vehicle);
      }

      writeInventory(inv);
      downloadInventoryJSON(inv);

      const action = editTarget ? 'updated' : 'added';
      const photoMsg = newImageKeys.length ? `\n${newImageKeys.length} photo(s) uploaded to server.` : '';
      alert(`Vehicle ${action}!\n\n${vehicle.year || ''} ${vehicle.make || ''} ${vehicle.model || ''}`.trim() +
        photoMsg + `\n\ninventory.json has been downloaded.\nUpload it to your website root to publish changes.`);

      cancelEdit();
      loadInventoryTable();
      updateInventoryStatus();
    } finally {
      VM_SUBMIT_IN_PROGRESS = false;
    }
  });

  const cancelBtn = $('cancelEditBtn');
  if (cancelBtn) cancelBtn.addEventListener('click', cancelEdit);
}

function startEdit(idx) {
  const inv = readInventory();
  const v = inv.vehicles[idx];
  if (!v) return;

  EDIT_INDEX = idx;
  EDIT_ORIGINAL_DATE = v.dateAdded || null;
  EXISTING_IMAGE_NAMES = Array.isArray(v.images) ? [...v.images] : [];
  NEW_IMAGE_FILES = [];
  PREVIEW_IMAGE_NAME = (Array.isArray(v.images) && v.images.length) ? v.images[0] : null;

  // Fill form
  const set = (id, val) => { const el = $(id); if (el !== null && el !== undefined && el) el.value = (val ?? ''); };
  set('vin', v.vin || '');
  set('stockNumber', v.stockNumber || '');
  set('year', v.year || '');
  set('make', v.make || '');
  set('model', v.model || '');
  set('trim', v.trim || '');
  set('engine', v.engine || '');
  set('transmission', v.transmission || '');
  set('drivetrain', v.drivetrain || '');
  set('fuelType', v.fuelType || '');
  set('mpgCity', v.mpgCity ?? '');
  set('mpgHighway', v.mpgHighway ?? '');
  set('mileage', v.mileage ?? '');
  set('price', v.price ?? '');
  set('type', v.type || '');
  set('exteriorColor', v.exteriorColor || '');
  set('interiorColor', v.interiorColor || '');
  set('paintCode', v.paintCode || '');
  set('swatchHex', v.swatchHex || '');
  set('description', v.description || '');
  set('features', Array.isArray(v.features) ? v.features.join(', ') : (v.features || ''));
  set('status', v.status || 'available');
  set('badge', v.badge || '');

  // Update swatch preview chip
  updateSwatchPreview('addSwatchHex', 'addSwatchPreview');

  // Show OEM/Color Detection panel if data exists
  renderOemColorPreview(v);

  // Clear file input
  const photos = $('photos');
  if (photos) photos.value = '';

  // Update UI
  const submitBtn = $('submitBtn');
  if (submitBtn) {
    submitBtn.textContent = 'Save Changes';
    submitBtn.classList.remove('btn-success');
    submitBtn.classList.add('btn-warning');
  }
  const cancelBtn = $('cancelEditBtn');
  if (cancelBtn) cancelBtn.style.display = '';
  const badge = $('editModeBadge');
  if (badge) badge.style.display = '';
  const title = $('formTitle');
  if (title) title.textContent = `Step 2: Edit Vehicle (Row ${idx + 1})`;

  renderImagePreview();
  updateLivePreview();

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function cancelEdit() {
  EDIT_INDEX = null;
  EDIT_ORIGINAL_DATE = null;
  EXISTING_IMAGE_NAMES = [];
  NEW_IMAGE_FILES = [];
  PREVIEW_IMAGE_NAME = null;

  const form = $('vehicleForm');
  if (form) form.reset();

  const panel = $('decodedData');
  if (panel) panel.classList.add('d-none');

  const photos = $('photos');
  if (photos) photos.value = '';

  const submitBtn = $('submitBtn');
  if (submitBtn) {
    submitBtn.textContent = 'Add Vehicle to Inventory';
    submitBtn.classList.add('btn-success');
    submitBtn.classList.remove('btn-warning');
  }

  const cancelBtn = $('cancelEditBtn');
  if (cancelBtn) cancelBtn.style.display = 'none';

  const badge = $('editModeBadge');
  if (badge) badge.style.display = 'none';

  const title = $('formTitle');
  if (title) title.textContent = 'Step 2: Add Vehicle';

  // Hide OEM preview panel and clear new fields
  var oemPanel = $('oemColorDetection');
  if (oemPanel) oemPanel.classList.add('hide');
  var pcField = $('addPaintCode');
  if (pcField) pcField.value = '';
  var shField = $('addSwatchHex');
  if (shField) shField.value = '';
  updateSwatchPreview('addSwatchHex', 'addSwatchPreview');

  renderImagePreview();
  updateLivePreview();
}

// ─── Inventory table ───────────────────────────────────────────────────────────
let INVENTORY_SEARCH = '';

function setupInventorySearch() {
  const input = $('inventorySearch');
  if (!input) return;
  input.addEventListener('input', () => {
    INVENTORY_SEARCH = input.value.trim().toLowerCase();
    loadInventoryTable();
  });
}

function loadInventoryTable() {
  const tbody = $('inventoryTableBody');
  if (!tbody) return;

  const inv = readInventory();
  const vehicles = inv.vehicles || [];

  updateInventoryStatus();

  const filtered = INVENTORY_SEARCH
    ? vehicles.filter(v => {
        const hay = `${v.year || ''} ${v.make || ''} ${v.model || ''} ${v.trim || ''} ${v.vin || ''} ${v.stockNumber || ''}`.toLowerCase();
        return hay.includes(INVENTORY_SEARCH);
      })
    : vehicles;

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4">${vehicles.length ? 'No matches.' : 'No vehicles in local inventory. Load/import or add a vehicle above.'}</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map((v, idxInFiltered) => {
    const realIdx = vehicles.indexOf(v);
    const title = `${v.year || ''} ${v.make || ''} ${v.model || ''}`.trim();
    const trim = v.trim ? `<br><small class="text-muted">${v.trim}</small>` : '';

    const hasImg = v.images && v.images.length && v.images[0];
    const thumbSrc = hasImg
      ? (String(v.images[0]).startsWith('http') ? v.images[0] : `assets/vehicles/${v.images[0]}`)
      : '';
    const thumb = hasImg
      ? `<img src="${thumbSrc}" alt="${title}" style="width:80px;height:60px;object-fit:cover;border-radius:6px;border:1px solid #dee2e6;" onerror="this.style.objectFit='contain';this.style.padding='10px';this.src='data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"80\" height=\"60\" viewBox=\"0 0 16 16\"><rect x=\"1\" y=\"3\" width=\"14\" height=\"12\" rx=\"1\" fill=\"none\" stroke=\"%23adb5bd\"/><circle cx=\"5.2\" cy=\"14\" r=\"1.2\" fill=\"%23adb5bd\"/><circle cx=\"12.8\" cy=\"14\" r=\"1.2\" fill=\"%23adb5bd\"/></svg>')}';">`
      : `<div style="width:80px;height:60px;background:#e9ecef;border-radius:6px;display:flex;align-items:center;justify-content:center;border:1px solid #dee2e6;">
            <svg width="26" height="26" fill="#6c757d" viewBox="0 0 16 16" aria-hidden="true">
              <rect x="1" y="3" width="15" height="13" rx="1" fill="none" stroke="currentColor" stroke-width="1"/>
              <circle cx="5.5" cy="14.5" r="1.5" fill="none" stroke="currentColor"/>
              <circle cx="12.5" cy="14.5" r="1.5" fill="none" stroke="currentColor"/>
            </svg>
          </div>`;

    const stockVin = `
      ${v.stockNumber ? `<div><span class=\"badge bg-secondary\">Stock #${v.stockNumber}</span></div>` : ''}
      <div class="small mono">${v.vin || '—'}</div>
    `;

    const miles = v.mileage ? `${Number(v.mileage).toLocaleString()} mi` : '—';
    const price = v.price ? `$${Number(v.price).toLocaleString()}` : '—';
    const status = (v.status || 'available').toLowerCase();
    const statusBadge = status === 'available' ? 'success' : (status === 'pending' ? 'warning text-dark' : 'secondary');

    return `
      <tr>
        <td>${thumb}</td>
        <td><strong>${title}</strong>${trim}</td>
        <td>${stockVin}</td>
        <td>${miles}</td>
        <td class="fw-bold">${price}</td>
        <td><span class="badge bg-${statusBadge}">${status.toUpperCase()}</span></td>
        <td>
          <div class="d-flex gap-1">
            <button type="button" class="btn btn-sm btn-outline-primary" onclick="editVehicle(${realIdx})">Edit</button>
            <button type="button" class="btn btn-sm btn-outline-danger" onclick="deleteVehicle(${realIdx})">Delete</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function editVehicle(idx) {
  startEdit(idx);
}

function deleteVehicle(idx) {
  if (!confirm('Delete this vehicle from local inventory?')) return;
  const inv = readInventory();
  inv.vehicles.splice(idx, 1);
  writeInventory(inv);
  loadInventoryTable();
  updateInventoryStatus();
}

// ─── Settings (OpenAI) ───────────────────────────────────────────────────────
function setupAISettings() {
  const saveBtn = $('saveOpenaiKeyBtn');
  const input   = $('openaiApiKey');
  if (!saveBtn || !input) return;

  // Load saved key (masked — show placeholder dots if set)
  const saved = localStorage.getItem('bf_openai_key') || '';
  if (saved) input.placeholder = '••••••••••••••••••••••••';

  saveBtn.addEventListener('click', () => {
    const key = input.value.trim();
    if (key) {
      localStorage.setItem('bf_openai_key', key);
      input.value = '';
      input.placeholder = '••••••••••••••••••••••••';
      saveBtn.textContent = 'Saved ✓';
      setTimeout(() => { saveBtn.textContent = 'Save'; }, 2000);
    } else {
      localStorage.removeItem('bf_openai_key');
      input.placeholder = 'sk-...';
      saveBtn.textContent = 'Cleared';
      setTimeout(() => { saveBtn.textContent = 'Save'; }, 2000);
    }
  });
}

// ─── AI Description Generator ────────────────────────────────────────────────
function setupAIDescription() {
  const btn = $('generateDescBtn');
  if (!btn) return;
  btn.addEventListener('click', generateAIDescription);
}

async function generateAIDescription() {
  const btn      = $('generateDescBtn');
  const descField = $('description');
  const apiKey   = localStorage.getItem('bf_openai_key') || '';

  if (!apiKey) {
    alert('Enter your OpenAI API key in the Settings section at the top of this page.');
    const el = document.getElementById('adminSettingsCollapse');
    if (el) new bootstrap.Collapse(el, { show: true });
    return;
  }

  const g = (id) => { const el = $(id); return el ? el.value.trim() : ''; };
  const year = g('year'), make = g('make'), model = g('model'), trim = g('trim');
  if (!year || !make || !model) {
    alert('Decode VIN or fill in Year, Make, and Model first.');
    return;
  }

  const details = {
    year, make, model, trim,
    engine: g('engine'), transmission: g('transmission'),
    drivetrain: g('drivetrain'), fuelType: g('fuelType'),
    mileage: g('mileage'), exteriorColor: g('exteriorColor'),
    interiorColor: g('interiorColor'), features: g('features'),
    bodyType: g('type'), mpgCity: g('mpgCity'), mpgHighway: g('mpgHighway'),
  };

  const detailLines = Object.entries(details)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');

  const prompt = `You are helping populate a used car dealer listing. Based on the vehicle details and any provided photos, fill in the following fields. Return ONLY a valid JSON object (no markdown, no code fences) with these exact keys:
- "description": a 2-4 sentence compelling dealer description, professional and appealing to buyers. Do not use excessive exclamation marks. Do not invent features not listed.
- "trim": vehicle trim level (e.g., "XLT", "Sport", "Limited") or "-"
- "engine": engine description (e.g., "5.0L V8", "2.5L 4-Cylinder") or "-"
- "vehicleType": one of these exact values: car, truck, suv, diesel, van — based on the vehicle body style, or "-"
- "drivetrain": one of these exact values: FWD, RWD, AWD, 4WD — or "-"
- "mpgCity": city fuel economy as a number only (e.g., 18) or "-"
- "mpgHwy": highway fuel economy as a number only (e.g., 25) or "-"
- "exteriorColor": exterior color (e.g., "Black", "Oxford White", "Silver") — examine provided photos carefully, or "-"
- "interiorColor": interior color (e.g., "Gray", "Black Leather", "Tan") — examine provided photos carefully, or "-"
- "features": comma-separated list of notable features for this vehicle (e.g., "4WD, V8, Backup Camera, Bluetooth, Tow Package, Running Boards")

Use your knowledge of this year/make/model/trim for MPG and specs when not provided. Examine any photos for color and visible features. If a value truly cannot be determined, use exactly "-".

Vehicle Details:
${detailLines}`;

  // Build message content — include up to 4 photos if available
  const content = [];
  for (const photoFile of NEW_IMAGE_FILES.slice(0, 4)) {
    try {
      const dataUrl = await fileToDataUrl(photoFile);
      content.push({ type: 'image_url', image_url: { url: dataUrl, detail: 'low' } });
    } catch (e) {
      console.warn('Could not encode photo for AI:', e);
    }
  }
  content.push({ type: 'text', text: prompt });

  btn.disabled = true;
  const origText = btn.innerHTML;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Generating…';

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 700,
        messages: [{ role: 'user', content }],
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `API error ${res.status}`);
    }

    const result = await res.json();
    let rawText = result.choices?.[0]?.message?.content || '';
    rawText = rawText.trim()
      .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();

    let aiData = {};
    try {
      aiData = JSON.parse(rawText);
    } catch (e) {
      // Fallback: treat entire response as description only
      aiData = { description: rawText };
    }

    // Only set a field if the AI returned a real (non-dash) value
    function setField(id, val) {
      const el = $(id);
      if (!el || !val || val === '-') return;
      el.value = val;
    }

    // Description
    if (aiData.description && descField) descField.value = aiData.description.trim();

    // Trim
    setField('trim', aiData.trim);

    // Engine
    setField('engine', aiData.engine);

    // Vehicle type (select)
    if (aiData.vehicleType && aiData.vehicleType !== '-') {
      const typeEl = $('type');
      const validTypes = ['car', 'truck', 'suv', 'diesel', 'van'];
      const aiType = String(aiData.vehicleType).toLowerCase().trim();
      if (typeEl && validTypes.includes(aiType)) typeEl.value = aiType;
    }

    // Drivetrain (select)
    if (aiData.drivetrain && aiData.drivetrain !== '-') {
      const driveEl = $('drivetrain');
      const validDrive = ['FWD', 'RWD', 'AWD', '4WD'];
      const aiDrive = String(aiData.drivetrain).toUpperCase().trim();
      if (driveEl && validDrive.includes(aiDrive)) driveEl.value = aiDrive;
    }

    // MPG City
    if (aiData.mpgCity && aiData.mpgCity !== '-') {
      const mpgCityEl = $('mpgCity');
      if (mpgCityEl) mpgCityEl.value = String(aiData.mpgCity).replace(/[^0-9]/g, '');
    }

    // MPG Highway
    if (aiData.mpgHwy && aiData.mpgHwy !== '-') {
      const mpgHwyEl = $('mpgHighway');
      if (mpgHwyEl) mpgHwyEl.value = String(aiData.mpgHwy).replace(/[^0-9]/g, '');
    }

    // Exterior color
    setField('exteriorColor', aiData.exteriorColor);

    // Interior color
    setField('interiorColor', aiData.interiorColor);

    // Features / tags — merge with any existing values, no duplicates
    if (aiData.features && aiData.features !== '-') {
      const featEl = $('features');
      if (featEl) {
        const existing = featEl.value.trim();
        if (!existing) {
          featEl.value = aiData.features;
        } else {
          const existingList = existing.split(',').map(f => f.trim().toLowerCase());
          const newList = String(aiData.features).split(',').map(f => f.trim());
          const toAdd = newList.filter(f => f && !existingList.includes(f.toLowerCase()));
          if (toAdd.length) featEl.value = existing + ', ' + toAdd.join(', ');
        }
      }
    }

    updateLivePreview();
  } catch (error) {
    console.error('AI Description Error:', error);
    alert(`Could not generate description: ${error.message}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = origText;
  }
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Expose for inline onclick
window.editVehicle = editVehicle;
window.deleteVehicle = deleteVehicle;
