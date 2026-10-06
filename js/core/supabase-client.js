// =====================================================================
// Клиент Supabase (только для админки)
//
// URL и anon-ключ приходят из /api/config, чтобы не дублировать
// переменные окружения во фронтенде. Библиотека supabase-js
// подключается в admin.html и создаёт глобальный объект `supabase`.
// =====================================================================

let clientPromise = null;

export function getSupabase() {
  clientPromise ??= (async () => {
    const response = await fetch('/api/config');
    if (!response.ok) throw new Error(`config: HTTP ${response.status}`);
    const { supabaseUrl, supabaseAnonKey } = await response.json();
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error('SUPABASE_URL / SUPABASE_ANON_KEY не заданы в Vercel');
    }
    return window.supabase.createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        storageKey: 'priroda65-admin-auth',
      },
    });
  })();
  clientPromise.catch(() => { clientPromise = null; });
  return clientPromise;
}
