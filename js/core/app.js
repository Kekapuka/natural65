// =====================================================================
// Точка входа главной страницы (index.html)
// =====================================================================

import { config } from './config.js';
import { initI18n, detectLang, t } from '../i18n/i18n.js';
import { createMap } from '../map/map.js';
import { setupLayerSwitcher } from '../map/layers.js';
import { createLocator } from '../map/geolocation.js';
import { createGrid, setupGridToggle } from '../map/grid.js';
import { createRouting } from '../map/routing.js';
import { shareMarker } from '../map/share-link.js';
import { setupBatterySaver } from '../ui/battery-saver.js';
import { isDisclaimerAccepted, runOnboarding } from '../ui/onboarding.js';
import { setupLanguageSwitchers } from '../ui/language-switcher.js';
import { fetchApproved, renderMarkers, openSharedLocation } from '../markers/markers.js';
import { setupSubmitForm } from '../markers/submit-form.js';
import { registerServiceWorker } from '../offline/sw-register.js';
import { getOfflineStatus } from '../offline/tile-downloader.js';
import { setupOfflinePanel } from '../offline/offline-panel.js';
import { initAnalytics, track, EVENTS } from '../analytics/analytics.js';
import { showToast } from '../ui/toast.js';

registerServiceWorker();

async function main() {
  // Метки начинаем грузить сразу, параллельно со словарём
  const markersRequest = fetchApproved(config.api.approved);
  markersRequest.catch(() => {}); // ошибку обработаем ниже, после await

  const [, offlineStatus] = await Promise.all([
    initI18n(detectLang()),
    getOfflineStatus(config.tiles).catch(() => ({ state: 'none', storedUrl: null })),
  ]);
  setupLanguageSwitchers();

  // Если скачана старая сборка карты — показываем её, пока не обновят
  const tilesUrl = offlineStatus.state === 'outdated' ? offlineStatus.storedUrl : config.tiles.url;

  const map = createMap(document.getElementById('map'), config);
  const layers = setupLayerSwitcher(map, config, document.getElementById('layer-switch'), tilesUrl);
  const offlinePanel = setupOfflinePanel(config, { onTilesChanged: (url) => layers.setNatureUrl(url) });

  if (!isDisclaimerAccepted()) {
    runOnboarding({
      onDone: ({ wantsOfflineMap }) => {
        track(EVENTS.onboardingAccept, { offlineMap: wantsOfflineMap });
        if (wantsOfflineMap) offlinePanel.open();
      },
    });
  }

  document.querySelectorAll('[data-sos-link]').forEach((link) => {
    link.addEventListener('click', () => track(EVENTS.sosOpen, { from: link.dataset.sosLink }));
  });

  const locator = createLocator(map, document.getElementById('locate-toggle'));
  const grid = createGrid(map, document.getElementById('grid-legend'));
  const gridToggle = setupGridToggle(document.getElementById('grid-toggle'), grid);
  setupBatterySaver(document.getElementById('saver-toggle'), { locator, gridToggle });

  const routing = createRouting(map, config, locator, document.getElementById('route-panel'));
  const submitForm = setupSubmitForm(map, config);

  let byId = new Map();
  try {
    const data = await markersRequest;
    const rendered = renderMarkers(data, {
      onRoute: (target) => {
        track(EVENTS.routeOpen, { category: target.category });
        routing.open(target);
      },
      onShare: async (target) => {
        const method = await shareMarker(target);
        if (method) track(EVENTS.markerShare, { method, category: target.category });
      },
    });
    rendered.group.addTo(map);
    byId = rendered.byId;
    if (data.categories?.length) submitForm.setCategories(data.categories);
  } catch (err) {
    console.error(err);
    showToast(t('markers.loadError'), { type: 'error' });
  }

  openSharedLocation(map, byId, config.bounds);

  // Счётчики грузим последними — они не должны задерживать карту
  initAnalytics();
}

main();
