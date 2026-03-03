// vehicle-manager.js
// Inventory admin logic (VIN decode + add/edit/delete + photo filename tooling).
// Works on a static site by storing changes in localStorage and downloading inventory.json.

// ─── State ─────────────────────────────────────────────────────────────────────
let EDIT_INDEX = null;
let EDIT_ORIGINAL_DATE = null;
let EXISTING_IMAGE_NAMES = [];   // filenames already in inventory
let NEW_IMAGE_FILES = [];        // File objects selected in this session
let NEW_IMAGE_NAMES = [];        // generated filenames for NEW_IMAGE_FILES
const PHOTO_OUTPUT_EXT = 'png';

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
  setupCloudinarySettings();
  setupAIDescription();
  updatePhotoUploadHint();
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

function sanitizeBase(str) {
  const base = (str || '').toString().trim();
  const out = base
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9\-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
  return out.slice(0, 40);
}

function normalizePhotoToken(str, fallback = '') {
  const out = sanitizeBase(str || '');
  return out || fallback;
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

function getPhotoBaseId() {
  const year = normalizePhotoToken(($('year')?.value || '').trim(), 'year');
  const exteriorColor = normalizePhotoToken(($('exteriorColor')?.value || '').trim(), '');
  const make = normalizePhotoToken(($('make')?.value || '').trim(), 'make');
  const model = normalizePhotoToken(($('model')?.value || '').trim(), 'model');
  const stock = normalizePhotoToken(($('stockNumber')?.value || '').trim(), '');
  const vin = normalizePhotoToken(($('vin')?.value || '').trim().toUpperCase(), '');
  const trailingId = stock || vin || String(Date.now());

  const parts = exteriorColor
    ? [year, exteriorColor, make, model, trailingId]
    : [year, make, model, trailingId];

  return parts.filter(Boolean).join('-');
}

function regenerateNewPhotoNames() {
  if (!NEW_IMAGE_FILES.length) return;
  const base = getPhotoBaseId();
  NEW_IMAGE_NAMES = NEW_IMAGE_FILES.map((f, i) => {
    const num = String(i + 1).padStart(2, '0');
    return `${base}-${num}.${PHOTO_OUTPUT_EXT}`;
  });
  renderImagePreview();
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

async function convertFileToPngBlob(file) {
  if (file && file.type === 'image/png') return file;
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas context unavailable');
    ctx.drawImage(bitmap, 0, 0);
    if (typeof bitmap.close === 'function') bitmap.close();
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('Could not convert image to PNG'));
          return;
        }
        resolve(blob);
      }, 'image/png');
    });
  }

  const dataUrl = await fileToDataUrl(file);
  const img = await new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('Could not decode image'));
    el.src = dataUrl;
  });
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas context unavailable');
  ctx.drawImage(img, 0, 0);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Could not convert image to PNG'));
        return;
      }
      resolve(blob);
    }, 'image/png');
  });
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
      if ($('model')) $('model').value = model;
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
        setField('decodedModel', model);
        setField('decodedTrim', trim);
        setField('decodedBody', bodyClass);
        setField('decodedDrive', driveType);
        setField('decodedFuel', fuelType);
      }

      updateLivePreview();
      regenerateNewPhotoNames();

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
      regenerateNewPhotoNames();
      // Auto-upload to Cloudinary if configured
      if (getCloudinaryConfig()) {
        uploadPhotosToCloud();
      }
    });
  }

  // Recompute photo names if base fields change
  ['stockNumber','year','make','model','vin','exteriorColor'].forEach(id => {
    const el = $(id);
    if (!el) return;
    el.addEventListener('input', () => regenerateNewPhotoNames());
    el.addEventListener('change', () => regenerateNewPhotoNames());
  });

  const dlBtn = $('downloadPhotosBtn');
  if (dlBtn) {
    dlBtn.addEventListener('click', async () => {
      if (!NEW_IMAGE_FILES.length) {
        alert('Select photos first.');
        return;
      }

      const namedFiles = [];
      for (let i = 0; i < NEW_IMAGE_FILES.length; i++) {
        const file = NEW_IMAGE_FILES[i];
        const name = NEW_IMAGE_NAMES[i] || `photo-${i+1}.${PHOTO_OUTPUT_EXT}`;
        let blobToSave = file;
        try {
          blobToSave = await convertFileToPngBlob(file);
        } catch (err) {
          console.warn('PNG conversion failed; saving original file for index', i, err);
        }
        namedFiles.push({ name, blob: blobToSave });
      }

      // If supported, let user save directly into /assets/vehicles
      if (typeof window.showDirectoryPicker === 'function') {
        try {
          const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
          for (const f of namedFiles) {
            const fileHandle = await dirHandle.getFileHandle(f.name, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(f.blob);
            await writable.close();
          }
          alert(`Saved ${namedFiles.length} photo file(s). Select your /assets/vehicles folder when prompted so VDP and inventory image paths match.`);
          return;
        } catch (err) {
          if (err && err.name !== 'AbortError') {
            console.warn('Direct folder save failed, falling back to browser downloads:', err);
          } else {
            return;
          }
        }
      }

      // Fallback: browser downloads
      for (const f of namedFiles) {
        const url = URL.createObjectURL(f.blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = f.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      }

      alert('Downloaded photo files. Upload them into /assets/vehicles/ on your site.');
    });
  }

  const copyBtn = $('copyPhotoNamesBtn');
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      const names = uniqueKeepOrder([...(EXISTING_IMAGE_NAMES || []), ...(NEW_IMAGE_NAMES || [])]);
      if (!names.length) {
        alert('No photo filenames yet.');
        return;
      }
      try {
        await navigator.clipboard.writeText(names.join('\n'));
        alert('Copied photo filenames to clipboard.');
      } catch (e) {
        // Fallback
        const ta = document.createElement('textarea');
        ta.value = names.join('\n');
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        alert('Copied photo filenames to clipboard.');
      }
    });
  }
}

function renderImagePreview() {
  const preview = $('imagePreview');
  if (!preview) return;
  preview.innerHTML = '';

  const allExisting = Array.isArray(EXISTING_IMAGE_NAMES) ? EXISTING_IMAGE_NAMES : [];
  const allNew = Array.isArray(NEW_IMAGE_FILES) ? NEW_IMAGE_FILES : [];

  // Existing images (click X to remove)
  allExisting.forEach((name, idx) => {
    const wrap = document.createElement('div');
    wrap.className = 'img-wrap';

    const img = document.createElement('img');
    img.className = 'img-thumb';
    img.alt = `Existing photo ${idx + 1}`;
    img.src = String(name || '').startsWith('http') ? name : `assets/vehicles/${name}`;
    img.onerror = () => {
      img.style.objectFit = 'contain';
      img.style.padding = '18px';
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 16 16"><rect x="1" y="3" width="14" height="12" rx="1" fill="none" stroke="#adb5bd"/><circle cx="5.2" cy="14" r="1.2" fill="#adb5bd"/><circle cx="12.8" cy="14" r="1.2" fill="#adb5bd"/></svg>');
    };

    const label = document.createElement('div');
    label.className = 'img-label';
    label.textContent = name;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'img-remove';
    btn.setAttribute('aria-label', 'Remove photo');
    btn.innerHTML = '&times;';
    btn.addEventListener('click', () => {
      EXISTING_IMAGE_NAMES.splice(idx, 1);
      renderImagePreview();
    });

    wrap.appendChild(btn);
    wrap.appendChild(img);
    wrap.appendChild(label);
    preview.appendChild(wrap);
  });

  // New images (preview from file)
  allNew.forEach((file, idx) => {
    const wrap = document.createElement('div');
    wrap.className = 'img-wrap';

    const img = document.createElement('img');
    img.className = 'img-thumb';
    img.alt = `Selected photo ${idx + 1}`;

    const label = document.createElement('div');
    label.className = 'img-label';
    label.textContent = NEW_IMAGE_NAMES[idx] || file.name;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'img-remove';
    btn.setAttribute('aria-label', 'Remove photo');
    btn.innerHTML = '&times;';
    btn.addEventListener('click', () => {
      NEW_IMAGE_FILES.splice(idx, 1);
      NEW_IMAGE_NAMES.splice(idx, 1);
      // Clear input if empty
      if (!NEW_IMAGE_FILES.length) {
        const photos = $('photos');
        if (photos) photos.value = '';
      }
      renderImagePreview();
    });

    wrap.appendChild(btn);
    wrap.appendChild(img);
    wrap.appendChild(label);
    preview.appendChild(wrap);

    const reader = new FileReader();
    reader.onload = (ev) => { img.src = ev.target.result; };
    reader.readAsDataURL(file);
  });

  const list = $('photoNamesList');
  const hint = $('photoNamesHint');
  const allNames = uniqueKeepOrder([...(EXISTING_IMAGE_NAMES || []), ...(NEW_IMAGE_NAMES || [])]);
  if (hint) hint.textContent = allNames.length ? `${allNames.length} photo filename${allNames.length === 1 ? '' : 's'}` : '';
  if (list) list.textContent = allNames.length ? allNames.join('  •  ') : '';
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

  form.addEventListener('submit', function (e) {
    e.preventDefault();

    const g = (id) => { const el = $(id); return el ? el.value.trim() : ''; };

    const vin = g('vin').toUpperCase();
    if (vin && vin.length !== 17) {
      alert('VIN must be 17 characters.');
      return;
    }

    const vehicle = {
      vin:           vin,
      stockNumber:   g('stockNumber'),
      year:          g('year') ? parseInt(g('year'), 10) : null,
      make:          toTitleCase(g('make')),
      model:         g('model'),
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
      dateAdded:     new Date().toISOString()
    };

    // Auto-description if still empty
    if (!vehicle.description) {
      const parts = [];
      if (vehicle.drivetrain) parts.push(vehicle.drivetrain);
      if (vehicle.engine) parts.push(vehicle.engine);
      if (vehicle.mileage) parts.push(`${vehicle.mileage.toLocaleString()} miles`);
      vehicle.description = parts.join(', ');
    }

    // Images: if new photos selected, add them first (main photo = first selected)
    const combined = NEW_IMAGE_NAMES.length
      ? [...NEW_IMAGE_NAMES, ...EXISTING_IMAGE_NAMES]
      : [...EXISTING_IMAGE_NAMES];
    vehicle.images = uniqueKeepOrder(combined);

    const inv = readInventory();

    // Add vs edit
    const isEdit = EDIT_INDEX !== null && inv.vehicles[EDIT_INDEX];

    if (isEdit) {
      vehicle.dateAdded = EDIT_ORIGINAL_DATE || inv.vehicles[EDIT_INDEX].dateAdded || vehicle.dateAdded;
      inv.vehicles[EDIT_INDEX] = vehicle;
    } else {
      // basic dedupe warning
      const dup = inv.vehicles.find(v => (vehicle.vin && v.vin === vehicle.vin) || (vehicle.stockNumber && v.stockNumber === vehicle.stockNumber));
      if (dup) {
        const ok = confirm('A vehicle with the same VIN or Stock # already exists in your local inventory. Add anyway?');
        if (!ok) return;
      }
      inv.vehicles.push(vehicle);
    }

    writeInventory(inv);
    downloadInventoryJSON(inv);

    const action = isEdit ? 'updated' : 'added';
    alert(`✓ Vehicle ${action}!\n\n${vehicle.year || ''} ${vehicle.make || ''} ${vehicle.model || ''}`.trim() +
      `\n\ninventory.json has been downloaded.\n\nNEXT STEPS:\n1. Upload inventory.json to your server\n2. Upload any new photos into /assets/vehicles/\n3. Run: python3 generate_vdp_pages.py (if you need new/updated VDP pages)`);

    cancelEdit();
    loadInventoryTable();
    updateInventoryStatus();
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
  NEW_IMAGE_NAMES = [];

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
  set('description', v.description || '');
  set('features', Array.isArray(v.features) ? v.features.join(', ') : (v.features || ''));
  set('status', v.status || 'available');
  set('badge', v.badge || '');

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
  NEW_IMAGE_NAMES = [];

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

// ─── Settings (OpenAI + Cloudinary) ──────────────────────────────────────────
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

function setupCloudinarySettings() {
  const saveBtn   = $('saveCloudinaryBtn');
  const cloudEl   = $('cloudinaryCloud');
  const presetEl  = $('cloudinaryPreset');
  const statusEl  = $('cloudinaryStatus');
  if (!saveBtn || !cloudEl || !presetEl) return;

  // Load saved values
  cloudEl.value  = localStorage.getItem('bf_cloudinary_cloud')  || '';
  presetEl.value = localStorage.getItem('bf_cloudinary_preset') || '';
  if (cloudEl.value && presetEl.value && statusEl) {
    statusEl.textContent = '✓ Configured — photos will upload to cloud automatically';
    statusEl.className = 'small text-success ms-2';
  }

  saveBtn.addEventListener('click', () => {
    const cloud  = cloudEl.value.trim();
    const preset = presetEl.value.trim();
    if (cloud && preset) {
      localStorage.setItem('bf_cloudinary_cloud',  cloud);
      localStorage.setItem('bf_cloudinary_preset', preset);
      if (statusEl) {
        statusEl.textContent = '✓ Saved — photos will upload to cloud automatically';
        statusEl.className = 'small text-success ms-2';
      }
      updatePhotoUploadHint();
    } else {
      localStorage.removeItem('bf_cloudinary_cloud');
      localStorage.removeItem('bf_cloudinary_preset');
      if (statusEl) {
        statusEl.textContent = 'Cleared — photos will download locally';
        statusEl.className = 'small text-muted ms-2';
      }
      updatePhotoUploadHint();
    }
  });
}

function getCloudinaryConfig() {
  const cloud  = localStorage.getItem('bf_cloudinary_cloud')  || '';
  const preset = localStorage.getItem('bf_cloudinary_preset') || '';
  return (cloud && preset) ? { cloud, preset } : null;
}

function updatePhotoUploadHint() {
  const hint    = $('photoUploadHint');
  const dlBtn   = $('downloadPhotosBtn');
  const config  = getCloudinaryConfig();
  if (!hint) return;
  if (config) {
    hint.innerHTML = 'Select up to 10 photos. Names use <span class="mono">YEAR-EXTERIORCOLOR-MAKE-MODEL-STOCKNUMBER-01.png</span> (or <span class="mono">YEAR-MAKE-MODEL-STOCKNUMBER-01.png</span> if exterior color is blank).';
    if (dlBtn) dlBtn.style.display = 'none';
  } else {
    hint.innerHTML = 'Select up to 10 photos. First photo is the main image. Photos use <span class="mono">YEAR-EXTERIORCOLOR-MAKE-MODEL-STOCKNUMBER-01.png</span> (or <span class="mono">YEAR-MAKE-MODEL-STOCKNUMBER-01.png</span> when exterior color is blank).';
    if (dlBtn) dlBtn.style.display = '';
  }
}

// ─── Cloudinary Upload ────────────────────────────────────────────────────────
// Uploads a single File to Cloudinary; returns the secure URL.
async function uploadToCloudinary(file, publicId, config) {
  const fd = new FormData();
  const pngBlob = await convertFileToPngBlob(file);
  fd.append('file', pngBlob, `${publicId}.${PHOTO_OUTPUT_EXT}`);
  fd.append('upload_preset', config.preset);
  fd.append('public_id', publicId);
  fd.append('format', PHOTO_OUTPUT_EXT);

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${config.cloud}/image/upload`,
    { method: 'POST', body: fd }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Cloudinary error ${res.status}`);
  }
  const data = await res.json();
  return data.secure_url;
}

// Upload all selected photos to Cloudinary; updates NEW_IMAGE_NAMES with URLs.
async function uploadPhotosToCloud() {
  const config = getCloudinaryConfig();
  if (!config || !NEW_IMAGE_FILES.length) return;

  const statusEl = $('cloudUploadStatus');
  if (statusEl) {
    statusEl.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span><small class="text-muted">Uploading photos to cloud…</small>';
  }

  const urls = [];
  for (let i = 0; i < NEW_IMAGE_FILES.length; i++) {
    const file = NEW_IMAGE_FILES[i];
    const base = getPhotoBaseId();
    const num  = String(i + 1).padStart(2, '0');
    const publicId = `vehicles/${base}-${num}`;
    try {
      const url = await uploadToCloudinary(file, publicId, config);
      urls.push(url);
      if (statusEl) {
        statusEl.innerHTML = `<small class="text-success">✓ Uploaded ${i + 1} of ${NEW_IMAGE_FILES.length}</small>`;
      }
    } catch (err) {
      console.error('Upload failed for photo', i + 1, err);
      if (statusEl) {
        statusEl.innerHTML = `<small class="text-danger">✗ Upload failed for photo ${i + 1}: ${err.message}</small>`;
      }
      return; // Stop on error
    }
  }

  // Replace generated names with cloud URLs
  NEW_IMAGE_NAMES = urls;
  renderImagePreview();

  if (statusEl) {
    statusEl.innerHTML = `<small class="text-success fw-bold">✓ All ${urls.length} photo${urls.length !== 1 ? 's' : ''} uploaded to cloud</small>`;
  }
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

  const prompt = `Write a short, compelling used car dealer description (2-4 sentences) for this vehicle listing. Be professional, highlight key selling points, and make it appealing to buyers. Do not use excessive exclamation marks. Do not invent features not listed. Return only the description text.

Vehicle Details:
${detailLines}`;

  // Build message content — include first photo if available
  const content = [];
  const photoFile = NEW_IMAGE_FILES.length ? NEW_IMAGE_FILES[0] : null;
  if (photoFile) {
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
        max_tokens: 300,
        messages: [{ role: 'user', content }],
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `API error ${res.status}`);
    }

    const result = await res.json();
    const text = result.choices?.[0]?.message?.content || '';
    if (text && descField) {
      descField.value = text.trim();
      updateLivePreview();
    }
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
