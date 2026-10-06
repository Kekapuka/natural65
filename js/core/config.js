// =====================================================================
// Настройки фронтенда
// =====================================================================

export const config = {
  api: {
    approved: '/api/markers/approved',
    submit: '/api/markers/submit',
    route: '/api/route',
  },

  // Слой «Природа»: векторные тайлы Сахалина из сборки Protomaps
  // (данные OpenStreetMap, лицензия ODbL), один файл PMTiles.
  // Этот же файл целиком скачивается для офлайн-режима.
  // Дата сборки в имени файла — версия: при смене URL скачанная
  // карта помечается устаревшей. Файл готовит scripts/extract-tiles.js.
  // В продакшене url — адрес в своём хранилище (например, Cloudflare R2).
  tiles: {
    url: '/tiles/sakhalin-20261006.pmtiles',
    sizeBytes: 97827366,
    maxDataZoom: 15,
    flavor: 'light',
  },

  // Публичный ключ JavaScript API Яндекс Карт (developer.tech.yandex.ru).
  // В кабинете разработчика ограничьте его по HTTP Referer доменом сайта.
  // Пустая строка — слой Яндекса выключен.
  yandexMapsApiKey: '',

  map: {
    center: [50.0, 142.8],
    zoom: 7,
    minZoom: 6,
    maxZoom: 18,
  },

  // Совпадает с CHECK в public.markers и api/markers/submit.js
  bounds: { latMin: 45.8, latMax: 54.5, lonMin: 141.5, lonMax: 145.0 },

  limits: { titleMin: 3, titleMax: 80, descriptionMax: 1000 },

  // Запасной список, если категории не пришли из /api/markers/approved
  fallbackCategories: [
    { slug: 'fishing',   color: '#2E5E7E' },
    { slug: 'berries',   color: '#8E2F45' },
    { slug: 'mushrooms', color: '#6E4F32' },
    { slug: 'camp',      color: '#234826' },
    { slug: 'viewpoint', color: '#8A6220' },
    { slug: 'hazard',    color: '#B3261E' },
    { slug: 'other',     color: '#4F5E51' },
  ],
};
