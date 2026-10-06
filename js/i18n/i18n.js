// =====================================================================
// Локализация: 6 языков (RU, EN, ZH, JA, KO, ES)
//
// Строки лежат в /locales/<lang>.json. Элементы с атрибутами
//   data-i18n             → textContent
//   data-i18n-placeholder → placeholder
//   data-i18n-title       → title
//   data-i18n-aria-label  → aria-label
// переводятся автоматически. В HTML остаётся русский текст —
// он виден, если словарь не загрузился, и его индексируют поисковики.
// Если в словаре языка нет ключа, берётся русская строка.
//
// Язык выбирается так: ?lang= в адресе → выбор пользователя →
// языки браузера → русский. Смена языка перезагружает страницу
// с ?lang= — так одинаково переводятся и разметка, и всё, что
// уже нарисовано скриптами (карта, карточки, панели).
// =====================================================================

import { getItem, setItem } from '../core/storage.js';

export const LANGS = ['ru', 'en', 'zh', 'ja', 'ko', 'es'];
export const DEFAULT_LANG = 'ru';
export const LANG_NAMES = {
  ru: 'Русский',
  en: 'English',
  zh: '中文',
  ja: '日本語',
  ko: '한국어',
  es: 'Español',
};

const STORAGE_KEY = 'lang';

let messages = {};

export function detectLang() {
  const fromUrl = new URLSearchParams(window.location.search).get('lang');
  if (LANGS.includes(fromUrl)) {
    setItem(STORAGE_KEY, fromUrl);
    return fromUrl;
  }
  const saved = getItem(STORAGE_KEY);
  if (LANGS.includes(saved)) return saved;
  for (const tag of navigator.languages ?? [navigator.language]) {
    const base = String(tag).toLowerCase().split('-')[0];
    if (LANGS.includes(base)) return base;
  }
  return DEFAULT_LANG;
}

async function loadDictionary(lang) {
  const response = await fetch(`/locales/${lang}.json`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

export async function initI18n(lang = detectLang()) {
  const target = LANGS.includes(lang) ? lang : DEFAULT_LANG;
  try {
    const [base, own] = await Promise.all([
      loadDictionary(DEFAULT_LANG),
      target === DEFAULT_LANG ? null : loadDictionary(target).catch((err) => {
        console.warn(`i18n: словарь "${target}" недоступен, остаётся русский`, err);
        return null;
      }),
    ]);
    messages = { ...base, ...own };
    document.documentElement.lang = own || target === DEFAULT_LANG ? target : DEFAULT_LANG;
    translateDom();
  } catch (err) {
    console.warn('i18n: не удалось загрузить словарь', err);
  }
  return document.documentElement.lang;
}

export function currentLang() {
  return document.documentElement.lang || DEFAULT_LANG;
}

export function t(key, params) {
  let text = Object.hasOwn(messages, key) ? messages[key] : key;
  if (params) {
    text = text.replace(/\{(\w+)\}/g, (match, name) =>
      Object.hasOwn(params, name) ? String(params[name]) : match);
  }
  return text;
}

// Меняем только то, что отличается: перезапись того же текста создаёт
// новый текстовый узел — лишняя перерисовка и сдвиг метрики LCP
export function translateDom(root = document) {
  const apply = (attr, get, set) => {
    root.querySelectorAll(`[data-${attr}]`).forEach((el) => {
      const key = el.getAttribute(`data-${attr}`);
      if (Object.hasOwn(messages, key) && get(el) !== messages[key]) set(el, messages[key]);
    });
  };
  apply('i18n', (el) => el.textContent, (el, text) => { el.textContent = text; });
  apply('i18n-placeholder', (el) => el.placeholder, (el, text) => { el.placeholder = text; });
  apply('i18n-title', (el) => el.title, (el, text) => { el.title = text; });
  apply('i18n-aria-label', (el) => el.getAttribute('aria-label'), (el, text) => { el.setAttribute('aria-label', text); });
}

// Сменить язык: запомнить и перезагрузить страницу с ?lang=
export function switchLanguage(lang) {
  if (!LANGS.includes(lang)) return;
  setItem(STORAGE_KEY, lang);
  const url = new URL(window.location.href);
  if (lang === DEFAULT_LANG) url.searchParams.delete('lang');
  else url.searchParams.set('lang', lang);
  window.location.replace(url.href);
}
