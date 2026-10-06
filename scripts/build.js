#!/usr/bin/env node
// =====================================================================
// Сборка для продакшена → папка dist/ (её публикует Vercel)
//
//   npm run build
//
//   — JS и CSS минифицируются esbuild без склейки: пути файлов те же,
//     поэтому список SHELL_ASSETS в sw.js остаётся верным;
//   — в index.html и info.html добавляется <link rel="modulepreload">
//     для всех модулей — браузер грузит их параллельно, без «лесенки»;
//   — JSON словарей сжимается;
//   — VERSION в sw.js получает хэш содержимого: при любом изменении
//     файлов кэш у пользователей обновится сам;
//   — перед сборкой запускается проверка scripts/check-sw-assets.js.
//
// Серверные функции api/ Vercel собирает отдельно, из корня проекта.
// Папка tiles/ копируется, только если в ней есть .pmtiles (локально);
// в git её нет — для продакшена файл карты лежит в хранилище (README).
// =====================================================================

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const esbuild = require('esbuild');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const COPY = ['index.html', 'info.html', 'sos.html', 'admin.html', 'manifest.webmanifest', 'sw.js', 'assets', 'js', 'locales', 'tiles'];
const MODULE_ENTRIES = { 'index.html': '/js/core/app.js', 'info.html': '/js/core/info-page.js' };
const TARGET = ['es2020', 'chrome90', 'safari15', 'firefox90'];

const stats = { before: 0, after: 0, files: 0 };

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function minify(file, source) {
  const ext = path.extname(file);
  // У сторонних библиотек сохраняем лицензионные комментарии
  const legalComments = file.includes(`${path.sep}vendor${path.sep}`) ? 'inline' : 'none';
  if (ext === '.js') {
    return esbuild.transformSync(source, { loader: 'js', minify: true, target: TARGET, legalComments }).code;
  }
  if (ext === '.css') {
    return esbuild.transformSync(source, { loader: 'css', minify: true, target: TARGET, legalComments }).code;
  }
  if (ext === '.json' || ext === '.webmanifest') {
    return JSON.stringify(JSON.parse(source));
  }
  if (ext === '.html') {
    // Убираем отступы и комментарии; блок <!-- seo:… --> оставляем — его ищет api/share
    return source
      .replace(/<!--(?!\s*seo:)[\s\S]*?-->/g, '')
      .replace(/\n\s+/g, '\n')
      .replace(/\n{2,}/g, '\n');
  }
  return null; // картинки и прочее — как есть
}

// Все модули, которые подтянет точка входа (по статическим import)
function moduleGraph(entryUrl, seen = new Set()) {
  if (seen.has(entryUrl)) return seen;
  seen.add(entryUrl);
  const source = fs.readFileSync(path.join(ROOT, entryUrl), 'utf8');
  for (const [, spec] of source.matchAll(/^\s*import\s[^'"]*['"](\.{1,2}\/[^'"]+)['"]/gm)) {
    moduleGraph(path.posix.join(path.posix.dirname(entryUrl), spec), seen);
  }
  return seen;
}

function addModulePreload(html, entryUrl) {
  const links = [...moduleGraph(entryUrl)]
    .filter((url) => url !== entryUrl)
    .map((url) => `<link rel="modulepreload" href="${url}">`)
    .join('\n');
  return html.replace(`<script type="module" src="${entryUrl}"></script>`,
    `${links}\n<script type="module" src="${entryUrl}"></script>`);
}

function main() {
  execFileSync(process.execPath, [path.join(__dirname, 'check-sw-assets.js')], { stdio: 'inherit' });

  fs.rmSync(DIST, { recursive: true, force: true });

  for (const item of COPY) {
    const source = path.join(ROOT, item);
    if (!fs.existsSync(source)) continue;
    const files = fs.statSync(source).isDirectory() ? walk(source) : [source];
    for (const file of files) {
      const relative = path.relative(ROOT, file);
      const target = path.join(DIST, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });

      // sw.js собираем последним — в него нужен хэш остальных файлов
      if (file.endsWith('.pmtiles') || relative === 'sw.js') {
        if (file.endsWith('.pmtiles')) fs.copyFileSync(file, target);
        continue;
      }

      const raw = fs.readFileSync(file);
      let output = raw;
      const text = minify(file, raw.toString('utf8'));
      if (text !== null) {
        let result = text;
        const entry = MODULE_ENTRIES[relative.replace(/\\/g, '/')];
        if (entry) result = addModulePreload(result, entry);
        output = Buffer.from(result, 'utf8');
      }
      fs.writeFileSync(target, output);
      stats.before += raw.length;
      stats.after += output.length;
      stats.files += 1;
    }
  }

  // Версия кэша Service Worker — хэш всей оболочки. Подставляем в
  // исходник до минификации, чтобы не зависеть от того, как esbuild
  // переименует или встроит константу.
  const hash = crypto.createHash('sha256');
  for (const file of walk(DIST).filter((f) => !f.endsWith('.pmtiles')).sort()) {
    hash.update(path.relative(DIST, file)).update(fs.readFileSync(file));
  }
  const swSource = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const version = `${swSource.match(/const VERSION = '([^']+)'/)[1]}-${hash.digest('hex').slice(0, 10)}`;
  const versioned = swSource.replace(/const VERSION = '[^']+'/, `const VERSION = '${version}'`);
  const swOutput = minify('sw.js', versioned);
  if (!swOutput.includes(`"${version}"`)) throw new Error('build: версия не попала в sw.js');
  fs.writeFileSync(path.join(DIST, 'sw.js'), swOutput);
  stats.before += Buffer.byteLength(swSource);
  stats.after += Buffer.byteLength(swOutput);
  stats.files += 1;

  const kb = (bytes) => `${(bytes / 1024).toFixed(1)} КБ`;
  console.log(`Готово: ${stats.files} файлов, ${kb(stats.before)} → ${kb(stats.after)} (без .pmtiles)`);
  console.log(`Service Worker: кэш shell-${version}`);
}

main();
