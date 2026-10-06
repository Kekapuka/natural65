// =====================================================================
// Навигационная сетка для быстрой оценки расстояний
//
// Клетка — 100 × 100 м. Когда карта отдалена и клетки 100 м
// сливаются (меньше 24 px), сетка переходит на 1 км, а ещё дальше
// скрывается. Каждая десятая линия сетки 100 м — километровая,
// она толще. Подпись в углу показывает текущий размер клетки.
//
// Рисуется на одном canvas в своей панели между тайлами и метками.
// =====================================================================

import { t } from '../i18n/i18n.js';
import { getItem, setItem } from '../core/storage.js';

const STEPS_M = [100, 1000];
const MIN_CELL_PX = 24;
const METERS_PER_DEGREE_LAT = 111320;
const EARTH_CIRCUMFERENCE_M = 40075016.686;
const LINE_COLOR = 'rgba(20, 35, 22, 0.42)';
const MAJOR_LINE_COLOR = 'rgba(20, 35, 22, 0.7)';

export function createGrid(map, legend) {
  const pane = map.createPane('grid');
  pane.style.zIndex = '350';
  pane.style.pointerEvents = 'none';
  const canvas = L.DomUtil.create('canvas', 'grid-canvas', pane);
  const ctx = canvas.getContext('2d');

  let visible = false;

  function metersPerPixel() {
    const lat = map.getCenter().lat * Math.PI / 180;
    return EARTH_CIRCUMFERENCE_M * Math.cos(lat) / (256 * 2 ** map.getZoom());
  }

  function strokeLines(lines, color, width) {
    if (lines.length === 0) return;
    ctx.beginPath();
    for (const [x1, y1, x2, y2] of lines) {
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
  }

  function draw() {
    if (!visible) return;

    const size = map.getSize();
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== size.x * dpr || canvas.height !== size.y * dpr) {
      canvas.width = size.x * dpr;
      canvas.height = size.y * dpr;
      canvas.style.width = `${size.x}px`;
      canvas.style.height = `${size.y}px`;
    }
    L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.x, size.y);

    const mpp = metersPerPixel();
    const step = STEPS_M.find((meters) => meters / mpp >= MIN_CELL_PX);
    if (!step) {
      legend.hidden = true;
      return;
    }
    legend.hidden = false;
    legend.textContent = t(step === 100 ? 'grid.cell100' : 'grid.cell1000');

    // Опорная широта округляется до 0,5°, чтобы клетки не «плыли»
    // при перемещении карты и оставались почти квадратными
    const refLat = Math.round(map.getCenter().lat * 2) / 2;
    const dLat = step / METERS_PER_DEGREE_LAT;
    const dLng = step / (METERS_PER_DEGREE_LAT * Math.cos(refLat * Math.PI / 180));
    const bounds = map.getBounds();
    const minor = [];
    const major = [];

    for (let i = Math.floor(bounds.getSouth() / dLat); i * dLat <= bounds.getNorth(); i++) {
      const { y } = map.latLngToContainerPoint([i * dLat, bounds.getWest()]);
      const row = [0, Math.round(y) + 0.5, size.x, Math.round(y) + 0.5];
      (step === 100 && i % 10 === 0 ? major : minor).push(row);
    }
    for (let j = Math.floor(bounds.getWest() / dLng); j * dLng <= bounds.getEast(); j++) {
      const { x } = map.latLngToContainerPoint([bounds.getSouth(), j * dLng]);
      const column = [Math.round(x) + 0.5, 0, Math.round(x) + 0.5, size.y];
      (step === 100 && j % 10 === 0 ? major : minor).push(column);
    }

    strokeLines(minor, LINE_COLOR, 1);
    strokeLines(major, MAJOR_LINE_COLOR, 2);
  }

  map.on('move resize viewreset zoomend', draw);
  map.on('zoomstart', () => { canvas.style.visibility = 'hidden'; });
  map.on('zoomend', () => { canvas.style.visibility = ''; });

  return {
    setVisible(on) {
      visible = on;
      canvas.hidden = !on;
      if (on) draw();
      else legend.hidden = true;
    },
  };
}

// Кнопка «Сетка»: выбор пользователя запоминается, а режим экономии
// батареи может временно отключить сетку, не меняя этот выбор
export function setupGridToggle(button, grid) {
  let enabled = getItem('grid', 'on') === 'on';
  let suspended = false;

  function apply() {
    button.setAttribute('aria-pressed', String(enabled && !suspended));
    button.disabled = suspended;
    grid.setVisible(enabled && !suspended);
  }

  button.addEventListener('click', () => {
    enabled = !enabled;
    setItem('grid', enabled ? 'on' : 'off');
    apply();
  });

  apply();

  return {
    setSuspended(on) {
      suspended = on;
      apply();
    },
  };
}
