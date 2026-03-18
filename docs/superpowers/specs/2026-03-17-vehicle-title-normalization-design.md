# Vehicle Title Normalization Design

**Date:** 2026-03-17
**Status:** Proposed

## Problem

Vehicle titles display inconsistently due to three separate `titleCase` implementations with different behaviors, and no normalization at data entry boundaries. Examples of bad output: `2015 CHEVROLET Silverado`, `2015 chevrolet silverado`, `2015 Chevrolet silverado`.

**Goal:** All vehicle titles display as `2015 Chevrolet Silverado` — proper title case with automotive-aware handling of abbreviations and hyphenated names.

## Solution

A single `normalizeVehicleText(str)` function applied at both save-time (clean data at rest) and display-time (safety net for legacy data).

### Normalization Function

**Algorithm:**
1. Trim and collapse whitespace
2. Lowercase the entire string
3. Split on spaces, process each word:
   a. Split on hyphens, capitalize first letter of each hyphen-segment, rejoin
   b. If the uppercased whole word (hyphens removed) matches the exceptions set, use the uppercase form
   c. Single-letter prefix before hyphen stays uppercase (e.g., `F-150`)
4. Rejoin with spaces

**The function is idempotent:** `normalizeVehicleText(normalizeVehicleText(x)) === normalizeVehicleText(x)`. This is important because it is applied at both save-time and display-time.

**Uppercase exceptions set (single-word tokens only):**
```
BMW, GMC, RAM, AMG, GT, SRT, TRD, XLE, XSE, SE, LE, LT, LTZ, AWD, FWD, RWD, SUV
```
Multi-word exceptions (e.g., "Grand Cherokee") are not supported by this mechanism and would require a different approach if ever needed.

**Companion function:** `normalizeVehicleTitle(vehicle)` takes a vehicle object, applies `normalizeVehicleText()` to `make` and `model` separately, returns `"${year} ${make} ${model}"`.

### Test Cases

| Input | Output |
|-------|--------|
| `null` | `""` |
| `undefined` | `""` |
| `""` | `""` |
| `"  "` | `""` |
| `CHEVROLET` | `Chevrolet` |
| `chevrolet` | `Chevrolet` |
| `bmw` | `BMW` |
| `gmc` | `GMC` |
| `ram` | `RAM` |
| `gt` | `GT` |
| `suv` | `SUV` |
| `mercedes-benz` | `Mercedes-Benz` |
| `MERCEDES-BENZ` | `Mercedes-Benz` |
| `f-150` | `F-150` |
| `F-150` | `F-150` |
| `range rover` | `Range Rover` |
| `1500` | `1500` |
| `2500 srt` | `2500 SRT` |
| `silverado` | `Silverado` |
| `SILVERADO` | `Silverado` |
| `land rover` | `Land Rover` |
| `sprinter` | `Sprinter` |
| `1500 classic` | `1500 Classic` |

## Files Changed

### Save-time normalization (data entry boundaries)

| File | Change |
|------|--------|
| `vehicle-manager.js` | Replace `toTitleCase()` with inline `normalizeVehicleText()`. Apply to make/model on form save. Remove old `toTitleCase` function. **Note:** the existing `toTitleCase` is "conservative" (only normalizes ALL-CAPS). The new function always normalizes — this is an intentional behavioral upgrade. |
| `netlify/functions/inventory-stage.js` | Add inline `normalizeVehicleText()`. Normalize `make` and `model` after validation, before storing to Blobs. |
| `import-scraped-inventory.js` | Replace `toTitleCase()` with `normalizeVehicleText()` in both `parseTitle()` and the CSV field mapping. **Note:** the existing code only normalizes `make` — `model` passes through raw. The fix must add normalization to `model` as well. |
| `assets/js/dashboard.js` | Normalize make/model at all data entry points: edit-save (~line 1978-1979), add-vehicle form (~line 2302-2303), VIN decode auto-populate (~line 2444-2445), CSV import merge (~line 3102-3103), and AI vision auto-fill (~line 3414-3415, 3461-3462). Add inline `normalizeVehicleText()`. |

### Display-time normalization (safety net for legacy data)

| File | Change |
|------|--------|
| `build-utils.js` | Replace `titleCase()` with `normalizeVehicleText()` and add `normalizeVehicleTitle()`. Export both. **Note:** since `titleCase` is also called on `v.type` in some consumers, `SUV` type values will now correctly uppercase — this is a beneficial side effect. |
| `generate-vdp.js` | Imports `titleCase` from `build-utils.js` — inherits the upgrade automatically. Verify `vehicleTitle()` function uses it correctly. |
| `prerender-homepage.js` | Imports `titleCase` from `build-utils.js` — inherits the upgrade automatically. Uses it on make, model, and type fields (lines 36, 86, 88, 89). |
| `prerender-inventory.js` | Imports `titleCase` from `build-utils.js` — inherits the upgrade automatically (line 9). |
| `generate-category-pages.js` | Imports `titleCase` from `build-utils.js` — inherits the upgrade automatically (line 305). |
| `inventory-loader.js` | Replace class method `titleCase()` with `normalizeVehicleText()` logic. |
| `assets/js/dist/inventory-loader.js` | Auto-generated build artifact from `inventory-loader.js`. Covered by rebuild — no manual changes needed. |
| `assets/js/dashboard.js` | Apply normalization to make/model where display titles are constructed (~lines 1474, 1915, 2068, 2107, 2471). |

### Files NOT changed

Photo upload, OEM detection, AI describe, auth functions, color lookup — none touch make/model text.

## Implementation Constraints

- **No shared module system for browser scripts.** `vehicle-manager.js`, `inventory-loader.js`, `dashboard.js` are standalone browser scripts. The normalization function is defined inline in each, matching existing codebase patterns.
- **Serverless function isolation.** `inventory-stage.js` runs in Netlify Functions (Node.js) but doesn't import `build-utils.js`. Function gets its own inline copy.
- **`build-utils.js`** is the canonical Node.js version, used by `generate-vdp.js`, `prerender-homepage.js`, `prerender-inventory.js`, `generate-category-pages.js`, and the build pipeline.
- **No retroactive rewrite** of `inventory.json`. Existing data gets normalized at display time and cleaned on next edit/save.
- **No changes** to field names, data types, API contracts, VIN, price, mileage, stock number, or any non-text vehicle fields.

## Scope Boundaries

- Only `make` and `model` fields are normalized. `trim` could benefit but is out of scope for this change.
- The `type` field also passes through `titleCase` in some build scripts — the upgrade to `normalizeVehicleText` will improve `type` normalization as a side effect (e.g., `"suv"` → `"SUV"`).
- The uppercase exceptions list is intentionally small, conservative, and single-word only. It can be extended later.
- Year is always numeric — passed through unchanged.
