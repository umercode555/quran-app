/* ═══════════════════════════════════════════════════════════════
   Quran AI — Service Worker
   Version: 2.0.0
   Strategy: Cache-first for app shell, Network-first for API calls
   Compatible with PWABuilder + Google Play TWA
   ═══════════════════════════════════════════════════════════════ */

const CACHE_VERSION = 'v2';
const APP_SHELL_CACHE = `quran-ai-shell-${CACHE_VERSION}`;
const RUNTIME_CACHE  = `quran-ai-runtime-${CACHE_VERSION}`;
const API_CACHE      = `quran-ai-api-${CACHE_VERSION}`;

// App shell files to pre-cache on install
const APP_SHELL_FILES = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
  '/icons/icon-maskable-192x192.png',
  '/icons/icon-maskable-512x512.png',
];

// Domains/patterns that should NEVER be intercepted (always go to network)
const BYPASS_PATTERNS = [
  'groq.com',
  'openai.com',
  'anthropic.com',
  'supabase.co',
  'supabase.io',
  'alquran.cloud',
  'api.quran.com',
  'googleapis.com/upload',
  'firebaseio.com',
  'pusher.com',
  'stripe.com',
  'paypal.com',
];

// Domains that should be cached at runtime (fonts, CDN assets)
const CACHEABLE_CDN_PATTERNS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdnjs.cloudflare.com',
  'cdn.jsdelivr.net',
];

// ── INSTALL ──────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  console.log('[SW] Installing…');
  event.waitUntil(
    caches.open(APP_SHELL_CACHE)
      .then((cache) => {
        console.log('[SW] Pre-caching app shell');
        // Use individual adds so one failure doesn't break everything
        return Promise.allSettled(
          APP_SHELL_FILES.map(url =>
            cache.add(new Request(url, { cache: 'reload' }))
              .catch(err => console.warn(`[SW] Failed to cache ${url}:`, err))
          )
        );
      })
      .then(() => self.skipWaiting())
  );
});

// ── ACTIVATE ─────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating…');
  const currentCaches = [APP_SHELL_CACHE, RUNTIME_CACHE, API_CACHE];
  event.waitUntil(
    caches.keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter(name => !currentCaches.includes(name))
            .map(name => {
              console.log('[SW] Deleting old cache:', name);
              return caches.delete(name);
            })
        )
      )
      .then(() => {
        console.log('[SW] Now ready to handle fetches');
        return self.clients.claim();
      })
  );
});

// ── FETCH ─────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle GET requests
  if (request.method !== 'GET') return;

  // Skip non-http(s) requests (chrome-extension://, etc.)
  if (!url.protocol.startsWith('http')) return;

  // Skip bypass patterns — always go to network
  if (BYPASS_PATTERNS.some(p => request.url.includes(p))) return;

  // Same-origin HTML navigations → serve app shell (SPA)
  if (request.mode === 'navigate' && url.origin === self.location.origin) {
    event.respondWith(
      caches.match('/index.html')
        .then(cached => cached || fetch(request))
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // CDN / font files → cache-first, then network, store to runtime
  if (CACHEABLE_CDN_PATTERNS.some(p => request.url.includes(p))) {
    event.respondWith(cacheFirst(request, RUNTIME_CACHE));
    return;
  }

  // Same-origin static assets (JS, CSS, images, fonts) → cache-first
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request, RUNTIME_CACHE));
    return;
  }

  // Everything else → network-first, fall back to cache
  event.respondWith(networkFirst(request, RUNTIME_CACHE));
});

// ── STRATEGIES ────────────────────────────────────────────────────

/** Cache-first: serve from cache if available, else fetch & cache */
async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response && response.status === 200 && response.type !== 'opaque-redirect') {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    console.warn('[SW] Cache-first fetch failed:', request.url, err);
    return new Response('Offline — resource not cached.', {
      status: 503,
      statusText: 'Service Unavailable',
      headers: { 'Content-Type': 'text/plain' },
    });
  }
}

/** Network-first: try network, fall back to cache */
async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;
    console.warn('[SW] Network-first failed + no cache:', request.url, err);
    return new Response('Offline — resource unavailable.', {
      status: 503,
      statusText: 'Service Unavailable',
      headers: { 'Content-Type': 'text/plain' },
    });
  }
}

// ── PUSH NOTIFICATIONS (future-ready) ────────────────────────────
self.addEventListener('push', (event) => {
  if (!event.data) return;
  const data = event.data.json().catch(() => ({ title: 'Quran AI', body: event.data.text() }));
  event.waitUntil(
    data.then(({ title, body, icon, badge }) =>
      self.registration.showNotification(title || 'Quran AI', {
        body: body || '',
        icon: icon || '/icons/icon-192x192.png',
        badge: badge || '/icons/icon-96x96.png',
      })
    )
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((clientList) => {
      if (clientList.length > 0) return clientList[0].focus();
      return clients.openWindow('/');
    })
  );
});

console.log('[SW] Service Worker loaded — Quran AI PWA v2');
