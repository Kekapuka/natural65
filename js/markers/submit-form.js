// =====================================================================
// Предложение новой метки
//
// Два способа выбрать точку:
//   1. кнопка «Отметить место» → нажатие на карту;
//   2. долгое нажатие (на компьютере — правая кнопка) прямо по карте.
// Затем открывается форма, заявка уходит в /api/markers/submit
// и появляется на карте только после одобрения модератором.
// =====================================================================

import { t } from '../i18n/i18n.js';
import { cleanText } from '../core/sanitize.js';
import { isInsideBounds } from '../map/map.js';
import { showToast } from '../ui/toast.js';
import { track, EVENTS } from '../analytics/analytics.js';
import { createPinIcon, categoryLabel } from './markers.js';

const DRAFT_COLOR = '#234826';

export function setupSubmitForm(map, config) {
  const startButton = document.getElementById('pick-start');
  const hint = document.getElementById('pick-hint');
  const cancelPickButton = document.getElementById('pick-cancel');
  const dialog = document.getElementById('submit-dialog');
  const form = document.getElementById('submit-form');
  const coordsOutput = form.querySelector('[data-coords]');
  const errorBox = form.querySelector('[data-form-error]');
  const submitButton = form.querySelector('[type="submit"]');
  const categorySelect = form.elements.category;

  let picking = false;
  let sending = false;
  let draft = null;

  function setPicking(on) {
    picking = on;
    hint.hidden = !on;
    startButton.hidden = on;
    map.getContainer().classList.toggle('is-picking', on);
  }

  function clearDraft() {
    if (draft) map.removeLayer(draft);
    draft = null;
  }

  function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = false;
  }

  function openForm(latlng) {
    if (!isInsideBounds(latlng, config.bounds)) {
      showToast(t('pick.outOfBounds'), { type: 'error' });
      return;
    }
    setPicking(false);
    clearDraft();
    draft = L.marker(latlng, {
      icon: createPinIcon({ color: DRAFT_COLOR, extraClass: 'pin--draft' }),
      interactive: false,
      keyboard: false,
    }).addTo(map);

    coordsOutput.textContent = `${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`;
    errorBox.hidden = true;
    dialog.showModal();
  }

  function setCategories(categories) {
    categorySelect.length = 1; // оставляем пункт-подсказку
    for (const { slug } of categories) {
      categorySelect.add(new Option(categoryLabel(slug), slug));
    }
  }

  map.on('click', (event) => {
    if (picking) openForm(event.latlng);
  });
  map.on('contextmenu', (event) => openForm(event.latlng));

  startButton.addEventListener('click', () => setPicking(true));
  cancelPickButton.addEventListener('click', () => setPicking(false));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && picking) setPicking(false);
  });

  form.querySelector('[data-cancel]').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', clearDraft);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (sending || !draft) return;

    const { titleMin, titleMax, descriptionMax } = config.limits;
    const title = cleanText(form.elements.title.value);
    const description = cleanText(form.elements.description.value, { multiline: true });
    const category = categorySelect.value;

    if (title.length < titleMin || title.length > titleMax ||
        description.length > descriptionMax) {
      showError(t('form.errorValidation'));
      return;
    }
    if (!category) {
      showError(t('form.errorCategory'));
      return;
    }
    if (!navigator.onLine) {
      showError(t('form.errorOffline'));
      return;
    }

    const { lat, lng } = draft.getLatLng();
    sending = true;
    submitButton.disabled = true;
    submitButton.textContent = t('form.sending');

    try {
      const response = await fetch(config.api.submit, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          latitude: lat,
          longitude: lng,
          title,
          description,
          category,
          website: form.elements.website.value, // honeypot
        }),
      });

      if (response.status === 202) {
        track(EVENTS.markerSubmit, { category });
        form.reset();
        dialog.close();
        showToast(t('form.success'), { type: 'success' });
        return;
      }
      if (response.status === 429) showError(t('form.errorRate'));
      else if (response.status === 400) showError(t('form.errorValidation'));
      else showError(t('form.errorServer'));
    } catch {
      showError(navigator.onLine ? t('form.errorServer') : t('form.errorOffline'));
    } finally {
      sending = false;
      submitButton.disabled = false;
      submitButton.textContent = t('form.submit');
    }
  });

  setCategories(config.fallbackCategories);

  return { setCategories };
}
