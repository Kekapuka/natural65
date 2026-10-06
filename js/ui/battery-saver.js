// =====================================================================
// Режим экономии батареи
//
// Включённый режим: GPS опрашивается раз в 40 секунд вместо
// непрерывного слежения, сетка 100 м не рисуется.
// При заряде ниже 20 % (где браузер это сообщает) один раз
// предлагаем включить режим.
// =====================================================================

import { t } from '../i18n/i18n.js';
import { getItem, setItem } from '../core/storage.js';
import { showToast } from './toast.js';
import { track, EVENTS } from '../analytics/analytics.js';

const LOW_BATTERY_LEVEL = 0.2;

export function setupBatterySaver(button, { locator, gridToggle }) {
  let on = getItem('batterySaver') === 'on';

  function apply() {
    button.setAttribute('aria-pressed', String(on));
    locator.setSaver(on);
    gridToggle.setSuspended(on);
  }

  button.addEventListener('click', () => {
    on = !on;
    setItem('batterySaver', on ? 'on' : 'off');
    track(EVENTS.batterySaverToggle, { on });
    apply();
    showToast(t(on ? 'saver.enabled' : 'saver.disabled'));
  });

  apply();

  // Battery Status API есть не во всех браузерах (нет в Safari и Firefox)
  navigator.getBattery?.().then((battery) => {
    let suggested = false;
    const check = () => {
      if (!on && !suggested && !battery.charging && battery.level <= LOW_BATTERY_LEVEL) {
        suggested = true;
        showToast(t('saver.suggest'), { duration: 10000 });
      }
    };
    battery.addEventListener('levelchange', check);
    check();
  }).catch(() => {});
}
