// =====================================================================
// GET /api/markers/approved — одобренные метки и категории для карты
//
//   /api/markers/approved          → все одобренные метки + категории
//   /api/markers/approved?id=123   → одна метка (для ссылок «поделиться»)
//
// Читает Supabase REST с anon-ключом. RLS отдаёт anon только строки
// со status = 'approved', а грант открывает только публичные колонки,
// поэтому колонки перечислены явно: `select=*` упал бы с 401/42501.
//
// Ответ кэшируется на CDN Vercel: после одобрения метка появляется
// на карте в течение ~1 минуты, а Supabase не получает запрос
// от каждого посетителя.
//
// Env: SUPABASE_URL, SUPABASE_ANON_KEY
// =====================================================================

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

const MARKER_COLUMNS =
  'id,latitude,longitude,title,description,category,icon_url,created_at';
const CATEGORY_COLUMNS = 'slug,color,icon_url,sort_order';

// Supabase по умолчанию отдаёт не больше 1000 строк за запрос
const PAGE_SIZE = 1000;
const MAX_MARKERS = 20000;

const CACHE_LIST = 'public, max-age=0, s-maxage=60, stale-while-revalidate=600';
const CACHE_ONE = 'public, max-age=0, s-maxage=300, stale-while-revalidate=3600';

async function supabaseGet(path, extraHeaders = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      Accept: 'application/json',
      ...extraHeaders,
    },
  });
  if (!response.ok && response.status !== 206) {
    let detail = '';
    try {
      detail = await response.text();
    } catch {
      // тело ответа недоступно
    }
    throw new Error(`Supabase ${response.status}: ${detail}`);
  }
  return response.json();
}

async function fetchAllMarkers() {
  const markers = [];
  for (let from = 0; from < MAX_MARKERS; from += PAGE_SIZE) {
    const page = await supabaseGet(
      `markers?select=${MARKER_COLUMNS}&order=id.asc`,
      { 'Range-Unit': 'items', Range: `${from}-${from + PAGE_SIZE - 1}` },
    );
    markers.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return markers;
}

function fetchCategories() {
  return supabaseGet(`categories?select=${CATEGORY_COLUMNS}&order=sort_order.asc`);
}

async function fetchMarker(id) {
  const rows = await supabaseGet(`markers?select=${MARKER_COLUMNS}&id=eq.${id}&limit=1`);
  return rows[0] || null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error('approved: SUPABASE_URL / SUPABASE_ANON_KEY are not set');
    return res.status(500).json({ error: 'server_misconfigured' });
  }

  const rawId = req.query?.id;
  try {
    if (rawId !== undefined) {
      if (typeof rawId !== 'string' || !/^[1-9]\d{0,17}$/.test(rawId)) {
        return res.status(400).json({ error: 'invalid_id' });
      }
      const marker = await fetchMarker(rawId);
      if (!marker) {
        // Нет такой метки или она ещё не одобрена — снаружи не различаем
        res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60');
        return res.status(404).json({ error: 'not_found' });
      }
      res.setHeader('Cache-Control', CACHE_ONE);
      return res.status(200).json({ marker });
    }

    const [categories, markers] = await Promise.all([
      fetchCategories(),
      fetchAllMarkers(),
    ]);
    res.setHeader('Cache-Control', CACHE_LIST);
    return res.status(200).json({
      generated_at: new Date().toISOString(),
      categories,
      markers,
    });
  } catch (err) {
    console.error('approved: Supabase request failed', err);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: 'upstream_unavailable' });
  }
};
