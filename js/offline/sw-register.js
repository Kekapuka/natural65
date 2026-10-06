// =====================================================================
// Регистрация Service Worker (sw.js)
// =====================================================================

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.error('Service Worker не зарегистрирован', err);
    });
  });
}

export function notifyServiceWorker(message) {
  navigator.serviceWorker?.controller?.postMessage(message);
}
