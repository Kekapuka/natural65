// =====================================================================
// Панель модерации: очередь заявок, карта, правка и смена статуса
//
// Весь пользовательский текст выводится через textContent — заявки
// приходят от анонимов, и это главное место, куда целилась бы XSS.
// Изменения идут напрямую в Supabase от имени вошедшего админа;
// RLS пропускает их только для пользователей из public.admins.
// =====================================================================

import { config } from '../core/config.js';
import { cleanText, safeHttpsUrl, safeColor } from '../core/sanitize.js';
import { createPinIcon, categoryLabel } from '../markers/markers.js';
import { showToast } from '../ui/toast.js';

const STATUSES = ['pending', 'approved', 'rejected'];
const COLUMNS = 'id,latitude,longitude,title,description,category,icon_url,status,created_at';
const LIST_LIMIT = 200;
const ICON_BUCKET = 'marker-icons';
const ICON_MAX_BYTES = 256 * 1024;
const ICON_TYPES = ['image/png', 'image/webp'];
const FALLBACK_COLOR = '#4F5E51';

const ACTIONS = {
  pending: [
    { label: 'Одобрить', status: 'approved', primary: true },
    { label: 'Отклонить', status: 'rejected' },
    { label: 'Изменить', edit: true },
  ],
  approved: [
    { label: 'Изменить', edit: true },
    { label: 'Снять с карты', status: 'rejected', danger: true },
  ],
  rejected: [
    { label: 'Одобрить', status: 'approved', primary: true },
    { label: 'Изменить', edit: true },
    { label: 'Удалить', remove: true, danger: true },
  ],
};

const dateFormat = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

export function setupModeration(sb) {
  const list = document.getElementById('marker-list');
  const tabs = [...document.querySelectorAll('.admin-tab')];
  const itemTemplate = document.getElementById('marker-item-template');
  const editTemplate = document.getElementById('marker-edit-template');
  const { bounds, limits } = config;

  let status = 'pending';
  let markers = [];
  let categories = [];
  let editingId = null;
  const layers = new Map(); // id → L.marker

  // ---------- Карта ----------

  const map = L.map('admin-map', { center: config.map.center, zoom: config.map.zoom });
  protomapsL.leafletLayer({
    url: config.tiles.url,
    flavor: config.tiles.flavor,
    lang: 'ru',
    maxDataZoom: config.tiles.maxDataZoom,
    attribution: '<a href="https://protomaps.com">Protomaps</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  const markerGroup = L.layerGroup().addTo(map);

  function categoryColor(slug) {
    const category = categories.find((c) => c.slug === slug);
    return safeColor(category?.color, FALLBACK_COLOR);
  }

  function categoryIcon(slug) {
    return safeHttpsUrl(categories.find((c) => c.slug === slug)?.icon_url);
  }

  function drawMarkers() {
    markerGroup.clearLayers();
    layers.clear();
    for (const marker of markers) {
      const layer = L.marker([marker.latitude, marker.longitude], {
        icon: createPinIcon({
          color: categoryColor(marker.category),
          iconUrl: safeHttpsUrl(marker.icon_url) ?? categoryIcon(marker.category),
        }),
        title: marker.title,
      });
      layer.on('click', () => focusItem(marker.id));
      layer.addTo(markerGroup);
      layers.set(marker.id, layer);
    }
    if (markers.length) {
      map.fitBounds(L.latLngBounds(markers.map((m) => [m.latitude, m.longitude])), {
        padding: [40, 40], maxZoom: 14,
      });
    }
  }

  function focusItem(id) {
    const item = list.querySelector(`[data-id="${Number(id)}"]`);
    list.querySelectorAll('.mod-item.is-selected').forEach((el) => el.classList.remove('is-selected'));
    if (item) {
      item.classList.add('is-selected');
      item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    const layer = layers.get(id);
    if (layer) map.setView(layer.getLatLng(), Math.max(map.getZoom(), 13));
  }

  // ---------- Данные ----------

  async function loadCategories() {
    const { data, error } = await sb.from('categories').select('slug,color,icon_url,sort_order').order('sort_order');
    if (error) throw error;
    categories = data;
  }

  async function loadCounts() {
    await Promise.all(STATUSES.map(async (s) => {
      const { count, error } = await sb.from('markers').select('id', { count: 'exact', head: true }).eq('status', s);
      document.querySelector(`[data-count="${s}"]`).textContent = error ? '?' : String(count ?? 0);
    }));
  }

  async function loadList() {
    const { data, error } = await sb
      .from('markers')
      .select(COLUMNS)
      .eq('status', status)
      // Очередь — с самых старых, остальное — с новых
      .order('created_at', { ascending: status === 'pending' })
      .limit(LIST_LIMIT);
    if (error) throw error;
    markers = data;
  }

  async function reload() {
    editingId = null;
    list.textContent = '';
    list.setAttribute('aria-busy', 'true');
    try {
      if (!categories.length) await loadCategories();
      await Promise.all([loadList(), loadCounts()]);
      renderList();
      drawMarkers();
    } catch (err) {
      console.error(err);
      showToast(`Не удалось загрузить метки: ${err.message}`, { type: 'error' });
    } finally {
      list.removeAttribute('aria-busy');
    }
  }

  // ---------- Список ----------

  function renderList() {
    list.textContent = '';
    if (!markers.length) {
      const empty = document.createElement('li');
      empty.className = 'mod-empty';
      empty.textContent = status === 'pending'
        ? 'Новых заявок нет — очередь пуста.'
        : 'Здесь пока ничего нет.';
      list.append(empty);
      return;
    }
    markers.forEach((marker) => list.append(renderItem(marker)));
  }

  function renderItem(marker) {
    const item = itemTemplate.content.firstElementChild.cloneNode(true);
    item.dataset.id = String(marker.id);

    const category = item.querySelector('[data-category]');
    category.textContent = categoryLabel(marker.category);
    category.style.setProperty('--chip-color', categoryColor(marker.category));

    const date = item.querySelector('[data-date]');
    date.dateTime = marker.created_at;
    date.textContent = dateFormat.format(new Date(marker.created_at));

    item.querySelector('[data-title]').textContent = marker.title;
    const description = item.querySelector('[data-description]');
    description.textContent = marker.description ?? '';
    description.hidden = !marker.description;
    item.querySelector('[data-coords]').textContent =
      `${marker.latitude.toFixed(5)}, ${marker.longitude.toFixed(5)}`;

    const actions = item.querySelector('[data-actions]');
    for (const action of ACTIONS[status]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `btn ${action.primary ? 'btn--primary' : 'btn--ghost'}${action.danger ? ' btn--danger' : ''}`;
      button.textContent = action.label;
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        if (action.edit) startEdit(marker, item);
        else if (action.remove) removeMarker(marker);
        else setStatus(marker, action.status, button);
      });
      actions.append(button);
    }

    item.addEventListener('click', (event) => {
      if (event.target.closest('form')) return;
      focusItem(marker.id);
    });
    return item;
  }

  function dropFromList(id) {
    markers = markers.filter((m) => m.id !== id);
    list.querySelector(`[data-id="${Number(id)}"]`)?.remove();
    const layer = layers.get(id);
    if (layer) markerGroup.removeLayer(layer);
    layers.delete(id);
    if (!markers.length) renderList();
  }

  // ---------- Действия ----------

  async function setStatus(marker, nextStatus, button) {
    button.disabled = true;
    // .select() нужен, чтобы отличить успех от «0 строк»: если RLS
    // не пустил, Supabase не вернёт ошибку, а просто ничего не изменит
    const { data, error } = await sb.from('markers').update({ status: nextStatus }).eq('id', marker.id).select('id');
    button.disabled = false;
    if (error || !data?.length) {
      showToast(`Не удалось изменить статус: ${error?.message ?? 'нет прав'}`, { type: 'error' });
      return;
    }
    dropFromList(marker.id);
    loadCounts();
    showToast(nextStatus === 'approved'
      ? `«${marker.title}» опубликована. На карте появится в течение минуты.`
      : `«${marker.title}» отклонена.`, { type: 'success' });
  }

  async function removeMarker(marker) {
    if (!window.confirm(`Удалить метку «${marker.title}» навсегда?`)) return;
    const { data, error } = await sb.from('markers').delete().eq('id', marker.id).select('id');
    if (error || !data?.length) {
      showToast(`Не удалось удалить: ${error?.message ?? 'нет прав'}`, { type: 'error' });
      return;
    }
    dropFromList(marker.id);
    loadCounts();
    showToast('Метка удалена.', { type: 'success' });
  }

  // ---------- Иконки ----------

  async function listIcons() {
    const { data, error } = await sb.storage.from(ICON_BUCKET).list('', {
      limit: 200, sortBy: { column: 'name', order: 'asc' },
    });
    if (error) {
      console.error(error);
      return [];
    }
    return data
      .filter((file) => file.id && /\.(png|webp)$/i.test(file.name))
      .map((file) => ({
        name: file.name,
        url: sb.storage.from(ICON_BUCKET).getPublicUrl(file.name).data.publicUrl,
      }));
  }

  async function uploadIcon(file) {
    if (!ICON_TYPES.includes(file.type)) throw new Error('Нужен файл PNG или WebP.');
    if (file.size > ICON_MAX_BYTES) throw new Error('Файл больше 256 КБ.');
    const base = file.name.toLowerCase().replace(/\.[a-z]+$/, '').replace(/[^a-z0-9-]+/g, '-').slice(0, 40) || 'icon';
    const extension = file.type === 'image/png' ? 'png' : 'webp';
    const path = `${Date.now()}-${base}.${extension}`;
    const { error } = await sb.storage.from(ICON_BUCKET).upload(path, file, {
      contentType: file.type, upsert: false,
    });
    if (error) throw error;
    return { name: path, url: sb.storage.from(ICON_BUCKET).getPublicUrl(path).data.publicUrl };
  }

  // ---------- Редактирование ----------

  async function startEdit(marker, item) {
    if (editingId !== null) cancelEdit();
    editingId = marker.id;
    focusItem(marker.id);

    const card = item.querySelector('.mod-item__card');
    card.hidden = true;
    const form = editTemplate.content.firstElementChild.cloneNode(true);
    item.append(form);

    const { elements } = form;
    elements.title.value = marker.title;
    elements.description.value = marker.description ?? '';
    elements.latitude.value = marker.latitude.toFixed(5);
    elements.longitude.value = marker.longitude.toFixed(5);
    categories.forEach(({ slug }) => elements.category.add(new Option(categoryLabel(slug), slug)));
    elements.category.value = marker.category;

    const preview = form.querySelector('[data-icon-preview]');
    const errorBox = form.querySelector('[data-edit-error]');
    const updatePreview = () => {
      const url = safeHttpsUrl(elements.icon_url.value);
      preview.hidden = !url;
      if (url) preview.src = url;
    };

    const icons = await listIcons();
    const currentIcon = safeHttpsUrl(marker.icon_url);
    if (currentIcon && !icons.some((icon) => icon.url === currentIcon)) {
      icons.unshift({ name: 'текущая', url: currentIcon });
    }
    icons.forEach((icon) => elements.icon_url.add(new Option(icon.name, icon.url)));
    elements.icon_url.value = currentIcon ?? '';
    updatePreview();
    elements.icon_url.addEventListener('change', updatePreview);

    elements.icon_file.addEventListener('change', async () => {
      const file = elements.icon_file.files[0];
      if (!file) return;
      errorBox.hidden = true;
      try {
        const icon = await uploadIcon(file);
        elements.icon_url.add(new Option(icon.name, icon.url));
        elements.icon_url.value = icon.url;
        updatePreview();
        showToast('Иконка загружена.', { type: 'success' });
      } catch (err) {
        errorBox.textContent = `Иконка не загружена: ${err.message}`;
        errorBox.hidden = false;
      } finally {
        elements.icon_file.value = '';
      }
    });

    // Точку двигаем прямо на карте
    const layer = layers.get(marker.id);
    const syncFromMap = () => {
      const { lat, lng } = layer.getLatLng();
      elements.latitude.value = lat.toFixed(5);
      elements.longitude.value = lng.toFixed(5);
    };
    const syncToMap = () => {
      const lat = Number(elements.latitude.value);
      const lng = Number(elements.longitude.value);
      if (Number.isFinite(lat) && Number.isFinite(lng)) layer.setLatLng([lat, lng]);
    };
    if (layer) {
      layer.dragging.enable();
      layer.on('drag', syncFromMap);
      elements.latitude.addEventListener('input', syncToMap);
      elements.longitude.addEventListener('input', syncToMap);
    }

    form.querySelector('[data-edit-cancel]').addEventListener('click', cancelEdit);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      errorBox.hidden = true;

      const title = cleanText(elements.title.value);
      const description = cleanText(elements.description.value, { multiline: true });
      const latitude = Number(elements.latitude.value);
      const longitude = Number(elements.longitude.value);
      const category = elements.category.value;
      const iconUrl = elements.icon_url.value ? safeHttpsUrl(elements.icon_url.value) : null;

      const problems = [];
      if (title.length < limits.titleMin || title.length > limits.titleMax) problems.push('название — от 3 до 80 символов');
      if (description.length > limits.descriptionMax) problems.push('описание — до 1000 символов');
      if (!(latitude >= bounds.latMin && latitude <= bounds.latMax &&
            longitude >= bounds.lonMin && longitude <= bounds.lonMax)) problems.push('координаты должны быть на Сахалине');
      if (!categories.some((c) => c.slug === category)) problems.push('выберите категорию');
      if (problems.length) {
        errorBox.textContent = `Проверьте: ${problems.join('; ')}.`;
        errorBox.hidden = false;
        return;
      }

      const submit = form.querySelector('[type="submit"]');
      submit.disabled = true;
      const { data, error } = await sb
        .from('markers')
        .update({ title, description: description || null, latitude, longitude, category, icon_url: iconUrl })
        .eq('id', marker.id)
        .select(COLUMNS);
      submit.disabled = false;

      if (error || !data?.length) {
        errorBox.textContent = `Не сохранено: ${error?.message ?? 'нет прав'}`;
        errorBox.hidden = false;
        return;
      }

      const updated = data[0];
      markers = markers.map((m) => (m.id === updated.id ? updated : m));
      editingId = null;
      if (layer) layer.dragging.disable();
      item.replaceWith(renderItem(updated));
      drawMarkers();
      focusItem(updated.id);
      showToast('Сохранено.', { type: 'success' });
    });

    elements.title.focus();
  }

  function cancelEdit() {
    const item = list.querySelector(`[data-id="${Number(editingId)}"]`);
    const marker = markers.find((m) => m.id === editingId);
    editingId = null;
    if (item && marker) item.replaceWith(renderItem(marker));
    drawMarkers(); // вернуть точку на место и выключить перетаскивание
  }

  // ---------- Вкладки ----------

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      status = tab.dataset.status;
      tabs.forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
      reload();
    });
  });
  document.getElementById('refresh').addEventListener('click', reload);

  // Leaflet должен узнать размер контейнера после показа панели
  setTimeout(() => map.invalidateSize(), 0);

  return { reload };
}
