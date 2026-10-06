-- =====================================================================
-- Priroda65 — 003: Supabase Storage для иконок категорий и меток
--
-- Бакет публичный: файлы отдаются по public URL без политики SELECT.
-- Загружать, заменять и удалять может только администратор.
-- SVG запрещён намеренно: он может содержать <script> (XSS).
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'marker-icons',
  'marker-icons',
  true,
  262144,                                  -- 256 КБ
  array['image/png', 'image/webp']
)
on conflict (id) do update set
  public             = excluded.public,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy marker_icons_insert_admin
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'marker-icons' and public.is_admin());

create policy marker_icons_update_admin
  on storage.objects for update
  to authenticated
  using      (bucket_id = 'marker-icons' and public.is_admin())
  with check (bucket_id = 'marker-icons' and public.is_admin());

create policy marker_icons_delete_admin
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'marker-icons' and public.is_admin());

-- Список файлов нужен только админке (выбор иконки)
create policy marker_icons_select_admin
  on storage.objects for select
  to authenticated
  using (bucket_id = 'marker-icons' and public.is_admin());
