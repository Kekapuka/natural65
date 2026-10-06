-- =====================================================================
-- Priroda65 — 002: Row-Level Security и права доступа
--
-- anon           — публичные пользователи (без регистрации, 152-ФЗ)
--                  SELECT только approved, INSERT только pending
-- authenticated  — вошедшие через Supabase Auth; полные права только
--                  у тех, кто есть в public.admins (is_admin())
--
-- ВАЖНО для api/markers/submit.js: anon не видит pending-строки,
-- поэтому вставку делать с заголовком `Prefer: return=minimal`
-- (без RETURNING), иначе запрос упадёт на SELECT-политике.
-- =====================================================================

alter table public.categories enable row level security;
alter table public.markers    enable row level security;
alter table public.admins     enable row level security;

-- ---------------------------------------------------------------------
-- Гранты на уровне колонок (первый рубеж; RLS — второй)
-- ---------------------------------------------------------------------
revoke all on public.categories, public.markers, public.admins
  from anon, authenticated;

-- categories: читают все, пишут админы
grant select on public.categories to anon, authenticated;
grant insert, update, delete on public.categories to authenticated;

-- markers: аноним видит только публичные поля и может задать
-- только содержимое заявки — не статус, не иконку, не поля модерации.
grant select (id, latitude, longitude, title, description,
              category, icon_url, created_at)
  on public.markers to anon;

grant insert (latitude, longitude, title, description, category)
  on public.markers to anon;

grant select, insert, update, delete on public.markers to authenticated;

-- admins: пользователь может проверить только себя (для входа в админку)
grant select on public.admins to authenticated;

-- ---------------------------------------------------------------------
-- categories
-- ---------------------------------------------------------------------
create policy categories_select_all
  on public.categories for select
  to anon, authenticated
  using (true);

create policy categories_insert_admin
  on public.categories for insert
  to authenticated
  with check (public.is_admin());

create policy categories_update_admin
  on public.categories for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy categories_delete_admin
  on public.categories for delete
  to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------
-- markers: публичный доступ
-- ---------------------------------------------------------------------
create policy markers_select_approved_anon
  on public.markers for select
  to anon
  using (status = 'approved');

create policy markers_insert_pending_anon
  on public.markers for insert
  to anon
  with check (
    status = 'pending'
    and icon_url is null
    and reviewed_at is null
    and reviewed_by is null
  );

-- ---------------------------------------------------------------------
-- markers: вошедшие пользователи
-- Не-админ с аккаунтом ведёт себя как аноним; админ — полный доступ.
-- ---------------------------------------------------------------------
create policy markers_select_authenticated
  on public.markers for select
  to authenticated
  using (status = 'approved' or public.is_admin());

create policy markers_insert_authenticated
  on public.markers for insert
  to authenticated
  with check (
    public.is_admin()
    or (status = 'pending'
        and icon_url is null
        and reviewed_at is null
        and reviewed_by is null)
  );

create policy markers_update_admin
  on public.markers for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy markers_delete_admin
  on public.markers for delete
  to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------
-- admins: только чтение своей записи. Добавлять/удалять админов —
-- вручную через SQL Editor (роль postgres / service_role обходит RLS).
-- ---------------------------------------------------------------------
create policy admins_select_self
  on public.admins for select
  to authenticated
  using (user_id = auth.uid());
