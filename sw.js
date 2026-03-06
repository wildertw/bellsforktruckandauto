// Service Worker — Bells Fork Auto & Truck
// Stale-while-revalidate for static assets, network-first for API calls

const CACHE_NAME = 'bfat-v1';
const PRECACHE = [
  '/',
  '/style.min.css',
  '/assets/logo.webp',
  '/assets/logo.png',
  '/assets/favicon.png',
  '/assets/hero/shop-front-mobile.webp',
  '/assets/hero/shop-front-tablet.webp',
  '/assets/hero/shop-front-desktop.webp',
];

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
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkFetch = fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached);

      return cached || networkFetch;
    })
  );
});
