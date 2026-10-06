// =====================================================================
// Общие помощники серверных функций (папка с «_» — не маршрут Vercel)
// =====================================================================

const LANGS = ['ru', 'en', 'zh', 'ja', 'ko', 'es'];
const DEFAULT_LANG = 'ru';

// Адрес сайта для абсолютных ссылок (OpenGraph, sitemap, canonical).
// SITE_URL задайте в Vercel, когда подключите домен, например https://priroda65.ru
function siteUrl(req) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/+$/, '');
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return `${proto}://${host}`;
}

function pickLang(value) {
  return typeof value === 'string' && LANGS.includes(value) ? value : DEFAULT_LANG;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// JSON внутри <script>: «</script>» в данных не должен закрыть тег
function jsonForScript(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

async function supabaseGet(path) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_ANON_KEY are not set');
  const response = await fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Supabase ${response.status}`);
  return response.json();
}

module.exports = { LANGS, DEFAULT_LANG, siteUrl, pickLang, escapeHtml, jsonForScript, supabaseGet };
