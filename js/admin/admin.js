// =====================================================================
// Админка: вход через Supabase Auth и проверка прав модератора
//
// Права проверяются дважды: здесь (есть ли пользователь в
// public.admins) — только чтобы показать нужный экран, и в базе
// через RLS — это настоящая защита. Без записи в admins любые
// изменения отклонит сама база.
// =====================================================================

import { getSupabase } from '../core/supabase-client.js';
import { initI18n } from '../i18n/i18n.js';
import { setupModeration } from './moderation.js';

const views = {
  status: document.getElementById('admin-status'),
  login: document.getElementById('login-view'),
  denied: document.getElementById('denied-view'),
  moderation: document.getElementById('moderation-view'),
};
const userBox = document.getElementById('admin-user');
const emailEl = document.getElementById('admin-email');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');

function show(name) {
  Object.entries(views).forEach(([key, el]) => { el.hidden = key !== name; });
}

async function main() {
  await initI18n('ru');

  let sb;
  try {
    sb = await getSupabase();
  } catch (err) {
    views.status.textContent = `Не удалось подключиться к базе: ${err.message}`;
    return;
  }

  let moderation = null;

  async function handleSession(session) {
    if (!session) {
      userBox.hidden = true;
      show('login');
      return;
    }
    emailEl.textContent = session.user.email ?? '';
    userBox.hidden = false;

    const { data, error } = await sb
      .from('admins')
      .select('user_id')
      .eq('user_id', session.user.id)
      .maybeSingle();
    if (error || !data) {
      show('denied');
      return;
    }

    show('moderation');
    moderation ??= setupModeration(sb);
    moderation.reload();
  }

  // Вызовы Supabase внутри onAuthStateChange откладываем:
  // синхронный запрос из обработчика может заблокировать клиент
  sb.auth.onAuthStateChange((event, session) => {
    if (['INITIAL_SESSION', 'SIGNED_IN', 'SIGNED_OUT'].includes(event)) {
      setTimeout(() => handleSession(session), 0);
    }
  });

  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    loginError.hidden = true;
    const email = loginForm.elements.email.value.trim();
    const password = loginForm.elements.password.value;
    if (!email || !password) {
      loginError.textContent = 'Введите email и пароль.';
      loginError.hidden = false;
      return;
    }
    const submit = loginForm.querySelector('[type="submit"]');
    submit.disabled = true;
    const { error } = await sb.auth.signInWithPassword({ email, password });
    submit.disabled = false;
    if (error) {
      loginError.textContent = error.status === 400
        ? 'Неверный email или пароль.'
        : `Не удалось войти: ${error.message}`;
      loginError.hidden = false;
      return;
    }
    loginForm.reset();
  });

  document.getElementById('logout').addEventListener('click', () => sb.auth.signOut());
}

main();
