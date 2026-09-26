const CACHE_VERSION = 'plenka-v4.0.0';
const CACHE_SHELL = 'plenka-shell';
const CACHE_MODELS = 'plenka-models';

const SHELL_FILES = [
  './',
  './index.html',
  './manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_SHELL).then(cache =>
      cache.addAll(SHELL_FILES).catch(err => console.warn('SW: shell caching partial fail', err))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_SHELL && k !== CACHE_MODELS && k !== CACHE_VERSION)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  if (url.pathname.includes('/models/')) { event.respondWith(cacheFirst(req, CACHE_MODELS)); return; }
  if (url.pathname.includes('/lib/'))    { event.respondWith(cacheFirst(req, CACHE_SHELL)); return; }

  if (url.pathname.endsWith('/') || url.pathname.endsWith('index.html')) {
    event.respondWith(networkFirst(req, CACHE_SHELL));
    return;
  }
  event.respondWith(staleWhileRevalidate(req, CACHE_SHELL));
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const resp = await fetch(request);
    if (resp && resp.status === 200) cache.put(request, resp.clone());
    return resp;
  } catch (e) { return cached || new Response('Оффлайн', { status: 503 }); }
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const resp = await fetch(request);
    if (resp && resp.status === 200) cache.put(request, resp.clone());
    return resp;
  } catch (e) {
    const cached = await cache.match(request);
    if (cached) return cached;
    return new Response('Оффлайн', { status: 503 });
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request).then(resp => {
    if (resp && resp.status === 200) cache.put(request, resp.clone());
    return resp;
  }).catch(() => cached);
  return cached || fetchPromise;
}

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});