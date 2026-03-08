# Sold Vehicle Workflow — Design Document

**Date**: 2026-03-08
**Status**: Approved

## Overview

Add a "Mark Sold" workflow to the Bells Fork admin dashboard. When a vehicle is marked sold from Inventory, the user fills in sale details (price, date, lead source, salesperson, buyer), the vehicle is removed from active inventory and the public site, and a durable sales record is created in Netlify Blobs for reporting.

## Architecture: Inventory-Centric (Approach A)

The vehicle record in the existing `inventory[]` array remains the source of truth. When sold, extra fields are merged onto the vehicle object. The vehicle stays in `inventory[]` with `status: 'sold'` but is filtered from active views and excluded from the publish pipeline. A copy is written to Netlify Blobs for durable storage and historical reporting.

## Files Changed

| File | Type | Purpose |
|------|------|---------|
| `admin-dashboard.html` | Patch | Sold modal HTML, "Mark Sold" button in inventory table, enhanced Sales tab (lead reporting filters, expanded table columns) |
| `assets/js/dashboard.js` | Patch | Sold modal logic, lead types list, validation, blob read/write, publish filter, sales reporting with filters, rollback |
| `assets/css/dashboard.css` | Patch | Sold modal styles, reporting layout |
| `netlify/functions/sales-data.js` | New | Netlify Function — GET reads sales records from blob, POST upserts a record |

## Data Model

### Vehicle Object Extension (on sold)

Added fields when vehicle is marked sold:

```
soldDate         — "2026-03-08" (ISO date)
salePrice        — 45000 (number)
leadType         — "Walk-In" (normalized from LEAD_TYPES)
leadSourceDetail — "" (required only when leadType === "Other")
salesperson      — "Frank" (string)
buyerName        — "John Smith" (string)
soldNotes        — "" (string)
soldAt           — "2026-03-08T14:30:00.000Z" (ISO timestamp, auto-set)
updatedAt        — "2026-03-08T14:30:00.000Z" (ISO timestamp, auto-set)
```

### Netlify Blob Sales Record

Blob store key: `sales-records`
Format: JSON array of sale objects.

Each record contains:

- Identity: vehicleId (sku), vin, stockNumber
- Vehicle: year, make, model, trim, mileage, exteriorColor, interiorColor, transmission, engine, fuelType, category
- Pricing: originalAskingPrice, salePrice, soldDate, status
- Lead: leadType, leadSourceDetail
- People: salesperson, buyerName
- Audit: inventoryCreatedAt, soldAt, createdAt, updatedAt, sourceRecordId
- Notes: soldNotes

### Lead Type Options

Website, Call from Website, Email from Website, Text from Website, Form from Website, Phone Inquiry, Personal, Walk-In, Referral, Repeat Customer, Facebook, Instagram, Google Business Profile, Marketplace / Classifieds, Third-Party Listing Site, Dealer Referral, Employee Referral, Other

When "Other" is selected, `leadSourceDetail` is required.

## Data Flow

```
1. User clicks "Mark Sold" on inventory row
2. Sold modal opens, pre-filled with vehicle data
3. User fills: soldDate, salePrice, leadType, salesperson, buyerName, notes
4. User clicks "Complete Sale"
5. Client-side validation
6. Build normalized sold payload
7. POST to /.netlify/functions/sales-data (upsert blob record)
8. If blob write succeeds:
   a. Update vehicle in inventory[] with sold fields + status='sold'
   b. persistInventory()
   c. autoPublish() — excludes sold vehicles
   d. Refresh Sales tab
   e. Close modal, show success toast
9. If any step fails:
   a. Rollback inventory[] to pre-sold state
   b. Keep modal open with user data
   c. Show error message
```

## Publish Pipeline Change

`autoPublish()` will filter sold vehicles:
```js
var vehicles = inventory.filter(v => v.status !== 'sold').map(...)
```

Sold vehicles will no longer appear on the public site.

## Sales Tab Enhancement

### Data Source Change

Replace hardcoded sample arrays with:
- Local: `inventory.filter(v => v.status === 'sold')` for immediate/recent
- Remote: GET `/.netlify/functions/sales-data` for full history

### Enhanced Recent Sales Table

Columns: Year/Make/Model, Stock #, Sale Price, Sold Date, Salesperson, Lead Type, Buyer

### Reporting Filters

- Date range: Today / 7d / 30d / This Month / All Time
- Lead Type dropdown
- Salesperson dropdown

### KPIs (computed from filtered data)

- Total Sales (sum of salePrice)
- Avg Price
- Units Sold

### Charts

- Sales Over Time: bar+line chart by month from sold records
- Sales by Lead Type: doughnut chart grouped by leadType
- Sales by Vehicle Type: doughnut chart grouped by category (existing)

## Sold Modal

### Fields

| Field | Type | Required | Default |
|-------|------|----------|---------|
| Sold Date | date | Yes | Today |
| Sale Price | number | Yes | Asking price |
| Lead Type | select | Yes | — |
| Lead Source Detail | text | If Other | — |
| Salesperson | text | Yes | — |
| Buyer Name | text | No | — |
| Notes | textarea | No | — |

### Modal States

1. Initial load — pre-fill known values
2. Missing lead source — require selection
3. Lead source exists — show prefilled, allow edit
4. Validation error — inline errors
5. Saving — spinner, disabled controls
6. Success — close modal, toast
7. Failure — keep modal open, rollback, error message

### Validation

- soldDate: required, valid date
- salePrice: required, numeric, non-negative
- leadType: required
- leadSourceDetail: required if leadType === "Other"
- salesperson: required

## Rollback Strategy

Defensive ordering: blob write first, then local state update.

If blob write fails → no local changes made → modal stays open.
If local update fails after blob write → revert inventory[] from snapshot taken before modification → show error.

Helper functions:
- `prepareSoldPayload(vehicle, formData)` — builds normalized record
- `writeSalesBlob(payload)` — POST to Netlify Function
- `applySoldToInventory(vehicleIndex, soldFields)` — mutates inventory[]
- `rollbackInventory(snapshot)` — restores pre-sold state
- `refreshSalesViews()` — re-renders Sales tab

## Edit Sold Record (v1)

v1 supports clicking "Mark Sold" on an already-sold vehicle to edit its sale metadata. The modal re-opens with saved values. On save, the blob record is upserted (matched by vehicleId/sku).

## Acceptance Criteria

- [x] "Mark Sold" button on each inventory row (disabled if already sold)
- [x] Sold modal with all required fields and validation
- [x] Lead source required before save; prefilled if exists
- [x] Sold vehicle filtered from active inventory
- [x] Sold vehicle excluded from publish pipeline
- [x] Sales record written to Netlify Blobs
- [x] Sales tab shows real sold data (not sample data)
- [x] Reporting filterable by lead type, date range, salesperson
- [x] No duplicate records on repeat action
- [x] Rollback on failure — no half-sold state
- [x] Existing dashboard styling and structure preserved
