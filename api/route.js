// =====================================================================
// GET /api/route?from=lat,lon&to=lat,lon&mode=foot|bike|car
//
// Прокси к OpenRouteService Directions: ключ остаётся на сервере.
// Ответ: { mode, distance (м), duration (с), geometry: [[lat, lon], ...] }
// 422 { error: 'no_route' } — рядом с точкой нет дорог/троп или
// маршрут не найден; фронтенд тогда показывает путь по прямой.
//
// Бесплатный тариф ORS: 2000 маршрутов в сутки, 40 в минуту —
// поэтому лимит по IP и кэш на CDN Vercel.
//
// Env: ORS_API_KEY
// =====================================================================

const ORS_API_KEY = process.env.ORS_API_KEY;
const ORS_URL = 'https://api.openrouteservice.org/v2/directions';

const PROFILES = {
  foot: 'foot-hiking',
  bike: 'cycling-regular',
  car: 'driving-car',
};

// Остров с запасом: пользователь может стоять на пароме или у берега
const BOUNDS = { latMin: 45.3, latMax: 55.0, lonMin: 141.0, lonMax: 145.5 };

// Насколько далеко от точки искать ближайшую дорогу/тропу (м).
// В тайге до дороги бывает далеко — остаток пути фронтенд рисует по прямой.
const SNAP_RADIUS_M = 5000;

// Коды ORS: 2009 — маршрут не найден, 2010 — точка не найдена,
// 2004 — превышен лимит расстояния для профиля
const NO_ROUTE_CODES = new Set([2004, 2009, 2010]);

const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const hits = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  const limited = recent.length >= RATE_LIMIT;
  if (!limited) recent.push(now);
  hits.set(ip, recent);
  return limited;
}

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded) return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

// "46.95905,142.72184" → [lat, lon] или null
function parsePoint(value) {
  if (typeof value !== 'string') return null;
  const match = /^(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)$/.exec(value);
  if (!match) return null;
  const lat = Number(match[1]);
  const lon = Number(match[2]);
  if (lat < BOUNDS.latMin || lat > BOUNDS.latMax || lon < BOUNDS.lonMin || lon > BOUNDS.lonMax) {
    return null;
  }
  // ~10 м точности хватает и повышает попадания в кэш
  return [Number(lat.toFixed(4)), Number(lon.toFixed(4))];
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  if (!ORS_API_KEY) {
    console.error('route: ORS_API_KEY is not set');
    return res.status(503).json({ error: 'routing_unavailable' });
  }

  const from = parsePoint(req.query?.from);
  const to = parsePoint(req.query?.to);
  const mode = req.query?.mode;
  if (!from || !to || !Object.hasOwn(PROFILES, mode)) {
    return res.status(400).json({ error: 'invalid_params' });
  }

  if (isRateLimited(clientIp(req))) {
    return res.status(429).json({ error: 'rate_limited' });
  }

  let response;
  try {
    response = await fetch(`${ORS_URL}/${PROFILES[mode]}/geojson`, {
      method: 'POST',
      headers: {
        Authorization: ORS_API_KEY,
        'Content-Type': 'application/json',
        Accept: 'application/geo+json, application/json',
      },
      body: JSON.stringify({
        coordinates: [[from[1], from[0]], [to[1], to[0]]],
        radiuses: [SNAP_RADIUS_M, SNAP_RADIUS_M],
        instructions: false,
        preference: 'recommended',
      }),
    });
  } catch (err) {
    console.error('route: ORS request failed', err);
    return res.status(502).json({ error: 'upstream_unavailable' });
  }

  let body = null;
  try {
    body = await response.json();
  } catch {
    // тело не JSON
  }

  if (!response.ok) {
    const code = body?.error?.code;
    if (NO_ROUTE_CODES.has(code)) {
      res.setHeader('Cache-Control', 'public, s-maxage=3600');
      return res.status(422).json({ error: 'no_route' });
    }
    if (response.status === 429) return res.status(429).json({ error: 'rate_limited' });
    console.error('route: ORS error', response.status, body);
    return res.status(502).json({ error: 'upstream_error' });
  }

  const feature = body?.features?.[0];
  const summary = feature?.properties?.summary;
  const coordinates = feature?.geometry?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) {
    return res.status(422).json({ error: 'no_route' });
  }

  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=3600');
  return res.status(200).json({
    mode,
    distance: Math.round(summary?.distance ?? 0),
    duration: Math.round(summary?.duration ?? 0),
    geometry: coordinates.map(([lon, lat]) => [lat, lon]),
  });
};
