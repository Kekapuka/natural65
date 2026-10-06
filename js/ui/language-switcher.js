// =====================================================================
// Выпадающий список языков: все элементы [data-lang-select] на странице
// =====================================================================

import { LANGS, LANG_NAMES, currentLang, switchLanguage } from '../i18n/i18n.js';
import { track, EVENTS } from '../analytics/analytics.js';

export function setupLanguageSwitchers(root = document) {
  root.querySelectorAll('[data-lang-select]').forEach((select) => {
    select.textContent = '';
    for (const lang of LANGS) {
      const option = new Option(LANG_NAMES[lang], lang);
      option.lang = lang;
      select.add(option);
    }
    select.value = currentLang();
    select.addEventListener('change', () => {
      track(EVENTS.languageSwitch, { from: currentLang(), to: select.value });
      switchLanguage(select.value);
    });
  });
}
