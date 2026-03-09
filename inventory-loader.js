// inventory-loader.js - Dynamic Inventory Loading System
// Include this file in pages that need:
//  - Home featured carousel (Find a Vehicle + Featured Vehicles + Popular lists)
//  - Optional inventory grid cards (if #inventoryGrid exists)

class InventoryLoader {
  constructor(jsonPath = 'inventory.json') {
    this.jsonPath = jsonPath;
    this.vehicles = [];

    // Optional "grid" rendering (older home layout)
    this.grid = document.getElementById('inventoryGrid');
    this.limit = this.grid ? parseInt(this.grid.getAttribute('data-limit') || '', 10) : NaN;

    // Home modules
    this.featuredGrid = document.getElementById('featuredGrid');
    this.homeMake = document.getElementById('homeMake');
    this.homeModel = document.getElementById('homeModel');
    this.homeMaxPrice = document.getElementById('homeMaxPrice');
    this.homeSearchBtn = document.getElementById('homeSearchBtn');

    this.popBody = document.getElementById('popularBodyStyles');
    this.popMakes = document.getElementById('popularMakes');
    this.popMakeModels = document.getElementById('popularMakeModels');
  }

  // Build SEO-friendly VDP URL matching generate_vdp_pages.py format
  buildVDPUrl(v) {
    const make  = (v.make  || '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '');
    const model = (v.model || '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '');
    const trim  = (v.trim  || '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '');
    const slug  = `Used-${v.year}-${make}-${model}${trim ? '-' + trim : ''}-for-sale-in-Greenville-NC-27858`;
    const id    = (v.stockNumber || v.vin || v.id || '').toString().replace(/[^a-z0-9]/gi, '');
    return `/vdp/${id}/${slug}/`;
  }

  // Load inventory from JSON
  async loadInventory() {
    try {
      const response = await fetch(this.jsonPath);
      if (!response.ok) throw new Error('Could not load inventory');

      const data = await response.json();
      this.vehicles = (data.vehicles || []).filter(v => v && (v.status === 'available' || !v.status));

      // Optional grid rendering
      if (this.grid) {
        const sorted = this.getMostRecent(this.vehicles);
        this.renderVehicles(sorted);
      }

      return this.vehicles;
    } catch (error) {
      console.error('Error loading inventory:', error);
      if (this.grid) this.showError();
      return [];
    }
  }

  // Helpers
  titleCase(s) {
    const str = String(s || '').trim();
    if (!str) return '';
    return str
      .toLowerCase()
      .split(' ')
      .filter(Boolean)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }

  formatMoney(n) {
    const num = Number(n);
    if (!Number.isFinite(num)) return '';
    return `$${num.toLocaleString()}`;
  }

  resolveImageUrl(img) {
    if (!img) return '';
    if (img.startsWith('http')) return img;
    if (img.startsWith('blob:')) return 'photos/' + img.slice(5);
    return 'assets/vehicles/' + img;
  }

  getMostRecent(vehicles) {
    const sorted = [...vehicles].sort((a, b) => {
      const dateA = a.dateAdded ? new Date(a.dateAdded) : new Date(0);
      const dateB = b.dateAdded ? new Date(b.dateAdded) : new Date(0);
      return dateB - dateA;
    });
    return isNaN(this.limit) ? sorted : sorted.slice(0, this.limit);
  }

  // =============================
  // Grid card rendering (optional)
  // =============================
  renderVehicles(vehicles) {
    if (!this.grid) return;

    if (!vehicles || vehicles.length === 0) {
      this.grid.innerHTML = '<div class="col-12 text-center py-5"><p class="text-muted">No vehicles found matching your criteria.</p></div>';
      return;
    }

    this.grid.innerHTML = vehicles.map(vehicle => this.createVehicleCard(vehicle)).join('');
    this.bindImageFallbacks(this.grid);
  }

  createVehicleCard(v) {
    const priceRange = this.getPriceRange(v.price);
    const mainImage = v.images && v.images.length > 0 ? v.images[0] : '';
    const badgeClass = this.getBadgeClass(v.badge);
    const features = v.features || [];

    const vehicleLabel = `${v.year} ${v.make} ${v.model}${v.trim ? ' ' + v.trim : ''}`.trim();
    const applyHref = `financing.html?tab=financing&vehicle=${encodeURIComponent(vehicleLabel)}&stock=${encodeURIComponent(v.stockNumber || '')}&price=${encodeURIComponent(String(v.price ?? ''))}#applications`;
    const inquireHref = `contact.html?vehicle=${encodeURIComponent(vehicleLabel)}&stock=${encodeURIComponent(v.stockNumber || '')}#appointment`;

    const mpgDisplay = v.mpgCity && v.mpgHighway
      ? `<p class="text-muted small mb-2">⛽ ${v.mpgCity}/${v.mpgHighway} MPG${v.fuelType ? ' · ' + v.fuelType : ''}</p>`
      : (v.fuelType ? `<p class="text-muted small mb-2">${v.fuelType}</p>` : '');

    const stockDisplay = v.stockNumber
      ? `<span class="badge bg-secondary mb-2">Stock #${v.stockNumber}</span> `
      : '';

    const isLocal = mainImage && !mainImage.startsWith('http') && !mainImage.startsWith('blob:');
    const localImageAttr = isLocal
      ? ` data-local-image="${this.escapeAttr(mainImage)}"`
      : '';

    return `
      <div class="col-md-6 col-lg-4" data-type="${v.type || ''}" data-price="${priceRange}" data-vehicle-id="${v.vin || v.id || ''}">
        <article class="card shadow-soft h-100 inventory-card">
          <div class="inventory-img-wrap">
            ${v.badge ? `<span class="inventory-badge ${badgeClass}">${v.badge}</span>` : ''}
            ${mainImage ? `
              <a href="${this.buildVDPUrl(v)}" aria-label="View ${v.year} ${v.make} ${v.model} details">
                <img src="${this.resolveImageUrl(mainImage)}"
                     alt="${v.year} ${v.make} ${v.model}"
                     class="card-img-top"
                     style="height:220px; object-fit:cover;"
                     loading="lazy" decoding="async"
                     onload="this.classList.add('loaded')"${localImageAttr}>
              </a>
            ` : `
              <div class="inventory-placeholder d-flex align-items-center justify-content-center bg-light" style="height:220px;">
                <svg width="64" height="64" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true">
                  <rect x="1" y="3" width="15" height="13" rx="1" fill="none" stroke="currentColor" stroke-width="1"/>
                  <circle cx="5.5" cy="14.5" r="1.5" fill="currentColor"/>
                  <circle cx="12.5" cy="14.5" r="1.5" fill="currentColor"/>
                </svg>
              </div>
            `}
          </div>
          <div class="card-body d-flex flex-column">
            <div class="d-flex justify-content-between align-items-start mb-1">
              <h3 class="h6 fw-bold mb-0"><a href="${this.buildVDPUrl(v)}" class="text-dark text-decoration-none">${v.year} ${v.make} ${v.model}${v.trim ? ' ' + v.trim : ''}</a></h3>
              <span class="badge bg-danger ms-2 flex-shrink-0">${this.formatMoney(v.price).replace('$', '$')}</span>
            </div>
            <p class="text-muted small mb-2">${v.description || ''}</p>
            ${v.mileage ? `<p class="text-muted small mb-2"><strong>${Number(v.mileage).toLocaleString()} miles</strong></p>` : ''}
            ${mpgDisplay}
            ${stockDisplay}
            ${features.length > 0 ? `
            <div class="d-flex flex-wrap gap-1 mb-3">
              ${features.slice(0, 3).map(f => `<span class="badge bg-light text-dark border">${f}</span>`).join('')}
            </div>
            ` : ''}
            <div class="d-grid gap-2 mt-auto">
              <a href="${this.buildVDPUrl(v)}" class="btn btn-sm btn-outline-danger w-100">View Details</a>
              <a href="${applyHref}" class="btn btn-sm btn-danger w-100">Apply for This Vehicle</a>
              <a href="${inquireHref}" class="btn btn-sm btn-outline-dark w-100">Inquire About This Vehicle</a>
            </div>
          </div>
        </article>
      </div>
    `;
  }

  getPriceRange(price) {
    const p = Number(price) || 0;
    if (p < 10000) return 'under10';
    if (p < 20000) return '10to20';
    if (p < 30000) return '20to30';
    return 'over30';
  }

  getBadgeClass(badge) {
    const b = (badge || '').toLowerCase();
    if (b.includes('sold')) return 'bg-secondary';
    if (b.includes('new')) return 'bg-success';
    if (b.includes('recent')) return 'bg-danger';
    return 'bg-dark';
  }

  showError() {
    if (!this.grid) return;
    this.grid.innerHTML = `
      <div class="col-12">
        <div class="alert alert-danger" role="alert">
          <strong>Oops!</strong> We couldn't load the inventory right now. Please try again later.
        </div>
      </div>
    `;
  }

  buildImageFallbackCandidates(name) {
    const raw = String(name || '').trim();
    if (!raw || raw.startsWith('http') || raw.startsWith('blob:')) return [];
    const out = [];
    const seen = new Set();
    const add = (candidate) => {
      const clean = String(candidate || '').trim();
      if (!clean || seen.has(clean)) return;
      seen.add(clean);
      out.push(`assets/vehicles/${clean}`);
    };

    const extMatch = raw.match(/^(.+?)(?:\.([a-z0-9]+))?$/i);
    const base = extMatch ? extMatch[1] : raw;
    const originalExt = extMatch && extMatch[2] ? extMatch[2].toLowerCase() : '';

    const baseVariants = [];
    const baseSeen = new Set();
    const addBase = (b) => {
      const clean = String(b || '').trim();
      if (!clean || baseSeen.has(clean)) return;
      baseSeen.add(clean);
      baseVariants.push(clean);
    };
    addBase(base);

    const zeroPadMatch = base.match(/^(.*?)([-_])0([1-9]\d*)$/);
    if (zeroPadMatch) {
      const prefix = zeroPadMatch[1];
      const sep = zeroPadMatch[2];
      const num = zeroPadMatch[3];
      const altSep = sep === '-' ? '_' : '-';
      addBase(`${prefix}${sep}${num}`);
      addBase(`${prefix}${altSep}${num}`);
    }

    const plainNumMatch = base.match(/^(.*?)([-_])([1-9]\d*)$/);
    if (plainNumMatch) {
      const prefix = plainNumMatch[1];
      const sep = plainNumMatch[2];
      const num = plainNumMatch[3];
      const altSep = sep === '-' ? '_' : '-';
      const padded = num.padStart(2, '0');
      addBase(`${prefix}${sep}${padded}`);
      addBase(`${prefix}${altSep}${num}`);
      addBase(`${prefix}${altSep}${padded}`);
    }

    const extList = [];
    const extSeen = new Set();
    const addExt = (ext) => {
      const clean = String(ext || '').toLowerCase();
      if (!clean || extSeen.has(clean)) return;
      extSeen.add(clean);
      extList.push(clean);
    };
    addExt(originalExt);
    ['png', 'jpg', 'jpeg', 'webp'].forEach(addExt);

    baseVariants.forEach((b) => {
      extList.forEach((ext) => add(`${b}.${ext}`));
    });

    return out;
  }

  bindImageFallbacks(container) {
    if (!container) return;
    const imgs = container.querySelectorAll('img[data-local-image]');
    imgs.forEach((img) => {
      const localImage = img.getAttribute('data-local-image') || '';
      const candidates = this.buildImageFallbackCandidates(localImage);
      if (!candidates.length) return;
      let idx = 0;
      img.addEventListener('error', () => {
        while (idx < candidates.length) {
          const nextSrc = candidates[idx++];
          if (img.src.endsWith(nextSrc)) continue;
          img.src = nextSrc;
          return;
        }
      });
    });
  }

  // ==========================================
  // Home: Find a Vehicle + Featured + Popular
  // ==========================================
  initHomeModules() {
    this.initHomeSearch();
    this.initFeaturedGrid();
    this.renderPopularSections();
  }

  initHomeSearch() {
    if (!this.homeMake || !this.homeModel || !this.homeSearchBtn) return;

    // Populate makes
    const makes = Array.from(new Set(this.vehicles.map(v => this.titleCase(v.make)).filter(Boolean))).sort((a, b) => a.localeCompare(b));
    this.homeMake.innerHTML = ['<option value="">All Makes</option>', ...makes.map(m => `<option value="${this.escapeAttr(m)}">${this.escapeHtml(m)}</option>`)].join('');

    const updateModels = () => {
      const make = this.homeMake.value.trim();
      if (!make) {
        this.homeModel.innerHTML = '<option value="">All Models</option>';
        this.homeModel.disabled = true;
        return;
      }
      const models = Array.from(new Set(
        this.vehicles
          .filter(v => this.titleCase(v.make) === make)
          .map(v => this.titleCase(v.model))
          .filter(Boolean)
      )).sort((a, b) => a.localeCompare(b));
      this.homeModel.innerHTML = ['<option value="">All Models</option>', ...models.map(m => `<option value="${this.escapeAttr(m)}">${this.escapeHtml(m)}</option>`)].join('');
      this.homeModel.disabled = false;
    };

    this.homeMake.addEventListener('change', updateModels);
    updateModels();

    this.homeSearchBtn.addEventListener('click', () => {
      const make = this.homeMake.value.trim();
      const model = (this.homeModel && !this.homeModel.disabled) ? this.homeModel.value.trim() : '';
      const maxPrice = this.homeMaxPrice ? this.homeMaxPrice.value.trim() : '';

      const params = new URLSearchParams();
      if (make) params.set('make', make);
      if (model) params.set('model', model);
      if (maxPrice) params.set('maxPrice', maxPrice);

      // Go to inventory page with filters applied
      const url = `/inventory${params.toString() ? '?' + params.toString() : ''}`;
      window.location.href = url;
    });
  }

  initFeaturedGrid() {
    if (!this.featuredGrid) return;

    // Priority 1: vehicles explicitly marked as featured
    let featured = this.vehicles.filter(v => v.featured === true);

    // Priority 2: fallback to last 5 by dateAdded if none featured
    if (featured.length === 0) {
      featured = [...this.vehicles].sort((a, b) => {
        const dateA = a.dateAdded ? new Date(a.dateAdded) : new Date(0);
        const dateB = b.dateAdded ? new Date(b.dateAdded) : new Date(0);
        return dateB - dateA;
      });
    }

    // Limit to 5
    featured = featured.slice(0, 5);

    if (featured.length === 0) {
      this.featuredGrid.innerHTML = '<p style="text-align:center;color:#999;grid-column:1/-1;">No vehicles available.</p>';
      return;
    }

    this.featuredGrid.innerHTML = featured.map(v => this.createFeaturedCard(v)).join('');
    this.bindImageFallbacks(this.featuredGrid);
  }

  createFeaturedCard(v) {
    const make = this.titleCase(v.make);
    const model = this.titleCase(v.model);
    const yearMake = `${v.year || ''} ${make}`.trim();
    const href = this.buildVDPUrl(v);

    const mainImage = (v.images && v.images.length) ? v.images[0] : '';

    const isLocal = mainImage && !mainImage.startsWith('http') && !mainImage.startsWith('blob:');
    const imgHtml = mainImage
      ? `<img src="${this.escapeAttr(this.resolveImageUrl(mainImage))}" alt="${this.escapeAttr(yearMake + ' ' + model)}" loading="lazy"${isLocal ? ` data-local-image="${this.escapeAttr(mainImage)}"` : ''}>`
      : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#666;background:#e9e9e9;">
           <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
             <rect x="3" y="7" width="18" height="10" rx="2"></rect>
             <circle cx="7.5" cy="17.5" r="1.3"></circle>
             <circle cx="16.5" cy="17.5" r="1.3"></circle>
           </svg>
         </div>`;

    return `
      <a class="featured-card" href="${href}">
        <div class="featured-img">
          ${imgHtml}
          <span class="featured-badge">Shop Online</span>
        </div>
        <div class="featured-body">
          <p class="featured-ymm">${this.escapeHtml(yearMake)}</p>
          <p class="featured-model">${this.escapeHtml(model)}</p>
          ${v.price ? `<p class="featured-price">${this.formatMoney(v.price)}</p>` : ''}
        </div>
      </a>
    `;
  }

  renderPopularSections() {
    if (!this.popBody && !this.popMakes && !this.popMakeModels) return;
    if (!this.vehicles || this.vehicles.length === 0) return;

    // Body styles: use v.type (car/truck/suv/diesel) but display nicer labels
    const typeLabel = (t) => {
      const type = String(t || '').toLowerCase();
      if (type === 'truck' || type.includes('pickup')) return 'Pickup Trucks';
      if (type === 'suv' || type.includes('crossover')) return 'SUVs';
      if (type === 'car' || type.includes('sedan')) return 'Cars';
      if (type === 'diesel') return 'Diesel Vehicles';
      return this.titleCase(type || 'Other');
    };

    const typeCounts = this.countBy(this.vehicles, v => (v.type || '').toString().toLowerCase().trim() || 'other');
    const makeCounts = this.countBy(this.vehicles, v => this.titleCase(v.make));
    const makeModelCounts = this.countBy(this.vehicles, v => {
      const mk = this.titleCase(v.make);
      const md = this.titleCase(v.model);
      return (mk && md) ? `${mk}||${md}` : '';
    });

    const topTypes = this.topEntries(typeCounts, 9).map(([key, count]) => ({
      label: `${typeLabel(key)} (${count})`,
      href: `/inventory?type=${encodeURIComponent(key)}`,
      typeKey: key
    }));

    const topMakes = this.topEntries(makeCounts, 12).map(([key, count]) => ({
      label: `${key} (${count})`,
      href: `/inventory?make=${encodeURIComponent(key)}`
    }));

    const topMakeModels = this.topEntries(makeModelCounts, 20).map(([key, count]) => {
      const parts = String(key).split('||');
      const mk = parts[0] || '';
      const model = parts[1] || '';
      const href = `/inventory?make=${encodeURIComponent(mk)}&model=${encodeURIComponent(model)}`;
      return { label: `${mk} ${model} (${count})`.trim(), href };
    });

    if (this.popBody) {
      const iconFn = typeof window.getVehicleIconSVG === 'function' ? window.getVehicleIconSVG : null;
      this.popBody.innerHTML = topTypes.map(i => {
        const icon = iconFn ? iconFn(i.typeKey, 28, 'currentColor') : '';
        return `<a href="${i.href}">${icon ? icon + ' ' : ''}${this.escapeHtml(i.label)}</a>`;
      }).join('');
    }
    if (this.popMakes) this.popMakes.innerHTML = topMakes.map(i => `<a href="${i.href}">${this.escapeHtml(i.label)}</a>`).join('');
    if (this.popMakeModels) this.popMakeModels.innerHTML = topMakeModels.map(i => `<a href="${i.href}">${this.escapeHtml(i.label)}</a>`).join('');
  }

  countBy(arr, keyFn) {
    const map = new Map();
    arr.forEach(item => {
      const k = keyFn(item);
      if (!k) return;
      map.set(k, (map.get(k) || 0) + 1);
    });
    return map;
  }

  topEntries(map, limit = 10) {
    return Array.from(map.entries())
      .sort((a, b) => (b[1] - a[1]) || String(a[0]).localeCompare(String(b[0])))
      .slice(0, limit);
  }

  escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  escapeAttr(str) {
    // safe for attributes
    return this.escapeHtml(str).replace(/`/g, '&#96;');
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const loader = new InventoryLoader();

  // Always attempt to load inventory; modules activate only if their DOM exists
  await loader.loadInventory();
  loader.initHomeModules();

  // ===== Optional legacy filter controls (only if present) =====
  const filterMake  = document.getElementById('filterMake');
  const filterType  = document.getElementById('filterCategory') || document.getElementById('filterType');
  const filterPrice = document.getElementById('filterPrice');
  const searchBtn   = document.getElementById('searchBtn');

  const applyFilters = () => {
    if (!loader.grid) return;
    const make  = filterMake ? filterMake.value : 'all';
    const type  = filterType ? filterType.value : 'all';
    const price = filterPrice ? filterPrice.value : 'all';

    const TRUCK_MODELS = /f-?150|f-?250|f-?350|silverado|sierra|tundra|tacoma|ram\s*1500|ram\s*2500|ram\s*3500|gladiator|ranger|colorado|canyon|titan|frontier|2500|3500/i;
    const SUV_MODELS = /suburban|tahoe|bronco|explorer|expedition|4runner|highlander|pathfinder|pilot|traverse|blazer|equinox|qx80|qx60|santa\s*fe|wrangler|cherokee|durango|sequoia/i;
    const CAR_MODELS = /camaro|corvette|mustang|challenger|charger|altima|civic|accord|corolla|camry|jetta|xjl|portfolio|impala|malibu|maxima|sentra/i;
    const normalizeType = (t, v) => {
      const raw = String(t || '').toLowerCase().trim();
      if (raw === 'truck' || raw === 'pickup') return 'truck';
      if (raw === 'suv' || raw === 'crossover') return 'suv';
      if (raw === 'car' || raw === 'sedan' || raw === 'coupe') return 'car';
      if (raw === 'diesel') return 'diesel';
      if (v) {
        const model = (v.model || '') + ' ' + (v.trim || '');
        if (TRUCK_MODELS.test(model)) return 'truck';
        if (SUV_MODELS.test(model)) return 'suv';
        if (CAR_MODELS.test(model)) return 'car';
      }
      return raw;
    };
    const filtered = loader.vehicles.filter(v => {
      const matchesMake  = (make === 'all' || !make) ? true : (String(v.make || '').toLowerCase() === String(make).toLowerCase());
      const vType = normalizeType(v.type, v);
      const matchesType  = (type === 'all' || !type) ? true : (vType === String(type).toLowerCase() || (String(type).toLowerCase() === 'diesel' && (v.fuelType || '').toLowerCase() === 'diesel'));
      const matchesPrice = (price === 'all' || !price) ? true : (loader.getPriceRange(v.price) === price);
      return matchesMake && matchesType && matchesPrice;
    });

    const sorted = loader.getMostRecent(filtered);
    loader.renderVehicles(sorted);
  };

  if (searchBtn) searchBtn.addEventListener('click', applyFilters);
  if (filterMake) filterMake.addEventListener('change', applyFilters);
  if (filterType) filterType.addEventListener('change', applyFilters);
  if (filterPrice) filterPrice.addEventListener('change', applyFilters);

  // ===== Auto-fill financing form fields from URL params (used by "Apply for This Vehicle" links) =====
  const params = new URLSearchParams(window.location.search);
  const vehicleParam = params.get('vehicle');
  const stockParam   = params.get('stock');
  const priceParam   = params.get('price');

  if (vehicleParam) {
    const vehicleField = document.getElementById('vehicleInterest') || document.getElementById('vehicle');
    if (vehicleField) vehicleField.value = vehicleParam;
  }
  if (stockParam) {
    const stockField = document.getElementById('vinInterest') || document.getElementById('vin_interest');
    if (stockField) stockField.value = stockParam;
  }
  if (priceParam) {
    const priceField = document.getElementById('vehiclePrice');
    if (priceField) priceField.value = priceParam;
  }

  if (window.location.hash === '#applications') {
    const target = document.getElementById('applications');
    if (target) setTimeout(() => target.scrollIntoView({ behavior: 'smooth' }), 300);
  }
});
