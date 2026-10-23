importScripts('https://storage.googleapis.com/workbox-cdn/releases/6.5.4/workbox-sw.js');

const CACHE_VERSION = 'v231026_4';
const CURRENT_CACHES = {
  html: `html-cache-${CACHE_VERSION}`,
  static: `static-resources-${CACHE_VERSION}`,
  images: `image-cache-${CACHE_VERSION}`,
  cdn: 'cdn-cache'
};

self.addEventListener('install', () => {
  // Take control immediately without waiting for tabs to close
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    // Wipe all previous outdated caches immediately
    caches.keys().then((cacheNames) => {
      const validCaches = Object.values(CURRENT_CACHES);
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (!validCaches.includes(cacheName)) {
            console.log('[SW] Purging outdated cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

if (workbox) {
  console.log('Workbox is loaded');

  // 1. HTML Documents: NetworkFirst
  // Always fetches fresh HTML from the network so app/form link updates appear instantly without clearing history.
  // Falls back to offline cache ONLY if network is down or takes > 3 seconds.
  workbox.routing.registerRoute(
    ({request}) => request.destination === 'document',
    new workbox.strategies.NetworkFirst({
      cacheName: CURRENT_CACHES.html,
      networkTimeoutSeconds: 3,
      plugins: [
        new workbox.cacheableResponse.CacheableResponsePlugin({
          statuses: [0, 200],
        }),
      ],
    })
  );

  // 2. Local app scripts and styles: NetworkFirst
  // Ensures local code updates (db-helper.js, etc.) apply immediately
  workbox.routing.registerRoute(
    ({request, url}) => (request.destination === 'script' || request.destination === 'style') && url.origin === self.location.origin,
    new workbox.strategies.NetworkFirst({
      cacheName: CURRENT_CACHES.static,
      networkTimeoutSeconds: 3,
    })
  );

  // 3. Images: CacheFirst with 30-day expiration
  workbox.routing.registerRoute(
    ({request}) => request.destination === 'image',
    new workbox.strategies.CacheFirst({
      cacheName: CURRENT_CACHES.images,
      plugins: [
        new workbox.expiration.ExpirationPlugin({
          maxEntries: 100,
          maxAgeSeconds: 30 * 24 * 60 * 60, // 30 Days
        }),
      ],
    })
  );

  // 4. External CDNs (Tailwind, Firebase, Fonts, SheetJS, etc.)
  workbox.routing.registerRoute(
    ({url}) => url.origin === 'https://unpkg.com' || 
               url.origin === 'https://cdn.tailwindcss.com' || 
               url.origin === 'https://cdnjs.cloudflare.com' || 
               url.origin === 'https://cdn.sheetjs.com' ||
               url.origin === 'https://fonts.googleapis.com' ||
               url.origin === 'https://fonts.gstatic.com' ||
               url.origin === 'https://www.gstatic.com',
    new workbox.strategies.StaleWhileRevalidate({
      cacheName: CURRENT_CACHES.cdn,
    })
  );

} else {
  console.log('Workbox failed to load');
}
