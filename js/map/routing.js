// =====================================================================
// Маршрут от пользователя до выбранной метки
//
// Всегда (и без интернета): линия по прямой, расстояние, направление
// по компасу и примерное время для трёх режимов по средней скорости.
// При связи: маршрут по дорогам и тропам для выбранного режима через
// /api/route (OpenRouteService). Если рядом нет дорог — остаётся путь
// по прямой. Оставшееся расстояние и время пересчитываются при каждом
// обновлении GPS.
// =====================================================================

import { t } from '../i18n/i18n.js';
import { getItem, setItem } from '../core/storage.js';
import { showToast } from '../ui/toast.js';

export const MODES = ['foot', 'bike', 'car'];

// Средняя скорость для оценки без дорожного маршрута, км/ч.
// Пешком — с поправкой на бездорожье.
const SPEED_KMH = { foot: 4, bike: 12, car: 50 };
const ARRIVAL_RADIUS_M = 30;
const EARTH_RADIUS_M = 6371008.8;
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

const ROUTE_STYLE = { color: '#2E5E7E', weight: 6, opacity: 0.9, interactive: false };
const STRAIGHT_STYLE = { color: '#234826', weight: 3, dashArray: '8 8', interactive: false };
const CONNECTOR_STYLE = { color: '#2E5E7E', weight: 3, dashArray: '4 8', interactive: false };

// ---------------------------------------------------------------------
// Геометрия и форматирование
// ---------------------------------------------------------------------

const toRad = (deg) => deg * Math.PI / 180;

export function distanceMeters([lat1, lon1], [lat2, lon2]) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function bearingDegrees([lat1, lon1], [lat2, lon2]) {
  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
            Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

export function formatDistance(meters) {
  if (meters < 1000) return t('units.m', { value: Math.round(meters / 10) * 10 || Math.round(meters) });
  const km = meters / 1000;
  const value = km.toLocaleString(document.documentElement.lang || 'ru', {
    maximumFractionDigits: km < 10 ? 1 : 0,
  });
  return t('units.km', { value });
}

export function formatDuration(seconds) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return t('units.min', { value: minutes });
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? t('units.hMin', { h: hours, min: rest }) : t('units.h', { value: hours });
}

function compassLabel(degrees) {
  return t(`dir.${COMPASS[Math.round(degrees / 45) % 8]}`);
}

function cumulativeLengths(geometry) {
  const lengths = [0];
  for (let i = 1; i < geometry.length; i++) {
    lengths.push(lengths[i - 1] + distanceMeters(geometry[i - 1], geometry[i]));
  }
  return lengths;
}

// Сколько осталось по дорожному маршруту: ближайшая к пользователю
// вершина линии + отрезок до неё
function remainingOnRoute(route, position) {
  let nearest = 0;
  let nearestDistance = Infinity;
  route.geometry.forEach((point, i) => {
    const d = distanceMeters(position, point);
    if (d < nearestDistance) {
      nearestDistance = d;
      nearest = i;
    }
  });
  const total = route.lengths[route.lengths.length - 1];
  const meters = total - route.lengths[nearest] + nearestDistance;
  const seconds = route.distance > 0 ? route.duration * (meters / route.distance) : 0;
  return { meters, seconds };
}

// ---------------------------------------------------------------------
// Панель маршрута
// ---------------------------------------------------------------------

export function createRouting(map, config, locator, panel) {
  const titleEl = panel.querySelector('[data-route-title]');
  const straightEl = panel.querySelector('[data-route-straight]');
  const noteEl = panel.querySelector('[data-route-note]');
  const modeButtons = [...panel.querySelectorAll('[data-mode]')];

  const straightLine = L.polyline([], STRAIGHT_STYLE);
  const roadLine = L.polyline([], ROUTE_STYLE);
  const connectors = L.polyline([], CONNECTOR_STYLE);

  let target = null;
  let mode = MODES.includes(getItem('routeMode')) ? getItem('routeMode') : 'foot';
  let routes = new Map(); // mode → { status, distance, duration, geometry, lengths }
  let unsubscribe = null;
  let fitted = false;
  let arrived = false;
  let drawnKey = '';
  const controllers = new Set();

  // Поднимаем кнопки карты над панелью
  const resizeObserver = new ResizeObserver(() => {
    document.body.style.setProperty('--bottom-inset', panel.hidden ? '0px' : `${panel.offsetHeight}px`);
  });
  resizeObserver.observe(panel);

  function setLayer(layer, on) {
    if (on && !map.hasLayer(layer)) layer.addTo(map);
    if (!on && map.hasLayer(layer)) map.removeLayer(layer);
  }

  function draw(position) {
    const route = routes.get(mode);
    const key = `${mode}:${route?.status}`;
    const from = [position.lat, position.lng];
    const to = [target.lat, target.lng];

    if (route?.status === 'ok') {
      if (drawnKey !== key) roadLine.setLatLngs(route.geometry);
      const geometry = route.geometry;
      connectors.setLatLngs([[from, geometry[0]], [geometry[geometry.length - 1], to]]);
      setLayer(roadLine, true);
      setLayer(connectors, true);
      setLayer(straightLine, false);
    } else {
      straightLine.setLatLngs([from, to]);
      setLayer(straightLine, true);
      setLayer(roadLine, false);
      setLayer(connectors, false);
    }
    drawnKey = key;
  }

  function render() {
    if (!target) return;
    const position = locator.getLast();

    modeButtons.forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
    });

    if (!position) {
      straightEl.textContent = t('route.waitingGps');
      modeButtons.forEach((button) => {
        button.querySelector('[data-value]').textContent = '—';
      });
      noteEl.hidden = true;
      return;
    }

    const from = [position.lat, position.lng];
    const to = [target.lat, target.lng];
    const straight = distanceMeters(from, to);
    const bearing = bearingDegrees(from, to);

    if (straight <= ARRIVAL_RADIUS_M && !arrived) {
      arrived = true;
      showToast(t('route.arrived'), { type: 'success' });
    }

    straightEl.textContent = t('route.straight', {
      distance: formatDistance(straight),
      direction: compassLabel(bearing),
      degrees: Math.round(bearing),
    });

    modeButtons.forEach((button) => {
      const buttonMode = button.dataset.mode;
      const route = routes.get(buttonMode);
      // Расстояние и время — на разных строках (white-space: pre-line)
      let text;
      if (route?.status === 'ok') {
        const { meters, seconds } = remainingOnRoute(route, from);
        text = `${formatDistance(meters)}\n${formatDuration(seconds)}`;
      } else {
        const seconds = straight / (SPEED_KMH[buttonMode] * 1000 / 3600);
        text = t('route.approx', { value: `${formatDistance(straight)}\n${formatDuration(seconds)}` });
      }
      button.querySelector('[data-value]').textContent = text;
    });

    const status = routes.get(mode)?.status;
    const notes = {
      loading: 'route.loading',
      none: 'route.noRoads',
      offline: 'route.offline',
      error: 'route.error',
    };
    noteEl.textContent = notes[status] ? t(notes[status]) : '';
    noteEl.hidden = !notes[status];

    draw(position);
  }

  async function ensureRoute(routeMode, position) {
    if (routes.has(routeMode)) return;
    if (!navigator.onLine) {
      routes.set(routeMode, { status: 'offline' });
      return;
    }

    routes.set(routeMode, { status: 'loading' });
    const forTarget = target;
    const controller = new AbortController();
    controllers.add(controller);
    const params = new URLSearchParams({
      from: `${position.lat.toFixed(5)},${position.lng.toFixed(5)}`,
      to: `${target.lat.toFixed(5)},${target.lng.toFixed(5)}`,
      mode: routeMode,
    });

    let result;
    try {
      const response = await fetch(`${config.api.route}?${params}`, { signal: controller.signal });
      if (response.status === 200) {
        const data = await response.json();
        result = { status: 'ok', ...data, lengths: cumulativeLengths(data.geometry) };
      } else {
        result = { status: response.status === 422 ? 'none' : 'error' };
      }
    } catch (err) {
      if (err?.name === 'AbortError') return;
      result = { status: navigator.onLine ? 'error' : 'offline' };
    } finally {
      controllers.delete(controller);
    }

    if (target !== forTarget) return;
    routes.set(routeMode, result);
    render();
  }

  function onPosition(position) {
    if (!target) return;
    if (!fitted) {
      fitted = true;
      const bounds = L.latLngBounds([[position.lat, position.lng], [target.lat, target.lng]]);
      map.fitBounds(bounds, {
        paddingTopLeft: [40, 80],
        paddingBottomRight: [40, panel.offsetHeight + 40],
        maxZoom: 16,
      });
    }
    ensureRoute(mode, position);
    render();
  }

  function abortRequests() {
    controllers.forEach((controller) => controller.abort());
    controllers.clear();
  }

  function open(marker) {
    abortRequests();
    target = marker;
    routes = new Map();
    fitted = false;
    arrived = false;
    drawnKey = '';

    titleEl.textContent = marker.title;
    panel.hidden = false;
    document.body.classList.add('has-route');
    map.closePopup();

    locator.ensureActive();
    unsubscribe ??= locator.subscribe(onPosition);
    const position = locator.getLast();
    if (position) onPosition(position);
    else render();
  }

  function close() {
    abortRequests();
    target = null;
    panel.hidden = true;
    document.body.classList.remove('has-route');
    document.body.style.setProperty('--bottom-inset', '0px');
    [straightLine, roadLine, connectors].forEach((layer) => setLayer(layer, false));
    unsubscribe?.();
    unsubscribe = null;
  }

  modeButtons.forEach((button) => {
    button.addEventListener('click', () => {
      mode = button.dataset.mode;
      setItem('routeMode', mode);
      const position = locator.getLast();
      if (position && target) ensureRoute(mode, position);
      render();
    });
  });
  panel.querySelector('[data-route-close]').addEventListener('click', close);

  return { open, close };
}
