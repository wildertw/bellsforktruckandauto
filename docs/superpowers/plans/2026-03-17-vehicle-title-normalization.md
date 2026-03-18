# Vehicle Title Normalization Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Normalize vehicle make/model fields to proper title case with automotive-aware abbreviation handling across all data entry and display paths.

**Architecture:** A single `normalizeVehicleText(str)` function handles all casing normalization with an uppercase exceptions set for automotive abbreviations (BMW, GMC, RAM, etc.) and correct hyphenation (Mercedes-Benz, F-150). The function is defined in `build-utils.js` for Node.js build scripts and inlined in browser scripts that lack a module system. Applied at save-time (data entry boundaries) and display-time (legacy data safety net).

**Tech Stack:** Vanilla JavaScript (no dependencies). Node.js for build scripts and serverless functions. Browser JS for admin dashboard.

**Spec:** `docs/superpowers/specs/2026-03-17-vehicle-title-normalization-design.md`

---

## Chunk 1: Core Function + Build Pipeline

### Task 1: Add `normalizeVehicleText` to `build-utils.js`

**Files:**
- Modify: `build-utils.js:47-52` (replace `titleCase`)
- Modify: `build-utils.js:236` (update exports)

- [ ] **Step 1: Write the `normalizeVehicleText` function**

Replace the existing `titleCase` function at `build-utils.js:47-52` with:

```javascript
const UPPER_WORDS = new Set([
  'BMW', 'GMC', 'RAM', 'AMG', 'GT', 'SRT', 'TRD',
  'XLE', 'XSE', 'SE', 'LE', 'LT', 'LTZ', 'AWD', 'FWD', 'RWD', 'SUV',
]);

function normalizeVehicleText(str) {
  const s = String(str == null ? '' : str).trim().replace(/\s+/g, ' ');
  if (!s) return '';
  return s.toLowerCase().split(' ').filter(Boolean).map(function (word) {
    // Check uppercase exception (ignore hyphens for matching)
    var bare = word.replace(/-/g, '').toUpperCase();
    if (UPPER_WORDS.has(bare)) return bare;
    // Capitalize each hyphen-segment
    return word.split('-').map(function (seg) {
      if (!seg) return seg;
      return seg.charAt(0).toUpperCase() + seg.slice(1);
    }).join('-');
  }).join(' ');
}

// Keep backward-compatible alias
var titleCase = normalizeVehicleText;

function normalizeVehicleTitle(v) {
  var parts = [v.year, normalizeVehicleText(v.make), normalizeVehicleText(v.model)];
  return parts.filter(Boolean).join(' ').trim();
}
```

- [ ] **Step 2: Update the `module.exports` at `build-utils.js:231-241`**

Add `normalizeVehicleText` and `normalizeVehicleTitle` to exports. Keep `titleCase` as alias:

In the existing exports object, after `escapeHtml, escapeAttr, titleCase, formatMoney, slugify,` — add `normalizeVehicleText, normalizeVehicleTitle,` so it becomes:

```javascript
  escapeHtml, escapeAttr, titleCase, normalizeVehicleText, normalizeVehicleTitle, formatMoney, slugify,
```

- [ ] **Step 3: Verify the build pipeline still works**

Run: `node -e "const b = require('./build-utils'); console.log(b.normalizeVehicleText('CHEVROLET'), b.normalizeVehicleText('bmw'), b.normalizeVehicleText('mercedes-benz'), b.normalizeVehicleText('f-150'), b.normalizeVehicleText('suv'), b.normalizeVehicleText(null), b.normalizeVehicleText('2500 srt'))"`

Expected output: `Chevrolet BMW Mercedes-Benz F-150 SUV  2500 SRT`

- [ ] **Step 4: Run full build to confirm nothing breaks**

Run: `npm run build`

Expected: Build completes without errors. The existing `titleCase` alias means `generate-vdp.js`, `prerender-homepage.js`, `prerender-inventory.js`, and `generate-category-pages.js` all automatically pick up the upgraded logic.

- [ ] **Step 5: Commit**

```bash
git add build-utils.js
git commit -m "feat: add normalizeVehicleText to build-utils with automotive-aware title casing"
```

---

### Task 2: Update `inventory-loader.js` (browser-side display)

**Files:**
- Modify: `inventory-loader.js:80-88` (replace `titleCase` method)

- [ ] **Step 1: Replace the `titleCase` class method**

At `inventory-loader.js:80-88`, replace the existing `titleCase(s)` method with:

```javascript
  titleCase(s) {
    var UPPER_WORDS = new Set([
      'BMW', 'GMC', 'RAM', 'AMG', 'GT', 'SRT', 'TRD',
      'XLE', 'XSE', 'SE', 'LE', 'LT', 'LTZ', 'AWD', 'FWD', 'RWD', 'SUV',
    ]);
    var str = String(s == null ? '' : s).trim().replace(/\s+/g, ' ');
    if (!str) return '';
    return str.toLowerCase().split(' ').filter(Boolean).map(function (word) {
      var bare = word.replace(/-/g, '').toUpperCase();
      if (UPPER_WORDS.has(bare)) return bare;
      return word.split('-').map(function (seg) {
        if (!seg) return seg;
        return seg.charAt(0).toUpperCase() + seg.slice(1);
      }).join('-');
    }).join(' ');
  }
```

- [ ] **Step 2: Rebuild the bundled version**

Run: `npm run build:js`

Expected: Completes without errors. `assets/js/dist/inventory-loader.js` is regenerated.

- [ ] **Step 3: Commit**

```bash
git add inventory-loader.js assets/js/dist/inventory-loader.js
git commit -m "feat: upgrade inventory-loader titleCase to automotive-aware normalization"
```

---

## Chunk 2: Save-Time Normalization (Admin Paths)

### Task 3: Update `vehicle-manager.js` (admin form save)

**Files:**
- Modify: `vehicle-manager.js:72-82` (replace `toTitleCase` function)
- Modify: `vehicle-manager.js:825-826` (already calls `toTitleCase` — no change needed if function is replaced in-place)

- [ ] **Step 1: Replace the `toTitleCase` function**

At `vehicle-manager.js:72-82`, replace the entire `toTitleCase` function and its comment with:

```javascript
// Automotive-aware title case normalization
var VM_UPPER_WORDS = new Set([
  'BMW', 'GMC', 'RAM', 'AMG', 'GT', 'SRT', 'TRD',
  'XLE', 'XSE', 'SE', 'LE', 'LT', 'LTZ', 'AWD', 'FWD', 'RWD', 'SUV',
]);
function toTitleCase(str) {
  var s = String(str == null ? '' : str).trim().replace(/\s+/g, ' ');
  if (!s) return '';
  return s.toLowerCase().split(' ').filter(Boolean).map(function (word) {
    var bare = word.replace(/-/g, '').toUpperCase();
    if (VM_UPPER_WORDS.has(bare)) return bare;
    return word.split('-').map(function (seg) {
      if (!seg) return seg;
      return seg.charAt(0).toUpperCase() + seg.slice(1);
    }).join('-');
  }).join(' ');
}
```

Note: Keeping the function name `toTitleCase` so the existing call sites at lines 825-826 (`toTitleCase(g('make'))` and `toTitleCase(g('model'))`) continue to work without changes.

- [ ] **Step 2: Rebuild**

Run: `npm run build:js`

Expected: Completes without errors.

- [ ] **Step 3: Commit**

```bash
git add vehicle-manager.js assets/js/dist/vehicle-manager.js
git commit -m "feat: upgrade vehicle-manager toTitleCase to automotive-aware normalization"
```

---

### Task 4: Update `assets/js/dashboard.js` (admin dashboard save + display)

**Files:**
- Modify: `assets/js/dashboard.js` — add function near top, patch 6 save-time paths and 5 display-time paths

- [ ] **Step 1: Add the normalization function near the top of dashboard.js**

Find the first blank line after the initial variable declarations (look for the pattern after `var inventory = [];` or similar early declarations). Add:

```javascript
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
```

- [ ] **Step 2: Patch save-time entry points**

**Edit-save** at `dashboard.js:1978-1979` — change from:

```javascript
      editingItem.make = $('editMake').value.trim() || editingItem.make;
      editingItem.model = $('editModel').value.trim() || editingItem.model;
```

To:

```javascript
      editingItem.make = normalizeVehicleText($('editMake').value) || editingItem.make;
      editingItem.model = normalizeVehicleText($('editModel').value) || editingItem.model;
```

**Add-vehicle form** at `dashboard.js:2302-2303` — change from:

```javascript
      make: $('addMake').value.trim(),
      model: $('addModel').value.trim(),
```

To:

```javascript
      make: normalizeVehicleText($('addMake').value),
      model: normalizeVehicleText($('addModel').value),
```

**VIN decode auto-populate** at `dashboard.js:2444-2445` — change from:

```javascript
    if (vinDecodeData.make) $('addMake').value = vinDecodeData.make;
    if (vinDecodeData.model) $('addModel').value = vinDecodeData.model;
```

To:

```javascript
    if (vinDecodeData.make) $('addMake').value = normalizeVehicleText(vinDecodeData.make);
    if (vinDecodeData.model) $('addModel').value = normalizeVehicleText(vinDecodeData.model);
```

**CSV import merge** at `dashboard.js:3102-3103` — change from:

```javascript
          if (clean(r.Make)) merged.make = clean(r.Make);
          if (clean(r.Model)) merged.model = clean(r.Model);
```

To:

```javascript
          if (clean(r.Make)) merged.make = normalizeVehicleText(clean(r.Make));
          if (clean(r.Model)) merged.model = normalizeVehicleText(clean(r.Model));
```

**AI vision auto-fill (edit)** at `dashboard.js:3414-3415` — change from:

```javascript
    if (analysis.make && !$('editMake').value) $('editMake').value = analysis.make;
    if (analysis.model && !$('editModel').value) $('editModel').value = analysis.model;
```

To:

```javascript
    if (analysis.make && !$('editMake').value) $('editMake').value = normalizeVehicleText(analysis.make);
    if (analysis.model && !$('editModel').value) $('editModel').value = normalizeVehicleText(analysis.model);
```

**AI vision auto-fill (add)** at `dashboard.js:3461-3462` — change from:

```javascript
    if (analysis.make && !$('addMake').value) $('addMake').value = analysis.make;
    if (analysis.model && !$('addModel').value) $('addModel').value = analysis.model;
```

To:

```javascript
    if (analysis.make && !$('addMake').value) $('addMake').value = normalizeVehicleText(analysis.make);
    if (analysis.model && !$('addModel').value) $('addModel').value = normalizeVehicleText(analysis.model);
```

- [ ] **Step 3: Patch display-time title construction**

**Latest inventory display** at `dashboard.js:1474` — change from:

```javascript
      var modelLabel = [latest.year, latest.make, latest.model, latest.trim].filter(Boolean).join(' ') || latest.name || 'Unknown';
```

To:

```javascript
      var modelLabel = [latest.year, normalizeVehicleText(latest.make), normalizeVehicleText(latest.model), latest.trim].filter(Boolean).join(' ') || latest.name || 'Unknown';
```

**Inventory load mapping** at `dashboard.js:1915` — change from:

```javascript
            name: [v.year, v.make, v.model].filter(Boolean).join(' ') || 'Vehicle',
```

To:

```javascript
            name: [v.year, normalizeVehicleText(v.make), normalizeVehicleText(v.model)].filter(Boolean).join(' ') || 'Vehicle',
```

**Staged inventory mapping** at `dashboard.js:2068` — change from:

```javascript
          name: [v.year, v.make, v.model].filter(Boolean).join(' ') || 'Vehicle',
```

To:

```javascript
          name: [v.year, normalizeVehicleText(v.make), normalizeVehicleText(v.model)].filter(Boolean).join(' ') || 'Vehicle',
```

**Published inventory mapping** at `dashboard.js:2107` — change from:

```javascript
          name: v.name || [v.year, v.make, v.model].filter(Boolean).join(' ') || 'Vehicle',
```

To:

```javascript
          name: v.name || [v.year, normalizeVehicleText(v.make), normalizeVehicleText(v.model)].filter(Boolean).join(' ') || 'Vehicle',
```

**Auto-name from VIN decode** at `dashboard.js:2471` — change from:

```javascript
    const autoName = [vinDecodeData.year, vinDecodeData.make, vinDecodeData.model].filter(Boolean).join(' ');
```

To:

```javascript
    const autoName = [vinDecodeData.year, normalizeVehicleText(vinDecodeData.make), normalizeVehicleText(vinDecodeData.model)].filter(Boolean).join(' ');
```

- [ ] **Step 4: Commit**

```bash
git add assets/js/dashboard.js
git commit -m "feat: add automotive-aware title normalization to admin dashboard"
```

---

## Chunk 3: Serverless + Import Script

### Task 5: Update `netlify/functions/inventory-stage.js`

**Files:**
- Modify: `netlify/functions/inventory-stage.js` — add function, normalize after validation

- [ ] **Step 1: Add `normalizeVehicleText` to `inventory-stage.js`**

Add the function near the top of the file, after the imports and before the handler:

```javascript
// Automotive-aware title case normalization
var UPPER_WORDS = new Set([
  'BMW', 'GMC', 'RAM', 'AMG', 'GT', 'SRT', 'TRD',
  'XLE', 'XSE', 'SE', 'LE', 'LT', 'LTZ', 'AWD', 'FWD', 'RWD', 'SUV',
]);
function normalizeVehicleText(str) {
  var s = String(str == null ? '' : str).trim().replace(/\s+/g, ' ');
  if (!s) return '';
  return s.toLowerCase().split(' ').filter(Boolean).map(function (word) {
    var bare = word.replace(/-/g, '').toUpperCase();
    if (UPPER_WORDS.has(bare)) return bare;
    return word.split('-').map(function (seg) {
      if (!seg) return seg;
      return seg.charAt(0).toUpperCase() + seg.slice(1);
    }).join('-');
  }).join(' ');
}
```

- [ ] **Step 2: Add normalization pass after validation succeeds**

At `inventory-stage.js`, immediately after the validation error check block (after line 149 — the closing brace of the `if (validationErrors.length > 0)` block), add:

```javascript
  // Normalize make/model casing
  inventory.vehicles.forEach(function (v) {
    if (v.make) v.make = normalizeVehicleText(v.make);
    if (v.model) v.model = normalizeVehicleText(v.model);
  });
```

- [ ] **Step 3: Commit**

```bash
git add netlify/functions/inventory-stage.js
git commit -m "feat: normalize vehicle make/model casing in inventory-stage serverless function"
```

---

### Task 6: Update `import-scraped-inventory.js`

**Files:**
- Modify: `import-scraped-inventory.js:127-131` (replace `toTitleCase`)
- Modify: `import-scraped-inventory.js:110-111` (normalize model too)
- Modify: `import-scraped-inventory.js:150` (parseTitle uses toTitleCase)

- [ ] **Step 1: Replace the `toTitleCase` function**

At `import-scraped-inventory.js:127-131`, replace:

```javascript
function toTitleCase(s) {
  if (!s) return '';
  return s.toLowerCase().split(' ').filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}
```

With:

```javascript
const UPPER_WORDS = new Set([
  'BMW', 'GMC', 'RAM', 'AMG', 'GT', 'SRT', 'TRD',
  'XLE', 'XSE', 'SE', 'LE', 'LT', 'LTZ', 'AWD', 'FWD', 'RWD', 'SUV',
]);
function toTitleCase(str) {
  const s = String(str == null ? '' : str).trim().replace(/\s+/g, ' ');
  if (!s) return '';
  return s.toLowerCase().split(' ').filter(Boolean).map(word => {
    const bare = word.replace(/-/g, '').toUpperCase();
    if (UPPER_WORDS.has(bare)) return bare;
    return word.split('-').map(seg => {
      if (!seg) return seg;
      return seg.charAt(0).toUpperCase() + seg.slice(1);
    }).join('-');
  }).join(' ');
}
```

- [ ] **Step 2: Add model normalization at line 111**

At `import-scraped-inventory.js:111`, change from:

```javascript
      model: get('Model'),
```

To:

```javascript
      model: toTitleCase(get('Model')),
```

- [ ] **Step 3: Verify parseTitle still works**

Line 150 already calls `toTitleCase(make)`, so it inherits the upgrade. No change needed.

- [ ] **Step 4: Commit**

```bash
git add import-scraped-inventory.js
git commit -m "feat: upgrade import script title casing and add model normalization"
```

---

## Chunk 4: Verification

### Task 7: End-to-end verification

- [ ] **Step 1: Run full build**

Run: `npm run build`

Expected: Completes without errors.

- [ ] **Step 2: Verify normalization in built VDP pages**

Run: `node -e "const b = require('./build-utils'); const v = {year: 2015, make: 'CHEVROLET', model: 'silverado'}; console.log(b.normalizeVehicleTitle(v));"`

Expected output: `2015 Chevrolet Silverado`

Run: `node -e "const b = require('./build-utils'); const v = {year: 2020, make: 'bmw', model: 'x5'}; console.log(b.normalizeVehicleTitle(v));"`

Expected output: `2020 BMW X5`

Run: `node -e "const b = require('./build-utils'); const v = {year: 2018, make: 'FORD', model: 'f-150'}; console.log(b.normalizeVehicleTitle(v));"`

Expected output: `2018 Ford F-150`

Run: `node -e "const b = require('./build-utils'); const v = {year: 2021, make: 'MERCEDES-BENZ', model: 'sprinter'}; console.log(b.normalizeVehicleTitle(v));"`

Expected output: `2021 Mercedes-Benz Sprinter`

- [ ] **Step 3: Spot-check a generated VDP page**

Run: `grep -i "vdp-vehicle-title" vdp/*/index.html | head -3`

Expected: Title elements should show properly cased make/model values (e.g., `Chevrolet Silverado` not `CHEVROLET Silverado`).

- [ ] **Step 4: Verify idempotency**

Run: `node -e "const n = require('./build-utils').normalizeVehicleText; const tests = ['CHEVROLET', 'bmw', 'f-150', 'Mercedes-Benz', 'suv', null, '']; tests.forEach(t => { const r = n(t); console.log(n(r) === r ? 'PASS' : 'FAIL', JSON.stringify(t), '=>', JSON.stringify(r)); });"`

Expected: All lines show `PASS`.

- [ ] **Step 5: Final commit with all build artifacts**

```bash
git add -A
git commit -m "feat: complete vehicle title normalization across all paths

Replaces three inconsistent titleCase implementations with a single
automotive-aware normalizeVehicleText function. Handles abbreviations
(BMW, GMC, RAM, SUV) and hyphenated names (Mercedes-Benz, F-150).

Applied at save-time in:
- vehicle-manager.js (admin form)
- dashboard.js (edit, add, VIN decode, CSV import, AI vision)
- inventory-stage.js (serverless validation)
- import-scraped-inventory.js (bulk import)

Applied at display-time in:
- build-utils.js (VDP generation, prerender, category pages)
- inventory-loader.js (frontend inventory display)
- dashboard.js (title construction for display)"
```
