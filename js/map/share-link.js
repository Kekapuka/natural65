// =====================================================================
// Ссылки «поделиться» на метку
//
// Формат из ТЗ: https://домен/?lat=46.95&lon=142.73&id=123
// Для соцсетей такую ссылку перехватывает api/share.js и отдаёт
// краулерам страницу с превью метки (OpenGraph / Twitter Cards).
// =====================================================================

import { t } from '../i18n/i18n.js';
import { showToast } from '../ui/toast.js';

export function buildShareUrl({ id, lat, lng }) {
  const url = new URL('/', window.location.origin);
  url.searchParams.set('lat', lat.toFixed(5));
  url.searchParams.set('lon', lng.toFixed(5));
  if (id) url.searchParams.set('id', String(id));
  const lang = document.documentElement.lang;
  if (lang && lang !== 'ru') url.searchParams.set('lang', lang);
  return url.href;
}

// Возвращает способ, которым поделились: 'share' | 'copy' | null
export async function shareMarker(marker) {
  const url = buildShareUrl(marker);
  // Тот же текст, что в превью соцсетей (api/share): «Посмотрите место для рыбалки на острове Сахалин!»
  const spotKey = `spot.${marker.category}`;
  const spot = t(spotKey) === spotKey ? t('spot.other') : t(spotKey);
  const text = t('seo.shareDescription', { spot });

  if (navigator.share) {
    try {
      await navigator.share({ title: marker.title, text, url });
      return 'share';
    } catch (err) {
      if (err?.name === 'AbortError') return null; // пользователь передумал
    }
  }

  try {
    await navigator.clipboard.writeText(url);
    showToast(t('share.copied'), { type: 'success' });
    return 'copy';
  } catch {
    // Буфер обмена недоступен — показываем ссылку, чтобы её можно было скопировать вручную
    showToast(url, { duration: 10000 });
    return null;
  }
}
