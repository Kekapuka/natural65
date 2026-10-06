// =====================================================================
// Priroda65 — Service Worker
//
//   Оболочка приложения (HTML, CSS, JS, словари, библиотеки из assets/vendor)
//     — предзагружается при установке, отдаётся stale-while-revalidate.
//   /api/markers/approved
//     — network-first: свежие метки при связи, последние сохранённые без неё.
//   *.pmtiles (слой «Природа»)
//     — если файл скачан кнопкой «Офлайн-карта» (кэш offline-tiles),
//       диапазоны Range отдаются из него; иначе запрос идёт в сеть.
//   Остальное (/api/markers/submit, Яндекс) — без вмешательства.
//
// При изменении оболочки увеличьте VERSION — старый кэш удалится.
// =====================================================================

const VERSION = 'v3';
const SHELL_CACHE = `shell-${VERSION}`;
const DATA_CACHE = 'data-v1';
const TILES_CACHE = 'offline-tiles'; // заполняет js/offline/tile-downloader.js

// Полноту списка проверяет scripts/check-sw-assets.js — запускайте его
// после добавления или переименования файлов
const SHELL_ASSETS = [
  '/',
  '/sos',
  '/info',
  '/manifest.webmanifest',
  '/assets/css/base.css',
  '/assets/css/components.css',
  '/assets/css/map.css',
  '/assets/css/onboarding.css',
  '/assets/css/sos.css',
  '/assets/css/info.css',
  '/assets/img/icons/icon-96.webp',
  '/assets/img/icons/icon-192.webp',
  '/assets/img/icons/icon-192.png',
  '/assets/img/icons/icon-512.png',
  '/locales/ru.json',
  '/locales/en.json',
  '/locales/zh.json',
  '/locales/ja.json',
  '/locales/ko.json',
  '/locales/es.json',
  '/js/core/app.js',
  '/js/core/info-page.js',
  '/js/core/config.js',
  '/js/core/sanitize.js',
  '/js/core/storage.js',
  '/js/i18n/i18n.js',
  '/js/analytics/analytics.js',
  '/js/ui/language-switcher.js',
  '/js/map/map.js',
  '/js/map/layers.js',
  '/js/map/geolocation.js',
  '/js/map/grid.js',
  '/js/map/routing.js',
  '/js/map/share-link.js',
  '/js/markers/markers.js',
  '/js/markers/submit-form.js',
  '/js/offline/sw-register.js',
  '/js/offline/tile-downloader.js',
  '/js/offline/offline-panel.js',
  '/js/ui/toast.js',
  '/js/ui/battery-saver.js',
  '/js/ui/onboarding.js',
  '/js/ui/sos.js',
  '/assets/vendor/leaflet.min.css',
  '/assets/vendor/leaflet.min.js',
  '/assets/vendor/leaflet-yandex.js',
  '/assets/vendor/protomaps-leaflet.js',
];

const SHELL_URLS = new Set(SHELL_ASSETS.map((path) => new URL(path, self.location.origin).href));

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // mode: 'cors' — на случай внешних файлов в списке: непрозрачный
    // ответ нельзя проверить и отдать странице с integrity
    await cache.addAll(SHELL_ASSETS.map((url) => new Request(url, { mode: 'cors' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key.startsWith('shell-') && key !== SHELL_CACHE)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'tiles-changed') tilesBlobCache.clear();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.pathname.endsWith('.pmtiles')) {
    event.respondWith(serveTiles(request));
    return;
  }

  if (url.origin === self.location.origin && url.pathname === '/api/markers/approved') {
    event.respondWith(networkFirst(request, DATA_CACHE));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(navigation(request));
    return;
  }

  if (SHELL_URLS.has(url.href)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});

// ---------------------------------------------------------------------
// Стратегии
// ---------------------------------------------------------------------

async function navigation(request) {
  try {
    return await fetch(request);
  } catch {
    return (await caches.match(request, { ignoreSearch: true })) ||
           (await caches.match('/'));
  }
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err;
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request, { ignoreVary: true });
  const refresh = fetch(new Request(request.url, { mode: 'cors' }))
    .then((response) => {
      if (response.ok) cache.put(request.url, response.clone());
      return response;
    })
    .catch(() => null);
  if (cached) return cached;
  return (await refresh) || Response.error();
}

// ---------------------------------------------------------------------
// Тайлы из скачанного файла PMTiles
// Библиотека pmtiles читает файл диапазонами (заголовок Range) и ждёт
// ответ 206 с Content-Length и тем же ETag, что был у первого ответа.
// ---------------------------------------------------------------------

const tilesBlobCache = new Map(); // url → { blob, etag }

async function getStoredTiles(url) {
  if (tilesBlobCache.has(url)) return tilesBlobCache.get(url);
  const cache = await caches.open(TILES_CACHE);
  const response = await cache.match(url);
  if (!response) return null;
  const entry = { blob: await response.blob(), etag: response.headers.get('ETag') };
  tilesBlobCache.set(url, entry);
  return entry;
}

async function serveTiles(request) {
  const url = request.url.split('#')[0];
  const stored = await getStoredTiles(url);
  if (!stored) return fetch(request);

  const { blob, etag } = stored;
  const size = blob.size;
  const headers = new Headers({
    'Content-Type': 'application/octet-stream',
    'Accept-Ranges': 'bytes',
  });
  if (etag) headers.set('ETag', etag);

  const range = request.headers.get('Range');
  if (!range) {
    headers.set('Content-Length', String(size));
    return new Response(blob, { status: 200, headers });
  }

  const match = /^bytes=(\d+)-(\d*)$/.exec(range.trim());
  const start = match ? Number(match[1]) : NaN;
  const end = match && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (!Number.isFinite(start) || start >= size || start > end) {
    headers.set('Content-Range', `bytes */${size}`);
    return new Response(null, { status: 416, headers });
  }

  headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
  headers.set('Content-Length', String(end - start + 1));
  return new Response(blob.slice(start, end + 1), { status: 206, headers });
}
