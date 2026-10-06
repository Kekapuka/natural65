// =====================================================================
// Базовые слои и переключатель «Природа / Город»
//
// Природа — векторные тайлы Protomaps (данные OSM) из одного файла
// PMTiles, рисуются в Leaflet через protomaps-leaflet. Слой по
// умолчанию; после скачивания файла работает без интернета (sw.js).
// Город — настоящая карта Яндекс JS API 2.1 под Leaflet через плагин
// leaflet-plugins/Yandex.js. API весит ~1 МБ, поэтому грузится
// только при первом выборе слоя и только если задан ключ.
// =====================================================================

import { t } from '../i18n/i18n.js';
import { getItem, setItem } from '../core/storage.js';
import { showToast } from '../ui/toast.js';

const NATURE_ATTRIBUTION =
  '<a href="https://protomaps.com">Protomaps</a> ' +
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const YANDEX_API_URL = 'https://api-maps.yandex.ru/2.1/';

let yandexApiPromise = null;

function loadYandexApi(apiKey) {
  if (window.ymaps) return new Promise((resolve, reject) => window.ymaps.ready(resolve, reject));
  if (!yandexApiPromise) {
    yandexApiPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      // JS API Яндекса знает русский и английский; для остальных — английский
      const lang = document.documentElement.lang === 'ru' ? 'ru_RU' : 'en_US';
      const params = new URLSearchParams({ apikey: apiKey, lang });
      script.src = `${YANDEX_API_URL}?${params}`;
      script.async = true;
      script.onload = () => window.ymaps.ready(resolve, reject);
      script.onerror = () => reject(new Error('Yandex Maps API failed to load'));
      document.head.append(script);
    }).catch((err) => {
      yandexApiPromise = null; // разрешаем повторную попытку
      throw err;
    });
  }
  return yandexApiPromise;
}

// tilesUrl — какой файл PMTiles показывать: обычно config.tiles.url,
// но если на устройстве лежит старая скачанная сборка — она, чтобы
// карта открывалась без интернета до обновления.
export function setupLayerSwitcher(map, config, container, tilesUrl = config.tiles.url) {
  const createNature = (url) => protomapsL.leafletLayer({
    url,
    flavor: config.tiles.flavor,
    lang: document.documentElement.lang || 'ru',
    maxDataZoom: config.tiles.maxDataZoom,
    attribution: NATURE_ATTRIBUTION,
  });
  let natureUrl = tilesUrl;
  let nature = createNature(natureUrl);
  let yandex = null;

  const buttons = [...container.querySelectorAll('[data-layer]')];
  const yandexButton = container.querySelector('[data-layer="yandex"]');
  const hasYandex = Boolean(config.yandexMapsApiKey);

  if (!hasYandex) {
    yandexButton.disabled = true;
    yandexButton.title = t('layers.yandexDisabled');
  }

  let current = null;
  let currentName = null;
  let wanted = null;

  function show(layer, name) {
    if (current) map.removeLayer(current);
    layer.addTo(map);
    current = layer;
    currentName = name;
    buttons.forEach((button) =>
      button.setAttribute('aria-pressed', String(button.dataset.layer === name)));
    setItem('layer', name);
  }

  async function select(name) {
    wanted = name;
    if (name === currentName) return;

    if (name !== 'yandex' || !hasYandex) {
      show(nature, 'nature');
      return;
    }

    if (!navigator.onLine) {
      showToast(t('layers.yandexOffline'), { type: 'error' });
      wanted = currentName;
      return;
    }

    yandexButton.setAttribute('aria-busy', 'true');
    try {
      await loadYandexApi(config.yandexMapsApiKey);
      // Пока API грузился, пользователь мог передумать
      if (wanted !== 'yandex') return;
      yandex ??= L.yandex('yandex#map');
      show(yandex, 'yandex');
    } catch (err) {
      console.error(err);
      showToast(t('layers.yandexError'), { type: 'error' });
      show(nature, 'nature');
    } finally {
      yandexButton.removeAttribute('aria-busy');
    }
  }

  buttons.forEach((button) =>
    button.addEventListener('click', () => select(button.dataset.layer)));

  // «Природа» сразу, чтобы карта не была пустой, пока грузится Яндекс
  select('nature');
  if (getItem('layer') === 'yandex' && hasYandex && navigator.onLine) select('yandex');

  return {
    setNatureUrl(url) {
      if (url === natureUrl) return;
      const wasActive = currentName === 'nature';
      if (wasActive) map.removeLayer(nature);
      natureUrl = url;
      nature = createNature(url);
      if (wasActive) {
        current = null;
        currentName = null;
        show(nature, 'nature');
      }
    },
  };
}
