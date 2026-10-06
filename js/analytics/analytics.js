// =====================================================================
// Аналитика: тонкий слой над Яндекс Метрикой и Google Analytics 4
//
// Код приложения вызывает только track(EVENTS.x, params) и не знает,
// какие счётчики подключены. Счётчики включаются переменными Vercel
// YANDEX_METRIKA_ID и GA_MEASUREMENT_ID (приходят из /api/config) —
// без правки JS. Если ни одна не задана, события никуда не уходят.
//
// Приватность:
//   — в события не передаём координаты, тексты меток и иные данные,
//     по которым можно узнать человека или его местоположение;
//   — Вебвизор и карта кликов Метрики выключены;
//   — при включённых в браузере Do Not Track / Global Privacy Control
//     счётчики не загружаются вовсе.
// =====================================================================

export const EVENTS = {
  offlineDownloadClick: 'offline_download_click',
  offlineDownloadDone: 'offline_download_done',
  languageSwitch: 'language_switch',
  sosOpen: 'sos_open',
  markerSubmit: 'marker_submit',
  markerShare: 'marker_share',
  routeOpen: 'route_open',
  gpsEnable: 'gps_enable',
  batterySaverToggle: 'battery_saver_toggle',
  onboardingAccept: 'onboarding_accept',
};

const METRIKA_SRC = 'https://mc.yandex.ru/metrika/tag.js';
const GA_SRC = 'https://www.googletagmanager.com/gtag/js';

const MAX_QUEUE = 100;
const queue = []; // события до загрузки настроек
const sinks = [];
let started = false;
let ready = false;

function privacyOptOut() {
  return navigator.doNotTrack === '1' || window.doNotTrack === '1' || navigator.globalPrivacyControl === true;
}

function loadScript(src) {
  const script = document.createElement('script');
  script.async = true;
  script.src = src;
  document.head.append(script);
}

function setupMetrika(id) {
  window.ym = window.ym || function ym(...args) {
    (window.ym.a = window.ym.a || []).push(args);
  };
  window.ym.l = Date.now();
  loadScript(METRIKA_SRC);
  window.ym(id, 'init', {
    clickmap: false,
    webvisor: false,
    trackLinks: true,
    accurateTrackBounce: true,
  });
  sinks.push((name, params) => window.ym(id, 'reachGoal', name, params));
}

function setupGoogle(id) {
  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function gtag() {
    window.dataLayer.push(arguments); // gtag ждёт именно объект arguments
  };
  loadScript(`${GA_SRC}?id=${encodeURIComponent(id)}`);
  window.gtag('js', new Date());
  window.gtag('config', id, { allow_google_signals: false, allow_ad_personalization_signals: false });
  sinks.push((name, params) => window.gtag('event', name, params));
}

export async function initAnalytics() {
  if (started) return;
  started = true;
  if (privacyOptOut()) {
    queue.length = 0;
    ready = true;
    return;
  }

  let settings = {};
  if (navigator.onLine) {
    try {
      const response = await fetch('/api/config');
      if (response.ok) settings = (await response.json()).analytics ?? {};
    } catch {
      // нет функции или сеть пропала — работаем без счётчиков
    }
  }

  const { yandexMetrikaId, gaMeasurementId } = settings;
  if (yandexMetrikaId && /^\d{5,12}$/.test(String(yandexMetrikaId))) setupMetrika(Number(yandexMetrikaId));
  if (gaMeasurementId && /^G-[A-Z0-9]{4,16}$/.test(gaMeasurementId)) setupGoogle(gaMeasurementId);

  ready = true;
  queue.splice(0).forEach(([name, params]) => send(name, params));
}

function send(name, params) {
  sinks.forEach((sink) => {
    try {
      sink(name, params);
    } catch (err) {
      console.warn('analytics: send failed', err);
    }
  });
}

export function track(name, params = {}) {
  // Для отладки и автотестов: события видны и без подключённых счётчиков
  window.dispatchEvent(new CustomEvent('priroda65:track', { detail: { name, params } }));
  if (ready) send(name, params);
  else if (queue.length < MAX_QUEUE) queue.push([name, params]);
}
