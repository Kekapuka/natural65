// =====================================================================
// Местоположение пользователя на карте
//
// enableHighAccuracy: true просит у устройства спутниковый приёмник
// (GPS/ГЛОНАСС). Он работает без интернета и без вышек связи —
// браузер не может запретить системе подмешивать Wi-Fi и вышки,
// но там, где их нет, координаты даёт только спутниковый модуль.
//
// Обычный режим — непрерывное слежение (watchPosition).
// Экономия батареи — отдельный запрос раз в 40 секунд.
// Последняя точка сохраняется — её показывает экран SOS.
// =====================================================================

import { t } from '../i18n/i18n.js';
import { setItem } from '../core/storage.js';
import { showToast, hideToast } from '../ui/toast.js';
import { track, EVENTS } from '../analytics/analytics.js';

const LIVE_OPTIONS = { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 };
const SAVER_OPTIONS = { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 };
const SAVER_INTERVAL_MS = 40000;
const FOLLOW_MIN_ZOOM = 15;
const DOT_COLOR = '#2E5E7E';

export const LAST_POSITION_KEY = 'lastPosition';

export function createLocator(map, button) {
  const dot = L.circleMarker([0, 0], {
    radius: 8,
    color: '#FFFEFB',
    weight: 3,
    fillColor: DOT_COLOR,
    fillOpacity: 1,
    interactive: false,
  });
  const accuracyCircle = L.circle([0, 0], {
    radius: 1,
    color: DOT_COLOR,
    weight: 1,
    fillColor: DOT_COLOR,
    fillOpacity: 0.12,
    interactive: false,
  });

  let active = false;
  let following = false;
  let saver = false;
  let watchId = null;
  let timer = null;
  let last = null;
  let errorShown = false;
  const listeners = new Set();

  function render() {
    button.setAttribute('aria-pressed', String(active));
    button.dataset.follow = String(active && following);
  }

  function onPosition(position) {
    const { latitude, longitude, accuracy } = position.coords;
    const latlng = [latitude, longitude];
    last = { lat: latitude, lng: longitude, accuracy, timestamp: position.timestamp };
    setItem(LAST_POSITION_KEY, JSON.stringify(last));
    hideToast(t('gps.searching'));
    if (errorShown) hideToast(t('gps.noSignal'));
    errorShown = false;

    dot.setLatLng(latlng);
    accuracyCircle.setLatLng(latlng).setRadius(accuracy);
    if (!map.hasLayer(dot)) {
      accuracyCircle.addTo(map);
      dot.addTo(map);
    }
    if (following) {
      map.setView(latlng, Math.max(map.getZoom(), FOLLOW_MIN_ZOOM));
    }
    listeners.forEach((listener) => listener(last));
  }

  function onError(error) {
    if (error.code === error.PERMISSION_DENIED) {
      showToast(t('gps.denied'), { type: 'error', duration: 8000 });
      stop();
      return;
    }
    // Нет сигнала или тайм-аут — продолжаем пытаться, сообщаем один раз
    if (!errorShown) {
      showToast(t('gps.noSignal'), { type: 'error', duration: 8000 });
      errorShown = true;
    }
  }

  function requestOnce() {
    navigator.geolocation.getCurrentPosition(onPosition, onError, SAVER_OPTIONS);
  }

  function startTracking() {
    stopTracking();
    if (saver) {
      requestOnce();
      timer = setInterval(requestOnce, SAVER_INTERVAL_MS);
    } else {
      watchId = navigator.geolocation.watchPosition(onPosition, onError, LIVE_OPTIONS);
    }
  }

  function stopTracking() {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    clearInterval(timer);
    watchId = null;
    timer = null;
  }

  function start({ follow = true } = {}) {
    if (!('geolocation' in navigator)) {
      showToast(t('gps.unsupported'), { type: 'error' });
      return;
    }
    active = true;
    following = follow;
    track(EVENTS.gpsEnable, { source: follow ? 'button' : 'route' });
    if (last && follow) map.setView([last.lat, last.lng], Math.max(map.getZoom(), FOLLOW_MIN_ZOOM));
    else if (!last) showToast(t('gps.searching'));
    startTracking();
    render();
  }

  function stop() {
    active = false;
    following = false;
    stopTracking();
    map.removeLayer(dot);
    map.removeLayer(accuracyCircle);
    render();
  }

  // Нажатие: включить → (карта сдвинута) вернуться к себе → выключить
  button.addEventListener('click', () => {
    if (!active) {
      start();
    } else if (!following) {
      following = true;
      if (last) map.setView([last.lat, last.lng], Math.max(map.getZoom(), FOLLOW_MIN_ZOOM));
      render();
    } else {
      stop();
    }
  });

  // Пользователь сам двигает карту — перестаём центрировать
  map.on('dragstart', () => {
    if (following) {
      following = false;
      render();
    }
  });

  // В фоне GPS не нужен — экономим батарею
  document.addEventListener('visibilitychange', () => {
    if (!active) return;
    if (document.hidden) stopTracking();
    else startTracking();
  });

  render();

  return {
    setSaver(on) {
      saver = on;
      if (active && !document.hidden) startTracking();
    },
    // Включить GPS, не перехватывая управление картой (для маршрута)
    ensureActive() {
      if (!active) start({ follow: false });
    },
    getLast() {
      return last;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
