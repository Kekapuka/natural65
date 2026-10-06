#!/usr/bin/env node
// =====================================================================
// Вырезает Сахалин из свежей сборки Protomaps в tiles/sakhalin-ГГГГММДД.pmtiles
//
// Нужен CLI pmtiles: https://github.com/protomaps/go-pmtiles/releases
// (в PATH или путь в переменной PMTILES_BIN).
//
//   node scripts/extract-tiles.js            # последняя сборка, zoom 0–15
//   node scripts/extract-tiles.js 20261006   # конкретная сборка
//
// После выполнения обновите tiles.url и tiles.sizeBytes в
// js/core/config.js и загрузите файл в хранилище (см. README).
// Данные OpenStreetMap — ODbL: атрибуция OSM обязательна (есть на карте).
// =====================================================================

const { execFileSync } = require('node:child_process');
const { statSync, mkdirSync } = require('node:fs');
const path = require('node:path');

// Совпадает с config.bounds
const BBOX = '141.5,45.8,145.0,54.5';
const MAX_ZOOM = 15;
const BUILDS_URL = 'https://build-metadata.protomaps.dev/builds.json';
const PMTILES = process.env.PMTILES_BIN || 'pmtiles';

async function latestBuild() {
  const response = await fetch(BUILDS_URL);
  if (!response.ok) throw new Error(`builds.json: HTTP ${response.status}`);
  const builds = await response.json();
  return builds[builds.length - 1].key.replace('.pmtiles', '');
}

async function main() {
  const build = process.argv[2] || await latestBuild();
  if (!/^\d{8}$/.test(build)) throw new Error(`Неверная сборка: ${build}`);

  const outDir = path.join(__dirname, '..', 'tiles');
  mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, `sakhalin-${build}.pmtiles`);

  console.log(`Сборка ${build} → ${out}`);
  execFileSync(PMTILES, [
    'extract',
    `https://build.protomaps.com/${build}.pmtiles`,
    out,
    `--bbox=${BBOX}`,
    `--maxzoom=${MAX_ZOOM}`,
  ], { stdio: 'inherit' });

  const size = statSync(out).size;
  console.log('\nОбновите js/core/config.js:');
  console.log(`  url: '/tiles/sakhalin-${build}.pmtiles',  // или адрес в хранилище`);
  console.log(`  sizeBytes: ${size},`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
