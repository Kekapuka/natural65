#!/usr/bin/env node
// =====================================================================
// Проверка списка SHELL_ASSETS в sw.js
//
// Если файл, нужный странице, не попал в список — он не откроется
// офлайн. Если в списке есть несуществующий файл — Service Worker не
// установится совсем, и офлайн-режим пропадёт целиком.
//
//   node scripts/check-sw-assets.js
//
// Скрипт собирает локальные CSS/JS/картинки из публичных страниц,
// проходит по import'ам ES-модулей и сравнивает со списком.
// =====================================================================

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PAGES = { '/': 'index.html', '/sos': 'sos.html', '/info': 'info.html' };
// Подгружаются кодом по имени, а не через src/href/import
const DYNAMIC = ['/locales/ru.json', '/locales/en.json', '/locales/zh.json',
  '/locales/ja.json', '/locales/ko.json', '/locales/es.json'];

const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

const sw = read('sw.js');
const listed = new Set([...sw.match(/const SHELL_ASSETS = \[([\s\S]*?)\];/)[1]
  .matchAll(/'([^']+)'/g)].map((m) => m[1]));

const needed = new Set([...Object.keys(PAGES), ...DYNAMIC]);

function addModule(url) {
  if (needed.has(url) && url.endsWith('.js') && needed.has(`${url}#seen`)) return;
  needed.add(url);
  needed.add(`${url}#seen`);
  const source = read(url.slice(1));
  for (const [, spec] of source.matchAll(/^\s*import\s[^'"]*['"](\.{1,2}\/[^'"]+)['"]/gm)) {
    addModule(path.posix.join(path.posix.dirname(url), spec));
  }
}

for (const file of Object.values(PAGES)) {
  const html = read(file);
  for (const [, attr, url] of html.matchAll(/\s(src|href)="(\/[^"#?]*)"/g)) {
    if (url === '/' || url === '/sos' || url === '/info') continue;
    if (attr === 'src' && url.endsWith('.js')) addModule(url);
    else needed.add(url);
  }
  // Скрипты, которые встроенный код подключает по строке ('/js/…', '/assets/…')
  for (const [, url] of html.matchAll(/['"](\/(?:js|assets)\/[^'"]+\.js)['"]/g)) {
    if (url.startsWith('/js/')) addModule(url);
    else needed.add(url);
  }
  // CDN-скрипты и стили тоже должны быть в списке
  for (const [, url] of html.matchAll(/\s(?:src|href)="(https:\/\/(?:cdnjs|unpkg|cdn\.jsdelivr)[^"]+)"/g)) {
    needed.add(url);
  }
}

const neededClean = [...needed].filter((u) => !u.endsWith('#seen'));
const missing = neededClean.filter((u) => !listed.has(u));
const notFound = [...listed].filter((u) => u.startsWith('/') && !PAGES[u] &&
  !fs.existsSync(path.join(ROOT, u.slice(1))));

if (missing.length) console.log('Нет в SHELL_ASSETS:\n  ' + missing.join('\n  '));
if (notFound.length) console.log('В SHELL_ASSETS, но файла нет:\n  ' + notFound.join('\n  '));
if (!missing.length && !notFound.length) {
  console.log(`OK: ${listed.size} файлов, все нужные страницам — в списке.`);
} else {
  process.exit(1);
}
