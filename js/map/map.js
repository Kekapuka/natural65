// =====================================================================
// Создание карты Leaflet
// =====================================================================

import { t } from '../i18n/i18n.js';

export function createMap(element, config) {
  const { center, zoom, minZoom, maxZoom } = config.map;
  const { latMin, latMax, lonMin, lonMax } = config.bounds;

  const map = L.map(element, {
    center,
    zoom,
    minZoom,
    maxZoom,
    zoomControl: false,
    // Не даём «улететь» далеко от Сахалина, но оставляем запас по краям
    maxBounds: L.latLngBounds([latMin - 1.5, lonMin - 3], [latMax + 1.5, lonMax + 3]),
    maxBoundsViscosity: 0.8,
  });

  L.control.zoom({
    position: 'bottomright',
    zoomInTitle: t('map.zoomIn'),
    zoomOutTitle: t('map.zoomOut'),
  }).addTo(map);
  L.control.scale({ position: 'bottomleft', imperial: false }).addTo(map);

  return map;
}

export function isInsideBounds(latlng, bounds) {
  const { lat, lng } = latlng;
  return lat >= bounds.latMin && lat <= bounds.latMax &&
         lng >= bounds.lonMin && lng <= bounds.lonMax;
}
