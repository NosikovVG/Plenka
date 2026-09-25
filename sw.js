/* Service Worker — кеширование оболочки приложения и модели ИИ.
   Позволяет работать оффлайн после первого запуска.
   Для обновления версии приложения — поднять CACHE_VERSION. */

const CACHE_VERSION = 'plenka-v3.0.0';
const CACHE_SHELL = 'plenka-shell';
const CACHE_MODELS = 'plenka-models';

// Файлы оболочки — кешируются сразу при установке
const SHELL_FILES = [
  './',
  './index.html',
  './manifest.json'
];

// Установка — кешируем оболочку
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_SHELL).then(cache =>
      cache.addAll(SHELL_FILES).catch(err => {
        console.warn('SW: shell caching partial fail', err);
      })
    ).then(() => self.skipWaiting())
  );
});

// Активация — чистим старые кеши
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

// Перехват запросов
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  // Пропускаем только GET
  if (req.method !== 'GET') return;

  // Внешние домены (Supabase, unpkg) — не кешируем, идём в сеть
  if (url.origin !== self.location.origin) return;

  // Модели ИИ — cache-first, они неизменны
  if (url.pathname.includes('/models/')) {
    event.respondWith(cacheFirst(req, CACHE_MODELS));
    return;
  }

  // Библиотеки в /lib/ — cache-first
  if (url.pathname.includes('/lib/')) {
    event.respondWith(cacheFirst(req, CACHE_SHELL));
    return;
  }

  // index.html и корень — network-first, чтобы обновления подхватывались
  if (url.pathname.endsWith('/') || url.pathname.endsWith('index.html')) {
    event.respondWith(networkFirst(req, CACHE_SHELL));
    return;
  }

  // Остальное — stale-while-revalidate
  event.respondWith(staleWhileRevalidate(req, CACHE_SHELL));
});

// === Стратегии ===

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const resp = await fetch(request);
    if (resp && resp.status === 200) cache.put(request, resp.clone());
    return resp;
  } catch (e) {
    return cached || new Response('Оффлайн', { status: 503 });
  }
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

// Сообщения от страницы (например, «обновить кеш модели»)
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});