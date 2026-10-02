/* ============================================================
   SMARTFIX (OLD APP) — ROOT SERVICE WORKER
   Scope   : /billing-software/
   Purpose : Offline-first caching for the OLD billing app
   Isolated: Does NOT handle any request inside /pos/ subfolder
   Version : v6.0.0
   ============================================================ */

const CACHE_NAME = 'smartfix-core-v6';
const RUNTIME_CACHE = 'smartfix-core-runtime-v6';

/* Files to pre-cache on install (relative to root scope) */
const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  'https://cdn-icons-png.flaticon.com/512/2920/2920329.png',
  'https://cdn.tailwindcss.com',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/html5-qrcode/2.3.8/html5-qrcode.min.js'
];

/* ---------- INSTALL ---------- */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // addAll fails if ANY url fails; use allSettled so a single CDN
      // hiccup won't break the entire SW installation
      return Promise.allSettled(
        PRECACHE_URLS.map((url) => cache.add(url).catch(() => null))
      );
    }).then(() => self.skipWaiting())
  );
});

/* ---------- ACTIVATE ---------- */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME && key !== RUNTIME_CACHE)
          .map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

/* ---------- FETCH ---------- */
self.addEventListener('fetch', (event) => {
  // Only GET requests
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Ignore browser extensions
  if (url.protocol === 'chrome-extension:') return;

  // 🔒 CRITICAL: Never handle anything inside /pos/ — that folder has
  // its own dedicated service worker with its own scope & cache.
  if (url.pathname.includes('/pos/')) {
    return; // let the browser / pos-sw.js handle it
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      // 1. Return cached response immediately if available
      if (cachedResponse) {
        // Silently refresh cache in the background (stale-while-revalidate)
        fetch(event.request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              caches.open(RUNTIME_CACHE).then((cache) => {
                cache.put(event.request, networkResponse.clone());
              });
            }
          })
          .catch(() => { /* offline — ignore */ });

        return cachedResponse;
      }

      // 2. Not in cache → fetch from network
      return fetch(event.request)
        .then((networkResponse) => {
          // Cache successful same-origin responses
          if (
            networkResponse &&
            networkResponse.status === 200 &&
            networkResponse.type !== 'opaque'
          ) {
            const responseClone = networkResponse.clone();
            caches.open(RUNTIME_CACHE).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          // 3. Network failed → serve fallback page for navigations
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
          // For API / asset requests, return a minimal offline response
          return new Response('Offline — SmartFix', {
            status: 503,
            statusText: 'Offline',
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
          });
        });
    })
  );
});

/* ---------- MESSAGE (SKIP WAITING) ---------- */
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
