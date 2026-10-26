// Bump this version whenever offline.html changes. Business data and app
// bundles are never cached here, so deployments cannot serve stale sessions.
const CACHE_PREFIX = 'makivue-offline-'
const CACHE_NAME = `${CACHE_PREFIX}v1`
const OFFLINE_URL = '/offline.html'

self.addEventListener('install', event => {
    event.waitUntil(
        caches
            .open(CACHE_NAME)
            .then(cache => cache.add(new Request(OFFLINE_URL, { cache: 'reload' })))
            .then(() => self.skipWaiting())
    )
})

self.addEventListener('activate', event => {
    event.waitUntil(
        caches
            .keys()
            .then(keys => Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map(key => caches.delete(key))))
            .then(() => self.clients.claim())
    )
})

self.addEventListener('fetch', event => {
    const { request } = event
    const url = new URL(request.url)
    if (request.method !== 'GET' || request.mode !== 'navigate' || url.origin !== self.location.origin || /^\/(?:api|_next)(?:\/|$)/.test(url.pathname)) return

    event.respondWith(
        fetch(request).catch(async () => {
            const offline = await caches.match(OFFLINE_URL, { cacheName: CACHE_NAME })
            return offline || Response.error()
        })
    )
})
