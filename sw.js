const CACHE_NAME = 'rsvp-reader-v5';
const urlsToCache = [
    './',
    './index.html',
    './css/styles.css',
    './js/app.js',
    './js/storage.js',
    './js/library.js',
    './js/reader.js',
    './js/normal-reader.js',
    './js/search.js',
    './js/epub-parser.js',
    './js/firebase-config.js',
    './js/firebase-sync.js',
    './manifest.json'
];

// Install
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(urlsToCache))
            .then(() => self.skipWaiting())
    );
});

// Activate
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// Fetch — network-first for app files, cache-fallback for offline
self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') return;

    const url = new URL(event.request.url);

    // Skip CDN requests
    if (url.hostname !== location.hostname) return;

    event.respondWith(
        fetch(event.request)
            .then(response => {
                if (!response || response.status !== 200) {
                    return response;
                }
                // Update cache with fresh response
                const responseToCache = response.clone();
                caches.open(CACHE_NAME)
                    .then(cache => cache.put(event.request, responseToCache));
                return response;
            })
            .catch(() => {
                // Network failed — serve from cache (offline support)
                return caches.match(event.request)
                    .then(response => {
                        if (response) return response;
                        // If navigation request, serve cached index
                        if (event.request.mode === 'navigate') {
                            return caches.match('./index.html');
                        }
                        return new Response('Offline', { status: 503 });
                    });
            })
    );
});
