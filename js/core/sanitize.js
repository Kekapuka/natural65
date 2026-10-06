// =====================================================================
// Очистка и проверка данных на клиенте
//
// Пользовательский текст в DOM выводится только через textContent,
// поэтому эти функции — не единственная защита от XSS, а проверка
// формы до отправки и фильтр значений, которые попадают в стили и src.
// Правила совпадают с api/markers/submit.js.
// =====================================================================

export function cleanText(value, { multiline = false } = {}) {
  if (typeof value !== 'string') return '';
  let text = value.normalize('NFC').replace(/[<>]/g, '');
  if (multiline) {
    text = text
      .replace(/\r\n?/g, '\n')
      .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n');
  } else {
    text = text.replace(/[\u0000-\u001F\u007F]/g, '').replace(/\s+/g, ' ');
  }
  return text.trim();
}

export function safeColor(value, fallback) {
  return typeof value === 'string' && /^#[0-9A-Fa-f]{6}$/.test(value) ? value : fallback;
}

export function safeHttpsUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}
