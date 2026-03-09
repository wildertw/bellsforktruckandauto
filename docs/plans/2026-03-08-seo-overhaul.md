# Bells Fork SEO Overhaul Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete SEO overhaul per the developer handoff checklist — brand rename, VIN privacy fix, content enrichment, schema completion, redirect migration, and GEO/AEO optimization.

**Architecture:** Static HTML site with Node.js build scripts. Source templates (index.html, about.html, etc.) are edited directly. Generated pages (VDPs, categories, form pages) are produced by scripts reading inventory.json. All generated pages must be rebuilt after script changes.

**Tech Stack:** Static HTML, Bootstrap 5, Node.js build scripts (generate-vdp.js, generate-category-pages.js, generate-form-pages.js, prerender-homepage.js, prerender-inventory.js), Netlify hosting, JSON-LD structured data.

**What's Already Done (verified):**
- Canonical tags on all pages
- Unique meta title + description per page
- Organization/AutoDealer JSON-LD sitewide
- OG + Twitter card tags on all pages
- Homepage H1 already reads "Used Cars, Trucks & Diesel Vehicles in Greenville, NC"
- Inventory pre-rendered in static HTML with all required card fields
- Category pages exist at /used-trucks-greenville-nc/ etc. with unique meta, H1, intro copy, FAQ, CollectionPage+ItemList schema
- VDP pages have Car/Offer/BreadcrumbList schema, descriptive slugs, similar vehicles, breadcrumbs
- Form pages already split into /financing/, /schedule-test-drive/, /make-an-offer/, /trade-in-value/, /consignment/

**Decision Point — Domain:** The current canonical domain is `bellsforkautoandtruck.com`. The spec mentions `bellsforktruckandauto.com` cutover. If the domain is changing, ALL canonical URLs, OG URLs, and schema URLs need updating alongside the brand rename. **Confirm with stakeholder before Task 1.**

---

## Phase 1: Brand Rename & VIN Privacy Fix

### Task 1: Rename brand in build scripts

**Files:**
- Modify: `generate-vdp.js`
- Modify: `generate-category-pages.js`
- Modify: `generate-form-pages.js`
- Modify: `prerender-homepage.js`
- Modify: `prerender-inventory.js`

**Step 1: Search for all brand occurrences in build scripts**

```bash
grep -rn "Bells Fork Auto" generate-vdp.js generate-category-pages.js generate-form-pages.js prerender-homepage.js prerender-inventory.js
```

**Step 2: Replace "Bells Fork Truck & Auto" → "Bells Fork Truck & Auto" in all build scripts**

Use find-and-replace across all 5 files. Also replace:
- "Bells Fork Truck and Auto" → "Bells Fork Truck and Auto"
- "Bells Fork Auto &amp; Truck" → "Bells Fork Truck &amp; Auto"
- "bellsforkautoandtruck" → "bellsforktruckandauto" (in URLs/emails if domain is changing)

**Step 3: Verify replacements**

```bash
grep -rn "Bells Fork Auto" generate-vdp.js generate-category-pages.js generate-form-pages.js prerender-homepage.js prerender-inventory.js
```

Expected: 0 matches.

**Step 4: Commit**

```bash
git add generate-vdp.js generate-category-pages.js generate-form-pages.js prerender-homepage.js prerender-inventory.js
git commit -m "feat: rename brand to Bells Fork Truck & Auto in build scripts"
```

---

### Task 2: Rename brand in source HTML templates

**Files:**
- Modify: `index.html`
- Modify: `about.html`
- Modify: `contact.html`
- Modify: `financing.html`
- Modify: `inventory.html`
- Modify: `reviews.html`
- Modify: `blog.html`
- Modify: `blog-post.html`
- Modify: `privacy.html`
- Modify: `consignment/index.html`
- Modify: `admin-dashboard.html`

**Step 1: Count all brand occurrences across source templates**

```bash
grep -rn "Bells Fork Auto" index.html about.html contact.html financing.html inventory.html reviews.html blog.html blog-post.html privacy.html consignment/index.html admin-dashboard.html
```

**Step 2: Replace in each file**

For each file, replace all variants:
- "Bells Fork Truck & Auto" → "Bells Fork Truck & Auto"
- "Bells Fork Auto &amp; Truck" → "Bells Fork Truck &amp; Auto"
- "Bells Fork Truck and Auto" → "Bells Fork Truck and Auto"

**Step 3: Update email address if applicable**

If `bellsforkautoandtruck@gmail.com` appears, confirm with stakeholder whether email is changing. If not, leave as-is with a comment noting the legacy email.

**Step 4: Update canonical/OG URLs if domain is changing**

Replace `bellsforkautoandtruck.com` → `bellsforktruckandauto.com` across all files (only if domain change confirmed).

**Step 5: Verify zero remaining old brand references**

```bash
grep -rn "Bells Fork Auto" index.html about.html contact.html financing.html inventory.html reviews.html blog.html blog-post.html privacy.html consignment/index.html
```

Expected: 0 matches (excluding admin files if those are internal-only).

**Step 6: Commit**

```bash
git add index.html about.html contact.html financing.html inventory.html reviews.html blog.html blog-post.html privacy.html consignment/index.html admin-dashboard.html
git commit -m "feat: rename brand to Bells Fork Truck & Auto in all source templates"
```

---

### Task 3: Remove VIN from public URL parameters

**Files:**
- Modify: `generate-vdp.js` (lines ~223 and ~979 — financing and contact URLs)
- Modify: `generate-form-pages.js` (if it propagates VIN in URLs)

**Step 1: Find all VIN URL parameter usage**

```bash
grep -n "vin=" generate-vdp.js generate-form-pages.js generate-category-pages.js
```

**Step 2: Replace VIN with stock number in CTA URLs**

In `generate-vdp.js`, change the financing link from:
```javascript
// OLD:
const applyHref = `${ASSET_PREFIX}financing.html?tab=financing&vehicle=${encodeURIComponent(title)}&vin=${encodeURIComponent(vin)}&price=${encodeURIComponent(String(v.price ?? ''))}#applications`;
```
to:
```javascript
// NEW — pass stock number instead of VIN:
const applyHref = `${ASSET_PREFIX}financing.html?tab=financing&vehicle=${encodeURIComponent(title)}&stock=${encodeURIComponent(v.stockNumber)}&price=${encodeURIComponent(String(v.price ?? ''))}#applications`;
```

Similarly update the contact/test-drive link:
```javascript
// OLD:
`${ASSET_PREFIX}contact.html?vehicle=${encodeURIComponent(title)}&vin=${encodeURIComponent(vin)}#appointment`
// NEW:
`${ASSET_PREFIX}contact.html?vehicle=${encodeURIComponent(title)}&stock=${encodeURIComponent(v.stockNumber)}#appointment`
```

**Step 3: Update form page scripts to read stock instead of VIN**

Check financing.html and contact.html for JavaScript that reads `vin` from query params. Update to read `stock` instead. The form can still include VIN as a hidden field populated server-side or from inventory data, but it should not appear in the URL.

**Step 4: Verify no VIN in generated URLs**

```bash
grep -n "vin=" generate-vdp.js
```

Expected: 0 matches (except the obfuscated VIN reveal button, which is fine).

**Step 5: Commit**

```bash
git add generate-vdp.js
git commit -m "fix: remove VIN from public URL parameters, use stock number instead"
```

---

### Task 4: Rebuild all generated pages

**Step 1: Run full build**

```bash
npm run build
```

**Step 2: Verify brand rename in generated output**

```bash
grep -rn "Bells Fork Auto" vdp/ used-trucks-greenville-nc/ used-suvs-greenville-nc/ used-cars-greenville-nc/ used-diesel-trucks-greenville-nc/ financing/ schedule-test-drive/ make-an-offer/ trade-in-value/
```

Expected: 0 matches.

**Step 3: Verify no VIN in generated URLs**

```bash
grep -rn "vin=" vdp/*/Used*/index.html | head -5
```

Expected: Only the obfuscated VIN reveal button, not in `href` attributes.

**Step 4: Commit generated files**

```bash
git add vdp/ used-trucks-greenville-nc/ used-suvs-greenville-nc/ used-cars-greenville-nc/ used-diesel-trucks-greenville-nc/ financing/ schedule-test-drive/ make-an-offer/ trade-in-value/
git commit -m "build: regenerate all pages with new brand name and VIN-free URLs"
```

---

## Phase 2: Homepage Enhancements

### Task 5: Add homepage summary block

**Files:**
- Modify: `index.html`

**Step 1: Add a summary block below the hero section**

Insert after the hero section (before any existing content sections) a concise block answering: who, what, where, financing, areas served.

```html
<section class="py-5 bg-white">
  <div class="container">
    <div class="row justify-content-center">
      <div class="col-lg-10">
        <p class="lead text-center mb-3">
          Bells Fork Truck &amp; Auto is a locally owned used vehicle dealership at 3840 Charles Blvd in Greenville, NC.
          We carry inspected trucks, SUVs, cars, and diesel vehicles — all priced transparently with no hidden fees.
          In-house financing is available for every credit situation.
          We proudly serve Greenville, Winterville, Ayden, Farmville, Washington, and the greater Pitt County area.
        </p>
      </div>
    </div>
  </div>
</section>
```

**Step 2: Verify it renders correctly**

Open index.html in browser and confirm the summary appears below the hero.

**Step 3: Commit**

```bash
git add index.html
git commit -m "feat: add homepage summary block with local context"
```

---

### Task 6: Add Popular Body Styles, Makes, and Models sections to homepage

**Files:**
- Modify: `index.html`

**Step 1: Add Popular Body Styles section with links to category pages**

```html
<section class="py-5 bg-light">
  <div class="container">
    <h2 class="h4 fw-bold mb-4 text-center">Popular Body Styles</h2>
    <div class="row g-3 justify-content-center">
      <div class="col-6 col-md-3"><a href="used-trucks-greenville-nc/" class="d-block text-center p-3 bg-white rounded shadow-sm text-decoration-none text-dark fw-semibold">Trucks</a></div>
      <div class="col-6 col-md-3"><a href="used-suvs-greenville-nc/" class="d-block text-center p-3 bg-white rounded shadow-sm text-decoration-none text-dark fw-semibold">SUVs &amp; Crossovers</a></div>
      <div class="col-6 col-md-3"><a href="used-cars-greenville-nc/" class="d-block text-center p-3 bg-white rounded shadow-sm text-decoration-none text-dark fw-semibold">Cars &amp; Sedans</a></div>
      <div class="col-6 col-md-3"><a href="used-diesel-trucks-greenville-nc/" class="d-block text-center p-3 bg-white rounded shadow-sm text-decoration-none text-dark fw-semibold">Diesel Vehicles</a></div>
    </div>
  </div>
</section>
```

**Step 2: Add Popular Makes section**

Derive makes from current inventory.json. Link each to inventory page with make filter.

```html
<section class="py-5 bg-white">
  <div class="container">
    <h2 class="h4 fw-bold mb-4 text-center">Popular Makes</h2>
    <div class="row g-2 justify-content-center">
      <div class="col-auto"><a href="inventory.html?make=chevrolet" class="btn btn-outline-dark btn-sm">Chevrolet</a></div>
      <div class="col-auto"><a href="inventory.html?make=ford" class="btn btn-outline-dark btn-sm">Ford</a></div>
      <div class="col-auto"><a href="inventory.html?make=gmc" class="btn btn-outline-dark btn-sm">GMC</a></div>
      <div class="col-auto"><a href="inventory.html?make=toyota" class="btn btn-outline-dark btn-sm">Toyota</a></div>
      <div class="col-auto"><a href="inventory.html?make=ram" class="btn btn-outline-dark btn-sm">RAM</a></div>
      <div class="col-auto"><a href="inventory.html?make=jeep" class="btn btn-outline-dark btn-sm">Jeep</a></div>
      <div class="col-auto"><a href="inventory.html?make=dodge" class="btn btn-outline-dark btn-sm">Dodge</a></div>
      <div class="col-auto"><a href="inventory.html?make=subaru" class="btn btn-outline-dark btn-sm">Subaru</a></div>
    </div>
  </div>
</section>
```

**Step 3: Add internal navigation links section**

```html
<section class="py-4 bg-light">
  <div class="container">
    <div class="row g-3 text-center">
      <div class="col-6 col-md-4 col-lg-2"><a href="used-trucks-greenville-nc/" class="text-decoration-none text-dark d-block p-2"><strong>Used Trucks</strong></a></div>
      <div class="col-6 col-md-4 col-lg-2"><a href="used-suvs-greenville-nc/" class="text-decoration-none text-dark d-block p-2"><strong>Used SUVs</strong></a></div>
      <div class="col-6 col-md-4 col-lg-2"><a href="used-cars-greenville-nc/" class="text-decoration-none text-dark d-block p-2"><strong>Used Cars</strong></a></div>
      <div class="col-6 col-md-4 col-lg-2"><a href="used-diesel-trucks-greenville-nc/" class="text-decoration-none text-dark d-block p-2"><strong>Diesel Trucks</strong></a></div>
      <div class="col-6 col-md-4 col-lg-2"><a href="financing.html" class="text-decoration-none text-dark d-block p-2"><strong>Financing</strong></a></div>
      <div class="col-6 col-md-4 col-lg-2"><a href="reviews.html" class="text-decoration-none text-dark d-block p-2"><strong>Reviews</strong></a></div>
    </div>
  </div>
</section>
```

**Step 4: Commit**

```bash
git add index.html
git commit -m "feat: add Popular Body Styles, Makes, and internal links to homepage"
```

---

### Task 7: Add homepage FAQ block

**Files:**
- Modify: `index.html`

**Step 1: Add FAQ section before footer**

```html
<section class="py-5 bg-white">
  <div class="container">
    <h2 class="h4 fw-bold mb-4 text-center">Frequently Asked Questions</h2>
    <div class="accordion" id="homepageFAQ">
      <div class="accordion-item">
        <h3 class="accordion-header"><button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#faq1">What types of vehicles does Bells Fork Truck &amp; Auto sell?</button></h3>
        <div id="faq1" class="accordion-collapse collapse" data-bs-parent="#homepageFAQ"><div class="accordion-body">We carry a rotating selection of used trucks, SUVs, cars, and diesel vehicles. Our inventory focuses on dependable, inspected vehicles priced fairly for the Greenville, NC market.</div></div>
      </div>
      <div class="accordion-item">
        <h3 class="accordion-header"><button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#faq2">Do you offer financing?</button></h3>
        <div id="faq2" class="accordion-collapse collapse" data-bs-parent="#homepageFAQ"><div class="accordion-body">Yes. We work with buyers in every credit situation. Apply online or visit us at 3840 Charles Blvd to discuss financing options in person.</div></div>
      </div>
      <div class="accordion-item">
        <h3 class="accordion-header"><button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#faq3">Where is Bells Fork Truck &amp; Auto located?</button></h3>
        <div id="faq3" class="accordion-collapse collapse" data-bs-parent="#homepageFAQ"><div class="accordion-body">We are located at 3840 Charles Blvd, Greenville, NC 27858. We serve Greenville, Winterville, Ayden, Farmville, Washington, and the surrounding Pitt County area.</div></div>
      </div>
      <div class="accordion-item">
        <h3 class="accordion-header"><button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#faq4">Can I schedule a test drive online?</button></h3>
        <div id="faq4" class="accordion-collapse collapse" data-bs-parent="#homepageFAQ"><div class="accordion-body">Yes. Use our online test drive form or call us at (252) 496-0005 to schedule a visit. Walk-ins are also welcome during business hours.</div></div>
      </div>
      <div class="accordion-item">
        <h3 class="accordion-header"><button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#faq5">Do you accept trade-ins?</button></h3>
        <div id="faq5" class="accordion-collapse collapse" data-bs-parent="#homepageFAQ"><div class="accordion-body">Yes. Submit a trade-in appraisal request online or bring your vehicle to the lot for an in-person evaluation.</div></div>
      </div>
    </div>
  </div>
</section>
```

**Step 2: Add FAQPage schema to homepage JSON-LD**

Add a FAQPage entry to the existing schema graph in index.html:

```json
{
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "What types of vehicles does Bells Fork Truck & Auto sell?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "We carry a rotating selection of used trucks, SUVs, cars, and diesel vehicles. Our inventory focuses on dependable, inspected vehicles priced fairly for the Greenville, NC market."
      }
    },
    {
      "@type": "Question",
      "name": "Do you offer financing?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Yes. We work with buyers in every credit situation. Apply online or visit us at 3840 Charles Blvd to discuss financing options in person."
      }
    },
    {
      "@type": "Question",
      "name": "Where is Bells Fork Truck & Auto located?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "We are located at 3840 Charles Blvd, Greenville, NC 27858. We serve Greenville, Winterville, Ayden, Farmville, Washington, and the surrounding Pitt County area."
      }
    },
    {
      "@type": "Question",
      "name": "Can I schedule a test drive online?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Yes. Use our online test drive form or call us at (252) 496-0005 to schedule a visit. Walk-ins are also welcome during business hours."
      }
    },
    {
      "@type": "Question",
      "name": "Do you accept trade-ins?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Yes. Submit a trade-in appraisal request online or bring your vehicle to the lot for an in-person evaluation."
      }
    }
  ]
}
```

**Step 3: Commit**

```bash
git add index.html
git commit -m "feat: add FAQ section with FAQPage schema to homepage"
```

---

## Phase 3: Inventory Page Updates

### Task 8: Add inventory intro copy and category links

**Files:**
- Modify: `inventory.html`

**Step 1: Add intro paragraph above the filter bar**

Insert before the filter/inventory grid section:

```html
<div class="container mt-4 mb-3">
  <p class="lead">Browse used trucks, SUVs, diesel vehicles, and cars for sale at Bells Fork Truck &amp; Auto in Greenville, NC. Every vehicle is inspected and priced with no hidden fees.</p>
  <div class="d-flex flex-wrap gap-2 mb-3">
    <a href="used-trucks-greenville-nc/" class="btn btn-outline-dark btn-sm">Trucks</a>
    <a href="used-suvs-greenville-nc/" class="btn btn-outline-dark btn-sm">SUVs</a>
    <a href="used-cars-greenville-nc/" class="btn btn-outline-dark btn-sm">Cars</a>
    <a href="used-diesel-trucks-greenville-nc/" class="btn btn-outline-dark btn-sm">Diesel</a>
  </div>
</div>
```

**Step 2: Verify BreadcrumbList schema exists on inventory page**

Check if BreadcrumbList is in inventory.html schema. If missing, add:

```json
{
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://bellsforktruckandauto.com/" },
    { "@type": "ListItem", "position": 2, "name": "Inventory", "item": "https://bellsforktruckandauto.com/inventory.html" }
  ]
}
```

**Step 3: Commit**

```bash
git add inventory.html
git commit -m "feat: add intro copy and category links to inventory page"
```

---

## Phase 4: VDP Template Updates

### Task 9: Add FAQ block and "Make an Offer" / "Trade In" CTAs to VDP generator

**Files:**
- Modify: `generate-vdp.js`

**Step 1: Add Make an Offer and Trade In CTA buttons**

Find the CTA section in generate-vdp.js (near the Apply for Financing and Schedule Test Drive buttons). Add two more CTAs:

```javascript
// Make an Offer CTA (uses stock number, not VIN)
const offerHref = `${ASSET_PREFIX}make-an-offer/?vehicle=${encodeURIComponent(title)}&stock=${encodeURIComponent(v.stockNumber)}&price=${encodeURIComponent(String(v.price ?? ''))}`;

// Trade In CTA
const tradeHref = `${ASSET_PREFIX}trade-in-value/`;
```

Add corresponding HTML buttons in the CTA area:

```html
<a href="${offerHref}" class="btn btn-outline-primary w-100 mb-2">Make an Offer</a>
<a href="${tradeHref}" class="btn btn-outline-secondary w-100 mb-2">Trade-In Value</a>
```

**Step 2: Add FAQ section to VDP template**

Add a dynamically generated FAQ section after the vehicle details, before similar vehicles. Generate 4 questions relevant to the vehicle type:

```javascript
function generateVDPFaq(v) {
  const title = vehicleTitle(v);
  const faqs = [
    {
      q: `What is the price of this ${title}?`,
      a: v.price ? `This ${title} is listed at $${Number(v.price).toLocaleString()}. Contact us at (252) 496-0005 for the latest pricing and financing options.` : `Contact Bells Fork Truck & Auto at (252) 496-0005 for current pricing on this ${title}.`
    },
    {
      q: `Is financing available for this ${title}?`,
      a: `Yes. Bells Fork Truck & Auto offers financing for all credit situations. Apply online or visit us at 3840 Charles Blvd, Greenville, NC 27858.`
    },
    {
      q: `Can I schedule a test drive for this ${title}?`,
      a: `Yes. Schedule a test drive online or call (252) 496-0005. Walk-ins are welcome during business hours.`
    },
    {
      q: `What is the mileage on this ${title}?`,
      a: v.mileage ? `This ${title} has ${Number(v.mileage).toLocaleString()} miles. All vehicles are inspected before listing.` : `Contact us for current mileage details on this ${title}.`
    }
  ];
  return faqs;
}
```

Generate FAQ HTML and FAQPage schema from these questions.

**Step 3: Add ImageObject schema to VDP**

In the JSON-LD graph, add ImageObject entries for each vehicle photo:

```javascript
const imageObjects = (v.images || []).map((img, i) => ({
  "@type": "ImageObject",
  "url": img,
  "name": `${title} - Photo ${i + 1}`,
  "description": `${title} for sale at Bells Fork Truck & Auto in Greenville, NC`
}));
```

Reference these in the Car schema's `image` property.

**Step 4: Commit**

```bash
git add generate-vdp.js
git commit -m "feat: add FAQ, Make an Offer/Trade-In CTAs, and ImageObject schema to VDP template"
```

---

### Task 10: Add minimum data quality validation to VDP generator

**Files:**
- Modify: `generate-vdp.js`

**Step 1: Add validation before generating each VDP**

After filtering out sold vehicles, add a quality check:

```javascript
const REQUIRED_FIELDS = ['price', 'mileage', 'type', 'transmission', 'fuelType'];
const MIN_PHOTOS = 6;

function validateVehicle(v) {
  const missing = REQUIRED_FIELDS.filter(f => !v[f]);
  const photoCount = (v.images || []).length;
  const warnings = [];
  if (missing.length > 0) warnings.push(`Missing fields: ${missing.join(', ')}`);
  if (photoCount < MIN_PHOTOS) warnings.push(`Only ${photoCount} photos (minimum ${MIN_PHOTOS})`);
  return warnings;
}
```

Log warnings during build but still generate the page (don't block). This gives visibility into data quality:

```javascript
const warnings = validateVehicle(v);
if (warnings.length > 0) {
  console.warn(`⚠ ${v.stockNumber} ${vehicleTitle(v)}: ${warnings.join('; ')}`);
}
```

**Step 2: Commit**

```bash
git add generate-vdp.js
git commit -m "feat: add minimum data quality validation warnings to VDP generator"
```

---

## Phase 5: Financing & Contact Page Fixes

### Task 11: Fix financing/contact URL canonicalization and VIN removal

**Files:**
- Modify: `financing.html`
- Modify: `contact.html`
- Modify: `generate-form-pages.js`

**Step 1: Add canonical tags to financing.html if missing**

Verify `<link rel="canonical" href="https://bellsforktruckandauto.com/financing.html">` exists. If not, add it.

**Step 2: Update JavaScript in financing.html to read `stock` param instead of `vin`**

Find the JS that reads URL parameters and pre-fills form fields. Change:
```javascript
// OLD:
const vin = params.get('vin');
// NEW:
const stock = params.get('stock');
```

Update any hidden form field from `name="vin"` to `name="stock"` for the URL-passed value. The actual VIN can be looked up server-side from the stock number.

**Step 3: Same treatment for contact.html**

Update contact.html JS to read `stock` instead of `vin` from URL params.

**Step 4: Add FAQ block to financing page**

Add 4-5 financing-specific FAQs with FAQPage schema:
- What credit score do I need?
- What documents should I bring?
- Can I apply online?
- Do you offer buy-here-pay-here?
- What is the down payment requirement?

**Step 5: Rebuild form pages**

```bash
node generate-form-pages.js
```

**Step 6: Commit**

```bash
git add financing.html contact.html generate-form-pages.js financing/ schedule-test-drive/ make-an-offer/ trade-in-value/
git commit -m "fix: remove VIN from financing/contact URLs, add financing FAQ"
```

---

### Task 12: Add local summary to contact page

**Files:**
- Modify: `contact.html`

**Step 1: Add summary paragraph near top of content**

```html
<p class="lead mb-4">Visit Bells Fork Truck &amp; Auto at 3840 Charles Blvd, Greenville, NC 27858. Call <a href="tel:+12524960005">(252) 496-0005</a>, send us a message, or stop by during business hours.</p>
```

**Step 2: Verify NAP matches Google Business Profile**

Confirm:
- Name: Bells Fork Truck & Auto
- Address: 3840 Charles Blvd, Greenville, NC 27858
- Phone: (252) 496-0005

**Step 3: Commit**

```bash
git add contact.html
git commit -m "feat: add local summary to contact page"
```

---

## Phase 6: About Page Expansion

### Task 13: Expand about page content

**Files:**
- Modify: `about.html`

**Step 1: Expand existing content**

The about page already has ~400 words. Add/expand the following sections below the existing content:

**How We Source Our Vehicles:**
Short paragraph about inspection and sourcing process.

**Financing Made Simple:**
Short paragraph about financing philosophy — working with all credit situations, transparent terms.

**Why Local Buyers Choose Us:**
3-4 bullet points: inspected vehicles, no hidden fees, local ownership, community trust.

**Areas We Serve:**
List of nearby towns: Greenville, Winterville, Ayden, Farmville, Washington, Bethel, Grimesland, Simpson, Pitt County.

**Step 2: Add internal links**

Add links within the content to:
- `inventory.html` — "Browse our inventory"
- `financing.html` — "Apply for financing"
- `reviews.html` — "Read customer reviews"
- `contact.html` — "Contact us"

**Step 3: Commit**

```bash
git add about.html
git commit -m "feat: expand about page with sourcing, financing, areas served, and internal links"
```

---

## Phase 7: Reviews Page Content

### Task 14: Add static review excerpts to reviews page

**Files:**
- Modify: `reviews.html`

**Step 1: Add visible first-party review excerpts**

Below the existing header, add a section with 5-8 review excerpts. Each review should include:
- Reviewer first name + last initial
- Approximate date
- Vehicle purchased (if relevant)
- Short quote (1-3 sentences)

```html
<section class="py-5">
  <div class="container">
    <div class="row g-4">
      <div class="col-md-6">
        <div class="card h-100 border-0 shadow-sm">
          <div class="card-body">
            <div class="mb-2 text-warning">★★★★★</div>
            <p class="card-text">"Straightforward deal, no pressure. The truck was exactly as described and the price was fair. Would buy here again."</p>
            <footer class="text-muted"><strong>Michael T.</strong> · Purchased a 2019 Ford F-150 · Dec 2024</footer>
          </div>
        </div>
      </div>
      <!-- Repeat for additional reviews -->
    </div>
  </div>
</section>
```

**NOTE:** These reviews must be real customer reviews. Coordinate with the dealership owner to collect actual testimonials. The plan includes placeholder structure — content must be verified as authentic before publish.

**Step 2: Add Google review CTA**

```html
<section class="py-4 bg-light text-center">
  <div class="container">
    <h2 class="h5 fw-bold mb-3">Had a great experience?</h2>
    <a href="https://g.page/r/YOUR_GOOGLE_REVIEW_LINK/review" class="btn btn-primary" target="_blank" rel="noopener">Leave a Google Review</a>
  </div>
</section>
```

Replace `YOUR_GOOGLE_REVIEW_LINK` with the actual Google Business review link.

**Step 3: Add "Why Customers Choose Us" proof section**

```html
<section class="py-5 bg-white">
  <div class="container">
    <h2 class="h4 fw-bold mb-4 text-center">Why Customers Choose Bells Fork Truck &amp; Auto</h2>
    <div class="row g-4 text-center">
      <div class="col-md-4">
        <h3 class="h6 fw-bold">Inspected Vehicles</h3>
        <p>Every vehicle on our lot is checked before it goes up for sale.</p>
      </div>
      <div class="col-md-4">
        <h3 class="h6 fw-bold">Transparent Pricing</h3>
        <p>No hidden fees, no surprises. The price you see is the price you pay.</p>
      </div>
      <div class="col-md-4">
        <h3 class="h6 fw-bold">Financing for All</h3>
        <p>We work with every credit situation to get you on the road.</p>
      </div>
    </div>
  </div>
</section>
```

**Step 4: Do NOT add review schema** unless reviews are verified as compliant with Google's review snippet guidelines.

**Step 5: Commit**

```bash
git add reviews.html
git commit -m "feat: add review excerpts, Google review CTA, and trust section to reviews page"
```

---

## Phase 8: Blog Fix

### Task 15: Fix blog empty/error state logic

**Files:**
- Modify: `blog.html`
- Possibly modify: `assets/js/blog-loader.js` or equivalent

**Step 1: Read the blog JavaScript**

Find the JS file that controls `#emptyState` and `#errorState` display logic.

**Step 2: Fix the logic**

Ensure only ONE state can be visible at a time:
- Loading → show spinner
- Success with posts → show posts, hide empty+error
- Success with 0 posts → show empty, hide error
- Error → show error, hide empty

```javascript
function showState(state) {
  document.getElementById('emptyState').style.display = state === 'empty' ? '' : 'none';
  document.getElementById('errorState').style.display = state === 'error' ? '' : 'none';
  document.getElementById('postsGrid').style.display = state === 'posts' ? '' : 'none';
}
```

**Step 3: Decision — publish posts or hide blog**

If no blog posts will be ready at launch, add `style="display:none"` to the Blog nav link and add `<meta name="robots" content="noindex">` to blog.html. Remove both when posts are published.

**Step 4: Commit**

```bash
git add blog.html assets/js/
git commit -m "fix: prevent simultaneous empty and error states on blog page"
```

---

## Phase 9: Privacy & Utility Pages

### Task 16: Create branded 404 page

**Files:**
- Create: `404.html`
- Modify: `netlify.toml` (add redirect rule)

**Step 1: Create 404.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Page Not Found | Bells Fork Truck & Auto</title>
  <meta name="robots" content="noindex">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css">
  <link rel="stylesheet" href="/assets/css/main.min.css">
</head>
<body>
  <!-- Include standard nav/header -->
  <main class="py-5 text-center">
    <div class="container">
      <h1 class="display-4 fw-bold mb-3">Page Not Found</h1>
      <p class="lead mb-4">The page you're looking for may have been moved or no longer exists.</p>
      <div class="d-flex flex-wrap gap-3 justify-content-center">
        <a href="/" class="btn btn-primary">Back to Homepage</a>
        <a href="/inventory.html" class="btn btn-outline-dark">Browse Inventory</a>
        <a href="/contact.html" class="btn btn-outline-dark">Contact Us</a>
      </div>
    </div>
  </main>
  <!-- Include standard footer -->
</body>
</html>
```

Match the nav/header/footer from other pages.

**Step 2: Add custom 404 handling in netlify.toml**

Add to the `[[redirects]]` section:

```toml
[[redirects]]
  from = "/*"
  to = "/404.html"
  status = 404
```

**Step 3: Commit**

```bash
git add 404.html netlify.toml
git commit -m "feat: add branded 404 page with recovery links"
```

---

### Task 17: Review privacy page and add noindex

**Files:**
- Modify: `privacy.html`

**Step 1: Check if privacy page has a robots meta tag**

If missing, add `<meta name="robots" content="noindex">` to the `<head>`.

**Step 2: Verify privacy page is linked in footer of all templates**

Grep for `privacy` in the footer section of index.html and other templates.

**Step 3: Commit**

```bash
git add privacy.html
git commit -m "feat: add noindex to privacy page"
```

---

### Task 18: Add sold VDP redirect handling

**Files:**
- Modify: `generate-vdp.js`
- Modify: `netlify.toml`

**Step 1: Update VDP generator to create redirect rules for sold vehicles**

Instead of skipping sold vehicles entirely, generate a redirect entry:

```javascript
// In generate-vdp.js, for sold vehicles:
const soldRedirects = [];
for (const v of vehicles) {
  if (v.status === 'sold') {
    const slug = buildSlug(v);
    soldRedirects.push(`/vdp/${v.stockNumber}/${slug}/*  /inventory.html  301`);
  }
}
// Write to _redirects or append to a redirects config file
```

Alternatively, add sold vehicle redirects to netlify.toml programmatically or maintain a `_redirects` file.

**Step 2: Commit**

```bash
git add generate-vdp.js netlify.toml
git commit -m "feat: redirect sold VDPs to inventory page"
```

---

## Phase 10: GEO/AEO Content Blocks

### Task 19: Create reusable GEO/AEO content blocks

**Files:**
- Modify: `index.html` (some blocks already added in Tasks 5-7)
- Modify: `generate-vdp.js` (for VDP pages)
- Modify: `generate-category-pages.js` (for category pages)

**Step 1: Define standard content blocks**

Create these blocks as reusable HTML snippets used across templates:

1. **Business at a Glance** — Name, address, phone, hours (already in most pages via schema + visible NAP)
2. **What We Sell** — "Used trucks, SUVs, cars, and diesel vehicles" (add to pages missing this)
3. **Where We're Located** — "3840 Charles Blvd, Greenville, NC 27858" with map link
4. **Financing Availability** — One-liner: "Financing available for all credit situations"
5. **Areas We Serve** — "Greenville, Winterville, Ayden, Farmville, Washington, and Pitt County"
6. **Why Buy From Us** — 3 bullet points: inspected, transparent, local
7. **FAQ Block** — Already added to homepage and VDPs; ensure category pages have them

**Step 2: Add missing blocks to category page generator**

In `generate-category-pages.js`, ensure each category page includes:
- Financing CTA
- Areas served mention
- Links to related categories and contact

**Step 3: Add dealer info block to VDP template**

In `generate-vdp.js`, ensure each VDP includes a concise "About the Dealer" block:

```html
<section class="py-4 bg-light mt-4">
  <div class="container">
    <h2 class="h5 fw-bold">About Bells Fork Truck &amp; Auto</h2>
    <p>Locally owned used vehicle dealership at 3840 Charles Blvd, Greenville, NC 27858. Every vehicle inspected. Financing available for all credit situations. Serving Greenville, Winterville, Ayden, Farmville, and Pitt County. <a href="${ASSET_PREFIX}contact.html">Contact us</a> or call <a href="tel:+12524960005">(252) 496-0005</a>.</p>
  </div>
</section>
```

**Step 4: Rebuild**

```bash
npm run build
```

**Step 5: Commit**

```bash
git add generate-vdp.js generate-category-pages.js index.html
git commit -m "feat: add GEO/AEO content blocks across templates"
```

---

## Phase 11: Redirect Migration

### Task 20: Map old .com URLs and add 301 redirects

**Files:**
- Modify: `netlify.toml`

**Step 1: Research old URL patterns**

The old site at bellsforktruckandauto.com uses patterns like:
- `/vehicle/{id}/{slug}/` → redirect to `/vdp/{stock}/{slug}/`
- `forms.php?...` → redirect to `/financing/` or relevant form page
- `/service/` → redirect to `/contact.html` or a new service page
- Old inventory filters → redirect to category pages

**Step 2: Add redirect rules**

```toml
# Old .com VDP pattern
[[redirects]]
  from = "/vehicle/*"
  to = "/inventory.html"
  status = 301

# Old form URLs
[[redirects]]
  from = "/forms.php"
  to = "/financing/"
  status = 301

# Old service page
[[redirects]]
  from = "/service/"
  to = "/contact.html"
  status = 301
[[redirects]]
  from = "/service"
  to = "/contact.html"
  status = 301

# Old inventory filters → category pages
[[redirects]]
  from = "/inventory?type=truck*"
  to = "/used-trucks-greenville-nc/"
  status = 301

[[redirects]]
  from = "/inventory?type=suv*"
  to = "/used-suvs-greenville-nc/"
  status = 301

[[redirects]]
  from = "/inventory?type=car*"
  to = "/used-cars-greenville-nc/"
  status = 301

[[redirects]]
  from = "/inventory?type=diesel*"
  to = "/used-diesel-trucks-greenville-nc/"
  status = 301
```

**NOTE:** Netlify query-string redirects have limitations. Test thoroughly. If specific old VDP URLs are high-value (check Google Search Console), add individual 301s for those.

**Step 3: If domain is changing, add domain-level redirect**

In Netlify domain settings (not in code), configure `bellsforkautoandtruck.com` → `bellsforktruckandauto.com` as a 301 redirect. This is done via Netlify dashboard, not in config files.

**Step 4: Commit**

```bash
git add netlify.toml
git commit -m "feat: add 301 redirect rules for old URL patterns"
```

---

## Phase 12: Final Schema Verification & Standardization

### Task 21: Verify and standardize all schema across templates

**Files:**
- All templates and generators

**Step 1: Validate schema on each page type**

Run each generated page through Google's Rich Results Test or Schema Markup Validator:
- Homepage: AutoDealer, Organization, WebSite, FAQPage
- Category pages: CollectionPage, ItemList, BreadcrumbList
- VDPs: Vehicle/Car, Offer, BreadcrumbList, ImageObject, FAQPage
- Blog posts: Article
- FAQ sections: FAQPage

**Step 2: Ensure business name consistency in schema**

```bash
grep -rn '"name"' index.html about.html generate-vdp.js generate-category-pages.js | grep -i "bells"
```

All schema `name` fields must read "Bells Fork Truck & Auto".

**Step 3: Standardize Google Maps link across all templates**

```bash
grep -rn "google.com/maps" index.html about.html contact.html generate-vdp.js
```

Ensure all "Directions" links use one consistent URL:
```
https://www.google.com/maps/dir/?api=1&destination=Bells+Fork+Truck+%26+Auto,+3840+Charles+Blvd,+Greenville,+NC+27858
```

**Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: standardize schema business name and map links across all templates"
```

---

## Phase 13: Full Rebuild & QA

### Task 22: Final full rebuild and verification

**Step 1: Clean rebuild**

```bash
npm run build
```

**Step 2: Brand name verification**

```bash
grep -rn "Bells Fork Auto" . --include="*.html" --include="*.js" | grep -v node_modules | grep -v ".git"
```

Expected: 0 matches (or only in legacy admin files if those aren't public-facing).

**Step 3: VIN URL verification**

```bash
grep -rn 'vin=' . --include="*.html" | grep 'href' | grep -v node_modules | grep -v ".git"
```

Expected: 0 matches.

**Step 4: Schema validation**

Manually spot-check 3-5 pages in Google's Rich Results Test:
- Homepage
- One VDP
- One category page
- Financing page
- Contact page

**Step 5: Final commit**

```bash
git add -A
git commit -m "build: final rebuild with all SEO overhaul changes"
```

---

## Execution Checklist Summary

| Phase | Tasks | Status |
|-------|-------|--------|
| 1: Brand Rename & VIN Fix | Tasks 1-4 | Pending |
| 2: Homepage | Tasks 5-7 | Pending |
| 3: Inventory | Task 8 | Pending |
| 4: VDP Template | Tasks 9-10 | Pending |
| 5: Financing & Contact | Tasks 11-12 | Pending |
| 6: About Page | Task 13 | Pending |
| 7: Reviews Page | Task 14 | Pending |
| 8: Blog Fix | Task 15 | Pending |
| 9: Privacy & Utility | Tasks 16-18 | Pending |
| 10: GEO/AEO Blocks | Task 19 | Pending |
| 11: Redirect Migration | Task 20 | Pending |
| 12: Schema Verification | Task 21 | Pending |
| 13: Final QA | Task 22 | Pending |

**Total: 22 tasks across 13 phases**

**Dependencies:**
- Tasks 1-3 must complete before Task 4 (rebuild)
- Task 4 must complete before Tasks 9-10 changes take effect
- Tasks 19 requires Tasks 1-3 (brand name) to be done first
- Task 22 must be last
