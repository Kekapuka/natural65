// =====================================================================
// Всплывающее уведомление внизу экрана (одно за раз)
// Элемент #toast в index.html — live-регион, экранные дикторы его читают.
// =====================================================================

let hideTimer = null;

export function showToast(message, { type = 'info', duration = 5000 } = {}) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.dataset.type = type;
  toast.classList.add('is-visible');
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => toast.classList.remove('is-visible'), duration);
}

// Скрыть уведомление, только если на экране всё ещё именно оно
export function hideToast(message) {
  const toast = document.getElementById('toast');
  if (!toast || toast.textContent !== message) return;
  clearTimeout(hideTimer);
  toast.classList.remove('is-visible');
}
