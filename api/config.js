// =====================================================================
// GET /api/config — публичные настройки фронтенда из переменных Vercel
//
// Здесь только значения, которые и так видны в браузере:
// anon-ключ Supabase публичен по своей природе (доступ режет RLS),
// идентификаторы счётчиков аналитики тоже. Секреты (ORS_API_KEY,
// service_role) сюда не попадают.
//
// Env: SUPABASE_URL, SUPABASE_ANON_KEY,
//      YANDEX_METRIKA_ID (необязательно), GA_MEASUREMENT_ID (необязательно)
// =====================================================================

module.exports = function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
  return res.status(200).json({
    supabaseUrl: process.env.SUPABASE_URL || null,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || null,
    analytics: {
      yandexMetrikaId: process.env.YANDEX_METRIKA_ID || null,
      gaMeasurementId: process.env.GA_MEASUREMENT_ID || null,
    },
  });
};
