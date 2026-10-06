// =====================================================================
// Главная страница с SEO на нужном языке и превью метки для соцсетей
//
// vercel.json направляет сюда «/» с параметром id или lang:
//   /?id=123&lat=46.95&lon=142.73[&lang=en]  → карточка метки
//   /?lang=en                                → главная на английском
// Функция берёт index.html и заменяет блок <!-- seo:start --> …
// <!-- seo:end -->: title, description, canonical, hreflang,
// OpenGraph, Twitter Cards и Schema.org (WebSite / TouristAttraction).
// Обычные посетители получают ту же страницу — приложение работает
// как всегда, а краулеры VK, Telegram, Google и Яндекса видят превью:
// «Посмотрите место для рыбалки на острове Сахалин!».
//
// Env: SUPABASE_URL, SUPABASE_ANON_KEY, SITE_URL (необязательно)
// =====================================================================

const fs = require('node:fs');
const path = require('node:path');
const {
  LANGS, DEFAULT_LANG, siteUrl, pickLang, escapeHtml, jsonForScript, supabaseGet,
} = require('../_lib/site.js');

const ROOT = process.cwd();
const SEO_BLOCK = /<!-- seo:start[\s\S]*?<!-- seo:end -->/;
const MARKER_COLUMNS = 'id,latitude,longitude,title,description,category,created_at';

let template = null;
const dictionaries = new Map();

function loadTemplate() {
  template ??= fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  return template;
}

function dictionary(lang) {
  if (!dictionaries.has(lang)) {
    let messages = {};
    try {
      messages = JSON.parse(fs.readFileSync(path.join(ROOT, 'locales', `${lang}.json`), 'utf8'));
    } catch (err) {
      // Нет или повреждён словарь — тексты возьмутся из русского
      console.error(`share: locale "${lang}" unavailable`, err.message);
    }
    dictionaries.set(lang, messages);
  }
  return dictionaries.get(lang);
}

function translator(lang) {
  const own = dictionary(lang);
  const fallback = dictionary(DEFAULT_LANG);
  return (key, params = {}) => {
    const text = own[key] ?? fallback[key] ?? key;
    return text.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
  };
}

async function fetchMarker(id) {
  const rows = await supabaseGet(`markers?select=${MARKER_COLUMNS}&id=eq.${id}&limit=1`);
  return rows[0] || null;
}

function pageUrl(site, { lang, marker }) {
  const url = new URL('/', site);
  if (marker) {
    url.searchParams.set('id', String(marker.id));
    url.searchParams.set('lat', Number(marker.latitude).toFixed(5));
    url.searchParams.set('lon', Number(marker.longitude).toFixed(5));
  }
  if (lang !== DEFAULT_LANG) url.searchParams.set('lang', lang);
  return url.href;
}

function buildSeoBlock({ site, lang, marker, notFound }) {
  const t = translator(lang);
  const canonical = pageUrl(site, { lang, marker });
  const image = `${site}/assets/img/og/og-${lang}.png`;

  let title = t('seo.title');
  let description = t('seo.description');
  let jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: t('seo.siteName'),
    url: canonical,
    inLanguage: lang,
    description,
  };

  if (marker) {
    const category = t(`category.${marker.category}`);
    const spotKey = `spot.${marker.category}`;
    const spot = t(spotKey) === spotKey ? t('spot.other') : t(spotKey);
    title = t('seo.shareTitle', { title: marker.title, category });
    description = t('seo.shareDescription', { spot });
    jsonLd = {
      '@context': 'https://schema.org',
      '@type': 'TouristAttraction',
      name: marker.title,
      description: marker.description || description,
      url: canonical,
      image,
      isAccessibleForFree: true,
      touristType: category,
      geo: {
        '@type': 'GeoCoordinates',
        latitude: Number(marker.latitude),
        longitude: Number(marker.longitude),
      },
      containedInPlace: { '@type': 'Place', name: t('seo.island') },
    };
  }

  const alternates = LANGS.map((alt) =>
    `<link rel="alternate" hreflang="${alt}" href="${escapeHtml(pageUrl(site, { lang: alt, marker }))}">`);
  alternates.push(`<link rel="alternate" hreflang="x-default" href="${escapeHtml(pageUrl(site, { lang: DEFAULT_LANG, marker }))}">`);

  const e = escapeHtml;
  return [
    '<!-- seo:start -->',
    `<title>${e(title)}</title>`,
    `<meta name="description" content="${e(description)}">`,
    notFound ? '<meta name="robots" content="noindex">' : '',
    `<link rel="canonical" href="${e(canonical)}">`,
    ...alternates,
    `<meta property="og:type" content="${marker ? 'place' : 'website'}">`,
    `<meta property="og:site_name" content="${e(t('seo.siteName'))}">`,
    `<meta property="og:locale" content="${e(t('seo.ogLocale'))}">`,
    `<meta property="og:url" content="${e(canonical)}">`,
    `<meta property="og:title" content="${e(title)}">`,
    `<meta property="og:description" content="${e(description)}">`,
    `<meta property="og:image" content="${e(image)}">`,
    '<meta property="og:image:width" content="1200">',
    '<meta property="og:image:height" content="630">',
    `<meta property="og:image:alt" content="${e(t('seo.ogImageAlt'))}">`,
    marker ? `<meta property="place:location:latitude" content="${Number(marker.latitude)}">` : '',
    marker ? `<meta property="place:location:longitude" content="${Number(marker.longitude)}">` : '',
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${e(title)}">`,
    `<meta name="twitter:description" content="${e(description)}">`,
    `<meta name="twitter:image" content="${e(image)}">`,
    `<script type="application/ld+json">${jsonForScript(jsonLd)}</script>`,
    '<!-- seo:end -->',
  ].filter(Boolean).join('\n  ');
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).send('Method Not Allowed');
  }

  const lang = pickLang(req.query?.lang);
  const rawId = req.query?.id;
  const id = typeof rawId === 'string' && /^[1-9]\d{0,17}$/.test(rawId) ? rawId : null;

  let marker = null;
  if (id) {
    try {
      marker = await fetchMarker(id);
    } catch (err) {
      // База недоступна — отдаём страницу без превью метки, приложение всё равно откроется
      console.error('share: marker fetch failed', err);
    }
  }

  let html;
  try {
    html = loadTemplate()
      .replace(SEO_BLOCK, buildSeoBlock({ site: siteUrl(req), lang, marker, notFound: Boolean(id && !marker) }))
      .replace(/<html lang="[^"]*">/, `<html lang="${lang}">`);
  } catch (err) {
    console.error('share: render failed', err);
    return res.status(500).send('Internal Server Error');
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=86400');
  return res.status(200).send(html);
};
