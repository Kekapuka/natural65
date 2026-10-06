// =====================================================================
// GET /robots.txt (через rewrite в vercel.json)
//
// Открываем карту, справочник и страницы меток; закрываем админку,
// API и служебные файлы. Для Яндекса — Clean-param, чтобы метки
// UTM не плодили дубли страниц.
// =====================================================================

const { siteUrl } = require('./_lib/site.js');

module.exports = function handler(req, res) {
  const site = siteUrl(req);
  const body = [
    '# Природа65 — карта рыбалки, ягод, грибов и экотуризма на Сахалине',
    '# Sakhalin Island map: fishing spots, berries, hiking, eco-tourism',
    '',
    'User-agent: *',
    'Allow: /',
    'Allow: /info',
    'Disallow: /admin',
    'Disallow: /api/',
    'Disallow: /tiles/',
    'Disallow: /sw.js',
    '',
    'User-agent: Yandex',
    'Allow: /',
    'Disallow: /admin',
    'Disallow: /api/',
    'Disallow: /tiles/',
    'Clean-param: utm_source&utm_medium&utm_campaign&utm_content&utm_term /',
    '',
    `Sitemap: ${site}/sitemap.xml`,
    '',
  ].join('\n');

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400');
  return res.status(200).send(body);
};
