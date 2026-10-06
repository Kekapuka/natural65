-- =====================================================================
-- Priroda65 — 001: схема данных (категории, метки, администраторы)
-- =====================================================================

-- ---------------------------------------------------------------------
-- Статус модерации метки
-- ---------------------------------------------------------------------
create type public.marker_status as enum ('pending', 'approved', 'rejected');

-- ---------------------------------------------------------------------
-- Категории меток (рыбалка, ягоды, опасность ...)
-- Отдельная таблица, чтобы админ мог менять иконки и цвета без миграций.
-- ---------------------------------------------------------------------
create table public.categories (
  slug        text primary key
              check (slug ~ '^[a-z][a-z_]{1,31}$'),
  color       text not null
              check (color ~ '^#[0-9A-Fa-f]{6}$'),
  icon_url    text
              check (icon_url is null or icon_url ~ '^https://'),
  sort_order  smallint not null default 0,
  created_at  timestamptz not null default now()
);

comment on table public.categories is
  'Справочник категорий меток. Названия локализуются на фронтенде по slug (locales/*.json).';

-- Цвета подобраны к палитре логотипа (#234826 / #FFFEFB):
-- природные тёмные тона, на которых белая иконка читается на солнце (контраст ≥ 4.5:1).
insert into public.categories (slug, color, sort_order) values
  ('fishing',   '#2E5E7E', 10),  -- глубокая вода
  ('berries',   '#8E2F45', 20),  -- брусника
  ('mushrooms', '#6E4F32', 30),  -- кора
  ('camp',      '#234826', 40),  -- фирменный зелёный
  ('viewpoint', '#8A6220', 50),  -- охра
  ('hazard',    '#B3261E', 60),  -- предупреждение
  ('other',     '#4F5E51', 99);  -- мох

-- ---------------------------------------------------------------------
-- Метки
-- ---------------------------------------------------------------------
create table public.markers (
  id           bigint generated always as identity primary key,

  -- Координаты ограничены островом Сахалин (с небольшим запасом),
  -- чтобы отсечь мусорные и заведомо чужие точки.
  latitude     double precision not null
               check (latitude  between 45.8 and 54.5),
  longitude    double precision not null
               check (longitude between 141.5 and 145.0),

  -- Второй рубеж защиты от XSS: угловые скобки запрещены на уровне БД.
  -- Основная санитизация — в api/markers/submit.js и js/core/sanitize.js.
  title        text not null
               check (char_length(btrim(title)) between 3 and 80
                      and title !~ '[<>]'),
  description  text
               check (description is null
                      or (char_length(description) <= 1000
                          and description !~ '[<>]')),

  category     text not null
               references public.categories (slug) on update cascade,

  -- Индивидуальная иконка ставится только админом (см. RLS и гранты в 002).
  icon_url     text
               check (icon_url is null or icon_url ~ '^https://'),

  status       public.marker_status not null default 'pending',

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  reviewed_at  timestamptz,
  reviewed_by  uuid references auth.users (id) on delete set null
);

comment on table public.markers is
  'Метки пользователей. Публично видны только status = approved.';

-- Карта читает только одобренные метки
create index markers_approved_geo_idx
  on public.markers (latitude, longitude)
  where status = 'approved';

-- Очередь модерации
create index markers_status_created_idx
  on public.markers (status, created_at desc);

-- ---------------------------------------------------------------------
-- Администраторы
-- Supabase Auth используется только для админки. Наличие аккаунта
-- в auth.users НЕ даёт прав — нужна запись в этой таблице.
-- Добавление админа (SQL Editor, после создания пользователя в Auth):
--   insert into public.admins (user_id)
--   select id from auth.users where email = 'admin@example.com';
-- ---------------------------------------------------------------------
create table public.admins (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Проверка роли администратора (используется в RLS-политиках)
-- security definer: читает admins в обход RLS; search_path зафиксирован.
-- ---------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admins where user_id = auth.uid()
  );
$$;

revoke execute on function public.is_admin() from public, anon;
grant  execute on function public.is_admin() to authenticated;

-- ---------------------------------------------------------------------
-- Триггер: updated_at и отметка модерации
-- ---------------------------------------------------------------------
create or replace function public.markers_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  if new.status is distinct from old.status then
    new.reviewed_at := now();
    new.reviewed_by := auth.uid();
  end if;
  return new;
end;
$$;

create trigger markers_before_update
  before update on public.markers
  for each row execute function public.markers_before_update();

-- ---------------------------------------------------------------------
-- Триггер: защита от флуда анонимными заявками
-- anon-ключ публичен, поэтому лимит нужен на уровне БД, а не только
-- в serverless-функции. Глобально не больше 30 заявок в минуту
-- и не больше 500 меток в очереди модерации.
-- ---------------------------------------------------------------------
create or replace function public.markers_insert_throttle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null
     and exists (select 1 from public.admins where user_id = auth.uid()) then
    return new;
  end if;

  if (select count(*) from public.markers
       where created_at > now() - interval '1 minute') >= 30 then
    raise exception 'Too many submissions, try again later'
      using errcode = 'P0429';
  end if;

  if (select count(*) from public.markers
       where status = 'pending') >= 500 then
    raise exception 'Moderation queue is full, try again later'
      using errcode = 'P0429';
  end if;

  return new;
end;
$$;

create trigger markers_insert_throttle
  before insert on public.markers
  for each row execute function public.markers_insert_throttle();
