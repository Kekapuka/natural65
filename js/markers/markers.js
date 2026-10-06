// =====================================================================
// Загрузка и отображение одобренных меток
//
// Весь пользовательский текст выводится через textContent и
// DOM-атрибуты — никакого innerHTML, поэтому HTML из описания метки
// не исполнится, даже если обойдёт проверки на сервере.
// =====================================================================

import { t } from '../i18n/i18n.js';
import { safeColor, safeHttpsUrl } from '../core/sanitize.js';
import { isInsideBounds } from '../map/map.js';
import { showToast } from '../ui/toast.js';

const FALLBACK_COLOR = '#4F5E51';
const SHARED_ZOOM = 14;

export async function fetchApproved(url) {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`approved: HTTP ${response.status}`);
  return response.json();
}

export function categoryLabel(slug) {
  const key = `category.${slug}`;
  const label = t(key);
  return label === key ? slug : label;
}

// Каждой метке нужен свой экземпляр иконки: Leaflet вставляет
// HTMLElement из divIcon в DOM как есть, и общий элемент «переезжал» бы.
export function createPinIcon({ color, iconUrl = null, extraClass = '' }) {
  const pin = document.createElement('div');
  pin.className = `pin ${extraClass}`.trim();
  pin.style.setProperty('--pin-color', color);
  if (iconUrl) {
    const img = document.createElement('img');
    img.className = 'pin__icon';
    img.src = iconUrl;
    img.alt = '';
    img.decoding = 'async';
    pin.append(img);
  }
  return L.divIcon({
    html: pin,
    className: 'pin-anchor',
    iconSize: [36, 44],
    iconAnchor: [18, 44],
    popupAnchor: [0, -40],
  });
}

function createActionButton(label, onClick, primary = false) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `btn ${primary ? 'btn--primary' : 'btn--ghost'} marker-popup__action`;
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

function createPopupContent(marker, lat, lon, actions) {
  const article = document.createElement('article');
  article.className = 'marker-popup';

  const category = document.createElement('p');
  category.className = 'marker-popup__category';
  category.textContent = categoryLabel(marker.category);

  const title = document.createElement('h2');
  title.className = 'marker-popup__title';
  title.textContent = marker.title;

  article.append(category, title);

  if (marker.description) {
    const text = document.createElement('p');
    text.className = 'marker-popup__text';
    text.textContent = marker.description;
    article.append(text);
  }

  const coords = document.createElement('p');
  coords.className = 'marker-popup__coords';
  coords.textContent = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  article.append(coords);

  const target = { id: Number(marker.id), title: marker.title, category: marker.category, lat, lng: lon };
  const buttons = document.createElement('div');
  buttons.className = 'marker-popup__actions';
  if (actions.onRoute) {
    buttons.append(createActionButton(t('marker.route'), () => actions.onRoute(target), true));
  }
  if (actions.onShare) {
    buttons.append(createActionButton(t('marker.share'), () => actions.onShare(target)));
  }
  if (buttons.childElementCount) article.append(buttons);

  return article;
}

// actions: { onRoute(target), onShare(target) } — кнопки в карточке метки
export function renderMarkers(data, actions = {}) {
  const categories = new Map();
  for (const category of data.categories ?? []) {
    categories.set(category.slug, {
      color: safeColor(category.color, FALLBACK_COLOR),
      iconUrl: safeHttpsUrl(category.icon_url),
    });
  }

  const group = L.layerGroup();
  const byId = new Map();

  for (const marker of data.markers ?? []) {
    const lat = Number(marker.latitude);
    const lon = Number(marker.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    const category = categories.get(marker.category) ?? { color: FALLBACK_COLOR, iconUrl: null };
    const icon = createPinIcon({
      color: category.color,
      iconUrl: safeHttpsUrl(marker.icon_url) ?? category.iconUrl,
    });

    const layer = L.marker([lat, lon], { icon, title: String(marker.title ?? '') });
    layer.bindPopup(() => createPopupContent(marker, lat, lon, actions), { maxWidth: 300 });
    layer.addTo(group);
    byId.set(Number(marker.id), layer);
  }

  return { group, byId };
}

// Открытие ссылки «поделиться»: ?id=123 или ?lat=46.95&lon=142.73
export function openSharedLocation(map, byId, bounds) {
  const params = new URLSearchParams(window.location.search);

  const id = params.get('id');
  if (id !== null && /^[1-9]\d*$/.test(id)) {
    const layer = byId.get(Number(id));
    if (layer) {
      map.setView(layer.getLatLng(), SHARED_ZOOM);
      layer.openPopup();
      return;
    }
    showToast(t('markers.notFound'));
  }

  const lat = Number.parseFloat(params.get('lat'));
  const lng = Number.parseFloat(params.get('lon'));
  if (Number.isFinite(lat) && Number.isFinite(lng) && isInsideBounds({ lat, lng }, bounds)) {
    map.setView([lat, lng], SHARED_ZOOM);
  }
}
