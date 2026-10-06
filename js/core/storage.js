// =====================================================================
// Безопасная обёртка над localStorage
// В приватном режиме или при запрете хранилища доступ бросает
// исключение — тогда просто работаем без сохранения настроек.
// =====================================================================

const PREFIX = 'priroda65:';

export function getItem(key, fallback = null) {
  try {
    const value = localStorage.getItem(PREFIX + key);
    return value === null ? fallback : value;
  } catch {
    return fallback;
  }
}

export function setItem(key, value) {
  try {
    localStorage.setItem(PREFIX + key, value);
  } catch {
    // хранилище недоступно — настройка не запомнится
  }
}
