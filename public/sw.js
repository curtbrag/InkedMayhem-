// InkedMayhem Service Worker — Offline support & caching
const CACHE_NAME = 'inkedmayhem-v1';
const STATIC_ASSETS = [
    '/',
    '/css/style.css',
    '/js/app.js',
    '/members',
    '/links',
    '/manifest.json'
];

// Install — cache core shell
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(STATIC_ASSETS);
        })
    );
    self.skipWaiting();
});

// Activate — clean old caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
            );
        })
    );
    self.clients.claim();
});

// Fetch — network-first for API, cache-first for static assets
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // Skip non-GET requests
    if (request.method !== 'GET') return;

    // API calls — network only (don't cache dynamic data)
    if (url.pathname.startsWith('/api/')) return;

    // Static assets — stale-while-revalidate
    event.respondWith(
        caches.match(request).then((cached) => {
            const fetchPromise = fetch(request).then((response) => {
                // Cache successful responses
                if (response.ok) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(request, clone);
                    });
                }
                return response;
            }).catch(() => {
                // Network failed — return cached version or offline page
                return cached || new Response('Offline', { status: 503, statusText: 'Offline' });
            });

            // Return cached immediately, update in background
            return cached || fetchPromise;
        })
    );
});
