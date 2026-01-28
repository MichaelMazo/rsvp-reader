const CACHE_NAME = 'rsvp-reader-v4';
const urlsToCache = [
    './',
    './index.html',
    './css/styles.css',
    './js/app.js',
    './js/storage.js',
    './js/library.js',
    './js/reader.js',
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

// Fetch
self.addEventListener('fetch', event => {
    // Skip non-GET requests and external URLs
    if (event.request.method !== 'GET') return;

    const url = new URL(event.request.url);

    // Skip CDN requests (let them go to network)
    if (url.hostname !== location.hostname) {
        return;
    }

    event.respondWith(
        caches.match(event.request)
            .then(response => {
                if (response) {
                    return response;
                }
                return fetch(event.request).then(response => {
                    // Don't cache non-successful responses
                    if (!response || response.status !== 200) {
                        return response;
                    }
                    const responseToCache = response.clone();
                    caches.open(CACHE_NAME)
                        .then(cache => cache.put(event.request, responseToCache));
                    return response;
                });
            })
            .then(response => {
                // If navigation request got a 404, serve the cached index instead
                if (response && response.status === 404 && event.request.mode === 'navigate') {
                    return caches.match('./index.html') || response;
                }
                return response;
            })
    );
});
