# Природа65 (Priroda65)

Офлайн-карта Сахалина для туристов, рыбаков и сборщиков ягод: метки от
сообщества с модерацией, маршруты, GPS по спутникам, сетка 100 м, экран SOS,
6 языков. Чистый HTML/CSS/JS + Leaflet, серверные функции Vercel, Supabase.

## Структура

| Путь | Что это |
|---|---|
| `index.html`, `info.html`, `sos.html`, `admin.html` | Карта, справочник, экстренный экран, модерация |
| `js/` | ES-модули фронтенда (без сборщика, по папкам: core, map, markers, offline, ui, i18n, analytics, admin) |
| `api/` | Серверные функции Vercel: метки, маршруты, SEO-страницы, sitemap, robots |
| `locales/*.json` | Тексты интерфейса на 6 языках (ключи одинаковые во всех файлах) |
| `supabase/migrations/` | Схема БД, RLS, хранилище иконок — выполнять по порядку 001 → 003 |
| `sw.js` | Service Worker: офлайн-оболочка, кэш меток, тайлы из скачанного файла |
| `scripts/` | Сборка, проверка списка офлайн-файлов, подготовка тайлов и картинок превью |

## Запуск в продакшене

1. **Supabase.** В SQL Editor выполнить `supabase/migrations/001…003` по порядку.
   Создать пользователя-модератора в Authentication → Users и добавить его:
   `insert into public.admins (user_id) select id from auth.users where email = '…';`
   Выключить регистрацию: Authentication → Sign In / Providers → Allow new users to sign up.
2. **Карта.** `npm run tiles:extract` (нужен CLI [pmtiles](https://github.com/protomaps/go-pmtiles/releases))
   вырежет Сахалин из свежей сборки Protomaps в `tiles/`. Файл (~100 МБ) загрузить
   в объектное хранилище, например Cloudflare R2, и включить там CORS:
   ```json
   [{"AllowedOrigins":["https://priroda65.ru"],"AllowedMethods":["GET","HEAD"],
     "AllowedHeaders":["Range"],"ExposeHeaders":["ETag","Content-Range","Content-Length"]}]
   ```
   Адрес и размер файла указать в `js/core/config.js` → `tiles`.
3. **Vercel.** Импортировать репозиторий, задать переменные из `.env.example`.
   Сборка (`npm run build` → `dist/`) настроена в `vercel.json`.
4. **Необязательно:** ключ JS API Яндекс Карт (слой «Город») — в `js/core/config.js`
   → `yandexMapsApiKey`, ограничить по HTTP Referer доменом сайта.

## Разработка

- Страницы открываются любым статическим сервером из корня; функции `api/` — через `vercel dev`.
- После добавления или переименования файлов: `npm run check:sw` — иначе файл не будет доступен офлайн
  (или Service Worker не установится совсем).
- Новый текст интерфейса — ключ во **всех** `locales/*.json`.
- После смены `app.tagline` / `offline.heading`: `powershell -File scripts/og-images.ps1 -Root .`
  — перерисует картинки превью для соцсетей.

## Лицензии данных

Картографические данные © участники OpenStreetMap (ODbL), сборка тайлов — Protomaps.
Маршруты — OpenRouteService. Атрибуция выводится на карте и обязательна.
