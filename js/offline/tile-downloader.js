// =====================================================================
// Скачивание карты Сахалина для работы без интернета
//
// Файл PMTiles целиком кладётся в Cache Storage (кэш offline-tiles)
// потоком — без загрузки 100 МБ в память. Дальше sw.js отдаёт из него
// диапазоны, которые запрашивает слой «Природа».
// =====================================================================

import { notifyServiceWorker } from './sw-register.js';

export const TILES_CACHE = 'offline-tiles';

export class QuotaError extends Error {}

export function isOfflineSupported() {
  return 'caches' in window && 'serviceWorker' in navigator && 'ReadableStream' in window;
}

function absoluteUrl(url) {
  return new URL(url, window.location.origin).href;
}

// Дата сборки из имени файла: sakhalin-20261006.pmtiles → Date
export function buildDate(url) {
  const match = /(\d{4})(\d{2})(\d{2})\.pmtiles$/.exec(url);
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
}

// { state: 'none' | 'ready' | 'outdated', storedUrl }
export async function getOfflineStatus(tilesConfig) {
  if (!isOfflineSupported()) return { state: 'none', storedUrl: null };
  const cache = await caches.open(TILES_CACHE);
  const keys = await cache.keys();
  if (keys.length === 0) return { state: 'none', storedUrl: null };
  const current = absoluteUrl(tilesConfig.url);
  const hasCurrent = keys.some((request) => request.url === current);
  return {
    state: hasCurrent ? 'ready' : 'outdated',
    storedUrl: hasCurrent ? current : keys[0].url,
  };
}

async function ensureSpace(bytes) {
  // Просим не вычищать данные при нехватке места (особенно важно в Safari)
  await navigator.storage?.persist?.().catch(() => false);
  const estimate = await navigator.storage?.estimate?.().catch(() => null);
  if (estimate?.quota && estimate.quota - (estimate.usage ?? 0) < bytes * 1.1) {
    throw new QuotaError();
  }
}

export async function downloadTiles(tilesConfig, { onProgress, signal } = {}) {
  const url = absoluteUrl(tilesConfig.url);
  await ensureSpace(tilesConfig.sizeBytes);

  const response = await fetch(url, { signal, cache: 'no-store' });
  if (!response.ok || !response.body) {
    throw new Error(`tiles download: HTTP ${response.status}`);
  }

  const total = Number(response.headers.get('Content-Length')) || tilesConfig.sizeBytes;
  let loaded = 0;
  onProgress?.(loaded, total);

  const counted = response.body.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      loaded += chunk.byteLength;
      onProgress?.(loaded, total);
      controller.enqueue(chunk);
    },
  }));

  const headers = new Headers({ 'Content-Type': 'application/octet-stream' });
  const etag = response.headers.get('ETag');
  if (etag) headers.set('ETag', etag);

  const cache = await caches.open(TILES_CACHE);
  try {
    await cache.put(url, new Response(counted, { headers }));
  } catch (err) {
    if (err?.name === 'QuotaExceededError') throw new QuotaError();
    throw err;
  }

  // Старые сборки больше не нужны
  for (const request of await cache.keys()) {
    if (request.url !== url) await cache.delete(request);
  }
  notifyServiceWorker({ type: 'tiles-changed' });
}

export async function deleteTiles() {
  await caches.delete(TILES_CACHE);
  notifyServiceWorker({ type: 'tiles-changed' });
}
