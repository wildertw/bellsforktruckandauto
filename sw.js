// Service Worker — Bells Fork Truck & Auto
// Stale-while-revalidate for static assets, network-first for API calls
// Cache version is updated automatically by the build pipeline (stamp-versions.js)

const CACHE_NAME = 'bfat-vmmvg7opo';
const PRECACHE = [
  '/',
  '/style.min.css',
  '/assets/vendor/bootstrap.min.css',
  '/assets/logo.webp',
  '/assets/logo.png',
  '/assets/favicon.png',
  '/assets/hero/storefront-hero-opt.webp',
  '/assets/hero/shop-front-mobile.webp',
  '/assets/hero/shop-front-tablet.webp',
  '/assets/hero/shop-front-desktop.webp',
];

// Strip query params from a URL for cache matching (so ?v=xxx still matches)
function stripQuery(url) {
  const u = new URL(url);
  u.search = '';
  return u.href;
}

// Install — precache core assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE))
  );
  self.skipWaiting();
});

// Activate — clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch — stale-while-revalidate for most, network-only for API
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET and Netlify function calls
  if (event.request.method !== 'GET') return;
  if (url.pathname.startsWith('/.netlify/functions')) return;
  if (url.pathname.startsWith('/admin')) return;

  // For HTML pages: network-first with cache fallback
  if (event.request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // For static assets: stale-while-revalidate
  // Use stripped-query URL for cache matching so versioned requests hit cache
  event.respondWith(
    caches.open(CACHE_NAME).then((cache) => {
      const cacheKey = stripQuery(event.request.url);
      return cache.match(cacheKey).then((cached) => {
        const networkFetch = fetch(event.request)
          .then((response) => {
            if (response.ok) {
              // Store under the query-stripped key so future versions still get a cache hit
              cache.put(cacheKey, response.clone());
            }
            return response;
          })
          .catch(() => cached);

        return cached || networkFetch;
      });
    })
  );
});
