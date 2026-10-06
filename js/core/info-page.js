// =====================================================================
// Точка входа справочника (info.html): язык, перевод, Service Worker
// =====================================================================

import { initI18n, detectLang } from '../i18n/i18n.js';
import { registerServiceWorker } from '../offline/sw-register.js';
import { setupLanguageSwitchers } from '../ui/language-switcher.js';
import { initAnalytics } from '../analytics/analytics.js';

registerServiceWorker();

initI18n(detectLang()).then(() => {
  setupLanguageSwitchers();
  initAnalytics();
});
