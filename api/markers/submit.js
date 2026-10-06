// =====================================================================
// POST /api/markers/submit — анонимная заявка на новую метку
//
// Вставляет строку в public.markers со статусом 'pending' через
// Supabase REST (PostgREST) с anon-ключом. RLS разрешает anon только
// INSERT pending-строк и SELECT approved-строк, поэтому вставка идёт
// с `Prefer: return=minimal`: без RETURNING PostgREST не пытается
// прочитать созданную строку, которую аноним видеть не вправе.
//
// Env: SUPABASE_URL, SUPABASE_ANON_KEY
// =====================================================================

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

// Совпадает с seed в supabase/migrations/001_markers_table.sql
const CATEGORIES = new Set([
  'fishing', 'berries', 'mushrooms', 'camp', 'viewpoint', 'hazard', 'other',
]);

// Совпадает с CHECK-ограничениями public.markers
const BOUNDS = { latMin: 45.8, latMax: 54.5, lonMin: 141.5, lonMax: 145.0 };
const TITLE_MIN = 3;
const TITLE_MAX = 80;
const DESCRIPTION_MAX = 1000;

// Лимит по IP. Хранится в памяти экземпляра функции, поэтому работает
// «по возможности»: холодный старт или другой экземпляр его сбрасывает.
// Жёсткий глобальный лимит — триггер markers_insert_throttle в БД.
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const hits = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) {
    hits.set(ip, recent);
    return true;
  }
  recent.push(now);
  hits.set(ip, recent);
  return false;
}

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || 'unknown';
}

// Чистит пользовательский текст: управляющие символы, угловые скобки
// (БД их всё равно отвергнет), лишние пробелы.
function cleanText(value, { multiline = false } = {}) {
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

function validate(body) {
  const errors = [];

  const latitude = Number(body.latitude);
  const longitude = Number(body.longitude);
  if (!Number.isFinite(latitude) || latitude < BOUNDS.latMin || latitude > BOUNDS.latMax ||
      !Number.isFinite(longitude) || longitude < BOUNDS.lonMin || longitude > BOUNDS.lonMax) {
    errors.push('coordinates_out_of_bounds');
  }

  const title = cleanText(body.title);
  if (title.length < TITLE_MIN || title.length > TITLE_MAX) {
    errors.push('title_length');
  }

  const description = cleanText(body.description, { multiline: true });
  if (description.length > DESCRIPTION_MAX) {
    errors.push('description_length');
  }

  const category = typeof body.category === 'string' ? body.category : '';
  if (!CATEGORIES.has(category)) {
    errors.push('invalid_category');
  }

  return {
    errors,
    marker: {
      latitude,
      longitude,
      title,
      description: description || null,
      category,
    },
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error('submit: SUPABASE_URL / SUPABASE_ANON_KEY are not set');
    return res.status(500).json({ error: 'server_misconfigured' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ error: 'invalid_json' });
    }
  }
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'invalid_body' });
  }

  // Honeypot: скрытое поле формы, которое заполняют только боты.
  // Отвечаем успехом, чтобы бот не понял, что его отсеяли.
  if (body.website) {
    return res.status(202).json({ ok: true });
  }

  if (isRateLimited(clientIp(req))) {
    return res.status(429).json({ error: 'rate_limited' });
  }

  const { errors, marker } = validate(body);
  if (errors.length) {
    return res.status(400).json({ error: 'validation_failed', details: errors });
  }

  let response;
  try {
    response = await fetch(`${SUPABASE_URL}/rest/v1/markers`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        // Без RETURNING: anon не может прочитать pending-строку (RLS).
        Prefer: 'return=minimal',
      },
      // status явно не передаём: колонка закрыта грантом для anon,
      // значение по умолчанию — 'pending'.
      body: JSON.stringify(marker),
    });
  } catch (err) {
    console.error('submit: Supabase request failed', err);
    return res.status(502).json({ error: 'upstream_unavailable' });
  }

  if (response.status === 201 || response.status === 204) {
    return res.status(202).json({ ok: true, status: 'pending' });
  }

  let detail = {};
  try {
    detail = await response.json();
  } catch {
    // тело ответа не JSON — оставляем пустым
  }

  // P0429 — лимит из триггера markers_insert_throttle
  if (detail.code === 'P0429') {
    return res.status(429).json({ error: 'rate_limited' });
  }
  // 23514 — нарушение CHECK, 23503 — неизвестная категория
  if (detail.code === '23514' || detail.code === '23503') {
    return res.status(400).json({ error: 'validation_failed' });
  }

  console.error('submit: Supabase insert failed', response.status, detail);
  return res.status(502).json({ error: 'insert_failed' });
};
