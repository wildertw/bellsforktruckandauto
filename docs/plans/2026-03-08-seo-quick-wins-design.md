# SEO Quick Wins Design — 2026-03-08

## Context
Full SEO/GEO/AEO audit completed. Site is preparing to go live at bellsforkautoandtruck.com (custom domain pending DNS switch in 1-3 days). Canonical tags already point to the correct future domain.

## Scope: Quick Wins Only
Code-level fixes that can be done in a single pass. No content rewrites (About page, blog posts) or new landing pages in this phase.

## Changes

### 1. Fix Broken Homepage Internal Links
- **Files:** `index.html`
- **Change:** Replace all `inventory.html?` with `/inventory?` (~25 links in Popular Body Styles, Makes, Models sections)

### 2. Fix Geo-Coordinates
- **Files:** All HTML pages, `generate-vdp.js`
- **Change:** `35.6123` → `35.5641462`, `-77.3712` → `-77.349267`
- **Includes:** JSON-LD schema `geo` objects and `<meta name="geo.position">` / `<meta name="ICBM">` tags

### 3. Remove Fake AggregateRating Schema
- **Files:** `index.html`
- **Change:** Remove `AggregateRating` node from `@graph` in homepage JSON-LD. Keep visible review testimonials.

### 4. Fix Instagram Social Link
- **Files:** All pages with header/footer social icons
- **Change:** Remove Instagram icon/link (links to Facebook URL currently; no real Instagram exists)

### 5. Standardize Brand Name
- **Files:** `financing.html`, all pages with logo alt text
- **Change:** "Bells Fork Truck & Auto" → "Bells Fork Auto & Truck"; "Auto and Truck" → "Auto & Truck"

### 6. Improve Homepage H1
- **Files:** `index.html`
- **Change:** H1 from "Quality Vehicles Ready To Drive" to "Used Cars, Trucks & Diesel Vehicles in Greenville, NC". Move old text to subheading.

### 7. Fix GMC Casing
- **Files:** `inventory.json`, `index.html`
- **Change:** "Gmc" → "GMC" in inventory data and all homepage make references

### 8. Add Favicon Link Tags
- **Files:** All HTML pages `<head>`
- **Change:** Add `<link rel="icon" type="image/png" href="/assets/favicon.png">`

### 9. Add Skip-to-Content on Homepage
- **Files:** `index.html`
- **Change:** Add `<a href="#main" class="skip-link">Skip to main content</a>` as first child of `<body>`

### 10. Add Visible FAQ Section to Homepage
- **Files:** `index.html`
- **Change:** Add accordion FAQ section with 8 Q&As matching existing FAQPage schema

### 11. Create llms.txt
- **Files:** New file `llms.txt`
- **Change:** Structured AI-readable business summary

### 12. Fix Sitemap
- **Files:** `sitemap.xml`
- **Change:** Remove `.html` extensions from core page URLs, add `/blog` and `/reviews`, normalize VDP URL casing

### 13. Fix VDP Relative Links
- **Files:** `generate-vdp.js`
- **Change:** Replace `../../../vdp/` relative paths with absolute `/vdp/` paths in similar vehicles section

### 14. Improve Anchor Text
- **Files:** `index.html`
- **Change:** "View All" → "View All Inventory", "Read More" → "Read Full Post"

## Not In Scope
- About page rebuild
- Blog content creation
- Make/model landing pages
- Local area landing pages
- VDP spec population
- Review integration
