// =====================================================================
// Панель «Офлайн-карта»: статус, скачивание с прогрессом, удаление
// =====================================================================

import { t, currentLang } from '../i18n/i18n.js';
import { showToast } from '../ui/toast.js';
import { track, EVENTS } from '../analytics/analytics.js';
import {
  isOfflineSupported, getOfflineStatus, downloadTiles, deleteTiles, buildDate, QuotaError,
} from './tile-downloader.js';

const MB = 1024 * 1024;

function formatMb(bytes) {
  const value = (bytes / MB).toLocaleString(currentLang(), {
    maximumFractionDigits: bytes < 10 * MB ? 1 : 0,
  });
  return t('offline.sizeMb', { value });
}

function formatDate(date) {
  return date ? date.toLocaleDateString(currentLang()) : '—';
}

function isLikelyCellular() {
  const connection = navigator.connection;
  return Boolean(connection && (connection.type === 'cellular' || connection.saveData));
}

// onTilesChanged(url) — вызывается, когда слою «Природа» нужно
// переключиться на другой файл (после обновления или удаления)
export function setupOfflinePanel(config, { onTilesChanged } = {}) {
  const openButton = document.getElementById('offline-open');
  const dialog = document.getElementById('offline-dialog');
  const status = dialog.querySelector('[data-offline-status]');
  const note = dialog.querySelector('[data-offline-note]');
  const progressBox = dialog.querySelector('[data-offline-progress]');
  const progressBar = progressBox.querySelector('progress');
  const progressText = progressBox.querySelector('[data-progress-text]');
  const downloadButton = dialog.querySelector('[data-offline-download]');
  const cancelButton = dialog.querySelector('[data-offline-cancel]');
  const deleteButton = dialog.querySelector('[data-offline-delete]');
  const closeButton = dialog.querySelector('[data-offline-close]');

  const size = formatMb(config.tiles.sizeBytes);
  let controller = null;
  let frame = 0;

  async function render() {
    if (!isOfflineSupported()) {
      status.textContent = t('offline.unsupported');
      downloadButton.hidden = true;
      deleteButton.hidden = true;
      return;
    }

    const { state } = await getOfflineStatus(config.tiles);
    const date = formatDate(buildDate(config.tiles.url));
    const busy = controller !== null;

    status.textContent =
      state === 'ready' ? t('offline.statusReady', { date }) :
      state === 'outdated' ? t('offline.statusOutdated', { date, size }) :
      t('offline.statusNone', { size });

    downloadButton.hidden = busy || state === 'ready';
    downloadButton.textContent = t(state === 'outdated' ? 'offline.update' : 'offline.download');
    deleteButton.hidden = busy || state === 'none';
    cancelButton.hidden = !busy;
    progressBox.hidden = !busy;
    openButton.dataset.state = state;

    note.textContent =
      busy ? t('offline.keepOpen') :
      state !== 'ready' && isLikelyCellular() ? t('offline.cellular', { size }) : '';
    note.hidden = !note.textContent;
  }

  function showProgress(loaded, total) {
    // Прогресс приходит на каждый кусок потока — перерисовываем раз в кадр
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      progressBar.max = total;
      progressBar.value = loaded;
      progressText.textContent = t('offline.progress', {
        loaded: formatMb(loaded),
        total: formatMb(total),
      });
    });
  }

  async function startDownload() {
    track(EVENTS.offlineDownloadClick, { update: openButton.dataset.state === 'outdated' });
    controller = new AbortController();
    progressBar.removeAttribute('value');
    progressText.textContent = '';
    await render();
    try {
      await downloadTiles(config.tiles, { signal: controller.signal, onProgress: showProgress });
      showToast(t('offline.done'), { type: 'success' });
      track(EVENTS.offlineDownloadDone);
      onTilesChanged?.(config.tiles.url);
    } catch (err) {
      if (err?.name === 'AbortError') {
        showToast(t('offline.cancelled'));
      } else if (err instanceof QuotaError) {
        showToast(t('offline.errorQuota', { size }), { type: 'error' });
      } else {
        console.error(err);
        showToast(t('offline.errorNetwork'), { type: 'error' });
      }
    } finally {
      cancelAnimationFrame(frame);
      controller = null;
      await render();
    }
  }

  async function open() {
    await render();
    if (!dialog.open) dialog.showModal();
  }

  openButton.addEventListener('click', open);
  downloadButton.addEventListener('click', startDownload);
  cancelButton.addEventListener('click', () => controller?.abort());
  deleteButton.addEventListener('click', async () => {
    await deleteTiles();
    showToast(t('offline.deleted'));
    onTilesChanged?.(config.tiles.url);
    await render();
  });
  closeButton.addEventListener('click', () => dialog.close());

  // Закрытие вкладки оборвёт загрузку — предупреждаем
  window.addEventListener('beforeunload', (event) => {
    if (controller) event.preventDefault();
  });

  render();

  return { open };
}
