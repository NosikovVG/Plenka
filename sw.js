const CACHE = 'plenka-v7';

const CDN = [
  'https://unpkg.com/sql.js@1.10.3/dist/sql-wasm.js',
  'https://unpkg.com/sql.js@1.10.3/dist/sql-wasm.wasm',
  'https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js',
  'https://unpkg.com/@supabase/supabase-js@2'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(CDN).catch(() => null))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // CDN — cache first (библиотеки грузятся из кеша)
  if (url.hostname === 'unpkg.com') {
    e.respondWith(
      caches.match(req).then(r => r || fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
        return res;
      }).catch(() => r))
    );
    return;
  }

  // Supabase — только сеть, данные всегда свежие
  if (url.hostname.includes('supabase')) return;

  // Свои файлы (index.html, manifest, sw) — network first, fallback cache
  if (url.origin === self.location.origin) {
    e.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req))
    );
  }
});