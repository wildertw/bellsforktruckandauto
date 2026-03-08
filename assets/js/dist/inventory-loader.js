(()=>{var M=class{constructor(e="inventory.json"){this.jsonPath=e,this.vehicles=[],this.grid=document.getElementById("inventoryGrid"),this.limit=this.grid?parseInt(this.grid.getAttribute("data-limit")||"",10):NaN,this.featuredGrid=document.getElementById("featuredGrid"),this.homeMake=document.getElementById("homeMake"),this.homeModel=document.getElementById("homeModel"),this.homeMaxPrice=document.getElementById("homeMaxPrice"),this.homeSearchBtn=document.getElementById("homeSearchBtn"),this.popBody=document.getElementById("popularBodyStyles"),this.popMakes=document.getElementById("popularMakes"),this.popMakeModels=document.getElementById("popularMakeModels")}buildVDPUrl(e){let i=(e.make||"").replace(/[^a-zA-Z0-9]+/g,"-").replace(/^-|-$/g,""),t=(e.model||"").replace(/[^a-zA-Z0-9]+/g,"-").replace(/^-|-$/g,""),a=(e.trim||"").replace(/[^a-zA-Z0-9]+/g,"-").replace(/^-|-$/g,""),s=`Used-${e.year}-${i}-${t}${a?"-"+a:""}-for-sale-in-Greenville-NC-27858`;return`/vdp/${(e.stockNumber||e.vin||e.id||"").toString().replace(/[^a-z0-9]/gi,"")}/${s}/`}async loadInventory(){try{let e=await fetch(this.jsonPath);if(!e.ok)throw new Error("Could not load inventory");let i=await e.json();if(this.vehicles=(i.vehicles||[]).filter(t=>t&&(t.status==="available"||!t.status)),this.grid){let t=this.getMostRecent(this.vehicles);this.renderVehicles(t)}return this.vehicles}catch(e){return console.error("Error loading inventory:",e),this.grid&&this.showError(),[]}}titleCase(e){let i=String(e||"").trim();return i?i.toLowerCase().split(" ").filter(Boolean).map(t=>t.charAt(0).toUpperCase()+t.slice(1)).join(" "):""}formatMoney(e){let i=Number(e);return Number.isFinite(i)?`$${i.toLocaleString()}`:""}resolveImageUrl(e){return e?e.startsWith("http")?e:e.startsWith("blob:")?"photos/"+e.slice(5):"assets/vehicles/"+e:""}getMostRecent(e){let i=[...e].sort((t,a)=>{let s=t.dateAdded?new Date(t.dateAdded):new Date(0);return(a.dateAdded?new Date(a.dateAdded):new Date(0))-s});return isNaN(this.limit)?i:i.slice(0,this.limit)}renderVehicles(e){if(this.grid){if(!e||e.length===0){this.grid.innerHTML='<div class="col-12 text-center py-5"><p class="text-muted">No vehicles found matching your criteria.</p></div>';return}this.grid.innerHTML=e.map(i=>this.createVehicleCard(i)).join(""),this.bindImageFallbacks(this.grid)}}createVehicleCard(e){let i=this.getPriceRange(e.price),t=e.images&&e.images.length>0?e.images[0]:"",a=this.getBadgeClass(e.badge),s=e.features||[],n=`${e.year} ${e.make} ${e.model}${e.trim?" "+e.trim:""}`.trim(),d=`financing.html?tab=financing&vehicle=${encodeURIComponent(n)}&vin=${encodeURIComponent(e.vin||"")}&price=${encodeURIComponent(String(e.price??""))}#applications`,r=`contact.html?vehicle=${encodeURIComponent(n)}&vin=${encodeURIComponent(e.vin||"")}#appointment`,o=e.mpgCity&&e.mpgHighway?`<p class="text-muted small mb-2">\u26FD ${e.mpgCity}/${e.mpgHighway} MPG${e.fuelType?" \xB7 "+e.fuelType:""}</p>`:e.fuelType?`<p class="text-muted small mb-2">${e.fuelType}</p>`:"",l=e.stockNumber?`<span class="badge bg-secondary mb-2">Stock #${e.stockNumber}</span> `:"",p=t&&!t.startsWith("http")&&!t.startsWith("blob:")?` data-local-image="${this.escapeAttr(t)}"`:"";return`
      <div class="col-md-6 col-lg-4" data-type="${e.type||""}" data-price="${i}" data-vehicle-id="${e.vin||e.id||""}">
        <article class="card shadow-soft h-100 inventory-card">
          <div class="inventory-img-wrap">
            ${e.badge?`<span class="inventory-badge ${a}">${e.badge}</span>`:""}
            ${t?`
              <a href="${this.buildVDPUrl(e)}" aria-label="View ${e.year} ${e.make} ${e.model} details">
                <img src="${this.resolveImageUrl(t)}"
                     alt="${e.year} ${e.make} ${e.model}"
                     class="card-img-top"
                     style="height:220px; object-fit:cover;"
                     loading="lazy" decoding="async"
                     onload="this.classList.add('loaded')"${p}>
              </a>
            `:`
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
              <h3 class="h6 fw-bold mb-0"><a href="${this.buildVDPUrl(e)}" class="text-dark text-decoration-none">${e.year} ${e.make} ${e.model}${e.trim?" "+e.trim:""}</a></h3>
              <span class="badge bg-danger ms-2 flex-shrink-0">${this.formatMoney(e.price).replace("$","$")}</span>
            </div>
            <p class="text-muted small mb-2">${e.description||""}</p>
            ${e.mileage?`<p class="text-muted small mb-2"><strong>${Number(e.mileage).toLocaleString()} miles</strong></p>`:""}
            ${o}
            ${l}
            ${s.length>0?`
            <div class="d-flex flex-wrap gap-1 mb-3">
              ${s.slice(0,3).map(u=>`<span class="badge bg-light text-dark border">${u}</span>`).join("")}
            </div>
            `:""}
            <div class="d-grid gap-2 mt-auto">
              <a href="${this.buildVDPUrl(e)}" class="btn btn-sm btn-outline-danger w-100">View Details</a>
              <a href="${d}" class="btn btn-sm btn-danger w-100">Apply for This Vehicle</a>
              <a href="${r}" class="btn btn-sm btn-outline-dark w-100">Inquire About This Vehicle</a>
            </div>
          </div>
        </article>
      </div>
    `}getPriceRange(e){let i=Number(e)||0;return i<1e4?"under10":i<2e4?"10to20":i<3e4?"20to30":"over30"}getBadgeClass(e){let i=(e||"").toLowerCase();return i.includes("sold")?"bg-secondary":i.includes("new")?"bg-success":i.includes("recent")?"bg-danger":"bg-dark"}showError(){this.grid&&(this.grid.innerHTML=`
      <div class="col-12">
        <div class="alert alert-danger" role="alert">
          <strong>Oops!</strong> We couldn't load the inventory right now. Please try again later.
        </div>
      </div>
    `)}buildImageFallbackCandidates(e){let i=String(e||"").trim();if(!i||i.startsWith("http")||i.startsWith("blob:"))return[];let t=[],a=new Set,s=h=>{let c=String(h||"").trim();!c||a.has(c)||(a.add(c),t.push(`assets/vehicles/${c}`))},n=i.match(/^(.+?)(?:\.([a-z0-9]+))?$/i),d=n?n[1]:i,r=n&&n[2]?n[2].toLowerCase():"",o=[],l=new Set,m=h=>{let c=String(h||"").trim();!c||l.has(c)||(l.add(c),o.push(c))};m(d);let p=d.match(/^(.*?)([-_])0([1-9]\d*)$/);if(p){let h=p[1],c=p[2],$=p[3],k=c==="-"?"_":"-";m(`${h}${c}${$}`),m(`${h}${k}${$}`)}let u=d.match(/^(.*?)([-_])([1-9]\d*)$/);if(u){let h=u[1],c=u[2],$=u[3],k=c==="-"?"_":"-",w=$.padStart(2,"0");m(`${h}${c}${w}`),m(`${h}${k}${$}`),m(`${h}${k}${w}`)}let y=[],f=new Set,b=h=>{let c=String(h||"").toLowerCase();!c||f.has(c)||(f.add(c),y.push(c))};return b(r),["png","jpg","jpeg","webp"].forEach(b),o.forEach(h=>{y.forEach(c=>s(`${h}.${c}`))}),t}bindImageFallbacks(e){if(!e)return;e.querySelectorAll("img[data-local-image]").forEach(t=>{let a=t.getAttribute("data-local-image")||"",s=this.buildImageFallbackCandidates(a);if(!s.length)return;let n=0;t.addEventListener("error",()=>{for(;n<s.length;){let d=s[n++];if(!t.src.endsWith(d)){t.src=d;return}}})})}initHomeModules(){this.initHomeSearch(),this.initFeaturedGrid(),this.renderPopularSections()}initHomeSearch(){if(!this.homeMake||!this.homeModel||!this.homeSearchBtn)return;let e=Array.from(new Set(this.vehicles.map(t=>this.titleCase(t.make)).filter(Boolean))).sort((t,a)=>t.localeCompare(a));this.homeMake.innerHTML=['<option value="">All Makes</option>',...e.map(t=>`<option value="${this.escapeAttr(t)}">${this.escapeHtml(t)}</option>`)].join("");let i=()=>{let t=this.homeMake.value.trim();if(!t){this.homeModel.innerHTML='<option value="">All Models</option>',this.homeModel.disabled=!0;return}let a=Array.from(new Set(this.vehicles.filter(s=>this.titleCase(s.make)===t).map(s=>this.titleCase(s.model)).filter(Boolean))).sort((s,n)=>s.localeCompare(n));this.homeModel.innerHTML=['<option value="">All Models</option>',...a.map(s=>`<option value="${this.escapeAttr(s)}">${this.escapeHtml(s)}</option>`)].join(""),this.homeModel.disabled=!1};this.homeMake.addEventListener("change",i),i(),this.homeSearchBtn.addEventListener("click",()=>{let t=this.homeMake.value.trim(),a=this.homeModel&&!this.homeModel.disabled?this.homeModel.value.trim():"",s=this.homeMaxPrice?this.homeMaxPrice.value.trim():"",n=new URLSearchParams;t&&n.set("make",t),a&&n.set("model",a),s&&n.set("maxPrice",s);let d=`/inventory${n.toString()?"?"+n.toString():""}`;window.location.href=d})}initFeaturedGrid(){if(!this.featuredGrid)return;let e=this.vehicles.filter(i=>i.featured===!0);if(e.length===0&&(e=[...this.vehicles].sort((i,t)=>{let a=i.dateAdded?new Date(i.dateAdded):new Date(0);return(t.dateAdded?new Date(t.dateAdded):new Date(0))-a})),e=e.slice(0,5),e.length===0){this.featuredGrid.innerHTML='<p style="text-align:center;color:#999;grid-column:1/-1;">No vehicles available.</p>';return}this.featuredGrid.innerHTML=e.map(i=>this.createFeaturedCard(i)).join(""),this.bindImageFallbacks(this.featuredGrid)}createFeaturedCard(e){let i=this.titleCase(e.make),t=this.titleCase(e.model),a=`${e.year||""} ${i}`.trim(),s=this.buildVDPUrl(e),n=e.images&&e.images.length?e.images[0]:"",d=n&&!n.startsWith("http")&&!n.startsWith("blob:"),r=n?`<img src="${this.escapeAttr(this.resolveImageUrl(n))}" alt="${this.escapeAttr(a+" "+t)}" loading="lazy"${d?` data-local-image="${this.escapeAttr(n)}"`:""}>`:`<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#666;background:#e9e9e9;">
           <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
             <rect x="3" y="7" width="18" height="10" rx="2"></rect>
             <circle cx="7.5" cy="17.5" r="1.3"></circle>
             <circle cx="16.5" cy="17.5" r="1.3"></circle>
           </svg>
         </div>`;return`
      <a class="featured-card" href="${s}">
        <div class="featured-img">
          ${r}
          <span class="featured-badge">Shop Online</span>
        </div>
        <div class="featured-body">
          <p class="featured-ymm">${this.escapeHtml(a)}</p>
          <p class="featured-model">${this.escapeHtml(t)}</p>
          ${e.price?`<p class="featured-price">${this.formatMoney(e.price)}</p>`:""}
        </div>
      </a>
    `}renderPopularSections(){if(!this.popBody&&!this.popMakes&&!this.popMakeModels||!this.vehicles||this.vehicles.length===0)return;let e=r=>{let o=String(r||"").toLowerCase();return o==="truck"||o.includes("pickup")?"Pickup Trucks":o==="suv"||o.includes("crossover")?"SUVs":o==="car"||o.includes("sedan")?"Cars":o==="diesel"?"Diesel Vehicles":this.titleCase(o||"Other")},i=this.countBy(this.vehicles,r=>(r.type||"").toString().toLowerCase().trim()||"other"),t=this.countBy(this.vehicles,r=>this.titleCase(r.make)),a=this.countBy(this.vehicles,r=>{let o=this.titleCase(r.make),l=this.titleCase(r.model);return o&&l?`${o}||${l}`:""}),s=this.topEntries(i,9).map(([r,o])=>({label:`${e(r)} (${o})`,href:`/inventory?type=${encodeURIComponent(r)}`,typeKey:r})),n=this.topEntries(t,12).map(([r,o])=>({label:`${r} (${o})`,href:`/inventory?make=${encodeURIComponent(r)}`})),d=this.topEntries(a,20).map(([r,o])=>{let l=String(r).split("||"),m=l[0]||"",p=l[1]||"",u=`/inventory?make=${encodeURIComponent(m)}&model=${encodeURIComponent(p)}`;return{label:`${m} ${p} (${o})`.trim(),href:u}});if(this.popBody){let r=typeof window.getVehicleIconSVG=="function"?window.getVehicleIconSVG:null;this.popBody.innerHTML=s.map(o=>{let l=r?r(o.typeKey,28,"currentColor"):"";return`<a href="${o.href}">${l?l+" ":""}${this.escapeHtml(o.label)}</a>`}).join("")}this.popMakes&&(this.popMakes.innerHTML=n.map(r=>`<a href="${r.href}">${this.escapeHtml(r.label)}</a>`).join("")),this.popMakeModels&&(this.popMakeModels.innerHTML=d.map(r=>`<a href="${r.href}">${this.escapeHtml(r.label)}</a>`).join(""))}countBy(e,i){let t=new Map;return e.forEach(a=>{let s=i(a);s&&t.set(s,(t.get(s)||0)+1)}),t}topEntries(e,i=10){return Array.from(e.entries()).sort((t,a)=>a[1]-t[1]||String(t[0]).localeCompare(String(a[0]))).slice(0,i)}escapeHtml(e){return String(e??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}escapeAttr(e){return this.escapeHtml(e).replace(/`/g,"&#96;")}};document.addEventListener("DOMContentLoaded",async()=>{let g=new M;await g.loadInventory(),g.initHomeModules();let e=document.getElementById("filterMake"),i=document.getElementById("filterCategory")||document.getElementById("filterType"),t=document.getElementById("filterPrice"),a=document.getElementById("searchBtn"),s=()=>{if(!g.grid)return;let l=e?e.value:"all",m=i?i.value:"all",p=t?t.value:"all",u=g.vehicles.filter(f=>{let b=l==="all"||!l?!0:String(f.make||"").toLowerCase()===String(l).toLowerCase(),h=m==="all"||!m?!0:String(f.type||"").toLowerCase()===String(m).toLowerCase(),c=p==="all"||!p?!0:g.getPriceRange(f.price)===p;return b&&h&&c}),y=g.getMostRecent(u);g.renderVehicles(y)};a&&a.addEventListener("click",s),e&&e.addEventListener("change",s),i&&i.addEventListener("change",s),t&&t.addEventListener("change",s);let n=new URLSearchParams(window.location.search),d=n.get("vehicle"),r=n.get("vin"),o=n.get("price");if(d){let l=document.getElementById("vehicleInterest")||document.getElementById("vehicle");l&&(l.value=d)}if(r){let l=document.getElementById("vinInterest")||document.getElementById("vin_interest");l&&(l.value=r)}if(o){let l=document.getElementById("vehiclePrice");l&&(l.value=o)}if(window.location.hash==="#applications"){let l=document.getElementById("applications");l&&setTimeout(()=>l.scrollIntoView({behavior:"smooth"}),300)}});})();
