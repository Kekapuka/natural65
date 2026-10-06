// =====================================================================
// GET /sitemap.xml (через rewrite в vercel.json) — карта сайта
//
// Главная и справочник на 6 языках с hreflang, плюс страница каждой
// одобренной метки. Обновляется сама: кэш CDN — 1 час.
//
// Env: SUPABASE_URL, SUPABASE_ANON_KEY, SITE_URL (необязательно)
// =====================================================================

const { LANGS, DEFAULT_LANG, siteUrl, escapeHtml, supabaseGet } = require('./_lib/site.js');

const MAX_MARKERS = 45000; // лимит sitemap — 50 000 адресов

function withLang(base, lang) {
  const url = new URL(base);
  if (lang !== DEFAULT_LANG) url.searchParams.set('lang', lang);
  return url.href;
}

function urlEntry(loc, { lastmod, alternatesFor, priority } = {}) {
  const lines = ['  <url>', `    <loc>${escapeHtml(loc)}</loc>`];
  if (lastmod) lines.push(`    <lastmod>${lastmod}</lastmod>`);
  if (alternatesFor) {
    for (const lang of LANGS) {
      lines.push(`    <xhtml:link rel="alternate" hreflang="${lang}" href="${escapeHtml(withLang(alternatesFor, lang))}"/>`);
    }
    lines.push(`    <xhtml:link rel="alternate" hreflang="x-default" href="${escapeHtml(alternatesFor)}"/>`);
  }
  if (priority) lines.push(`    <priority>${priority}</priority>`);
  lines.push('  </url>');
  return lines.join('\n');
}

module.exports = async function handler(req, res) {
  const site = siteUrl(req);
  const entries = [];

  for (const page of [{ path: '/', priority: '1.0' }, { path: '/info', priority: '0.8' }]) {
    const base = new URL(page.path, site).href;
    for (const lang of LANGS) {
      entries.push(urlEntry(withLang(base, lang), { alternatesFor: base, priority: page.priority }));
    }
  }

  try {
    const markers = await supabaseGet(
      `markers?select=id,latitude,longitude,created_at&order=id.asc&limit=${MAX_MARKERS}`);
    for (const marker of markers) {
      const url = new URL('/', site);
      url.searchParams.set('id', String(marker.id));
      url.searchParams.set('lat', Number(marker.latitude).toFixed(5));
      url.searchParams.set('lon', Number(marker.longitude).toFixed(5));
      entries.push(urlEntry(url.href, {
        lastmod: String(marker.created_at).slice(0, 10),
        alternatesFor: url.href,
        priority: '0.6',
      }));
    }
  } catch (err) {
    // Без базы отдаём хотя бы основные страницы
    console.error('sitemap: markers fetch failed', err);
  }

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ...entries,
    '</urlset>',
  ].join('\n');

  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400');
  return res.status(200).send(xml);
};
