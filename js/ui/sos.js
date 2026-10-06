// =====================================================================
// Экран SOS (sos.html)
//
// Отдельный обычный скрипт без модулей и зависимостей: страница
// должна открываться мгновенно и без интернета (кэширует sw.js,
// включая словари /locales/*.json). Язык — как в приложении:
// ?lang= → сохранённый выбор → язык браузера → русский. Если словарь
// не загрузился, остаётся русский текст из разметки и строки ниже.
// Пока спутники не дали точку — показываем последнюю сохранённую
// картой (ключ совпадает с LAST_POSITION_KEY в js/map/geolocation.js).
// =====================================================================

(function () {
  'use strict';

  var LAST_POSITION_KEY = 'priroda65:lastPosition';
  var LANG_KEY = 'priroda65:lang';
  var LANGS = ['ru', 'en', 'zh', 'ja', 'ko', 'es'];
  var GPS_OPTIONS = { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 };

  // Русские строки на случай, если словарь недоступен
  var FALLBACK = {
    'sosPage.copy': 'Скопировать',
    'sosPage.copied': 'Скопировано ✓',
    'sosPage.accuracy': 'Точность {accuracy} · {time}',
    'sosPage.lastKnown': 'Последнее известное положение · {age}',
    'sosPage.searchingShort': 'Ищем сигнал GPS…',
    'sosPage.ageNow': 'меньше минуты назад',
    'sosPage.ageMin': '{n} мин назад',
    'sosPage.ageHours': '{n} ч назад',
    'sosPage.meters': '±{n} м',
    'sosPage.north': 'с. ш.',
    'sosPage.south': 'ю. ш.',
    'sosPage.east': 'в. д.',
    'sosPage.west': 'з. д.',
    'sosPage.smsBody': 'SOS. Мои координаты: {coords}{accuracy}. {dms}',
    'sosPage.unsupported': 'Этот браузер не умеет определять координаты. Позвоните 112.',
    'sosPage.denied': 'Нет доступа к геолокации. Разрешите его в настройках браузера или позвоните 112 и опишите, где вы.',
    'sosPage.noSignal': 'Нет сигнала GPS. Выйдите на открытое место, подальше от скал и густых деревьев.',
  };

  var messages = FALLBACK;
  var lang = 'ru';

  var ddEl = document.getElementById('coords-dd');
  var dmsEl = document.getElementById('coords-dms');
  var metaEl = document.getElementById('coords-meta');
  var copyButton = document.getElementById('coords-copy');
  var smsLink = document.getElementById('coords-sms');

  var current = null;
  var currentIsLive = false;
  var lastError = null;

  function t(key, params) {
    var text = Object.prototype.hasOwnProperty.call(messages, key) ? messages[key] : (FALLBACK[key] || key);
    if (params) {
      text = text.replace(/\{(\w+)\}/g, function (match, name) {
        return Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match;
      });
    }
    return text;
  }

  function readStorage(key) {
    try {
      return localStorage.getItem(key);
    } catch (err) {
      return null;
    }
  }

  function detectLang() {
    var fromUrl = new URLSearchParams(window.location.search).get('lang');
    if (LANGS.indexOf(fromUrl) !== -1) return fromUrl;
    var saved = readStorage(LANG_KEY);
    if (LANGS.indexOf(saved) !== -1) return saved;
    var tags = navigator.languages || [navigator.language];
    for (var i = 0; i < tags.length; i++) {
      var base = String(tags[i]).toLowerCase().split('-')[0];
      if (LANGS.indexOf(base) !== -1) return base;
    }
    return 'ru';
  }

  function translatePage() {
    var nodes = document.querySelectorAll('[data-i18n]');
    for (var i = 0; i < nodes.length; i++) {
      var key = nodes[i].getAttribute('data-i18n');
      if (Object.prototype.hasOwnProperty.call(messages, key)) nodes[i].textContent = messages[key];
    }
    document.documentElement.lang = lang;
  }

  function toDms(value, positive, negative) {
    var hemisphere = value >= 0 ? positive : negative;
    var abs = Math.abs(value);
    var degrees = Math.floor(abs);
    var minutesFull = (abs - degrees) * 60;
    var minutes = Math.floor(minutesFull);
    var seconds = (minutesFull - minutes) * 60;
    if (seconds >= 59.95) {
      seconds = 0;
      minutes += 1;
    }
    var secondsText = seconds.toLocaleString(lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    return degrees + '°' + minutes + '′' + secondsText + '″ ' + hemisphere;
  }

  function formatTime(timestamp) {
    return new Date(timestamp).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function formatAge(timestamp) {
    var minutes = Math.round((Date.now() - timestamp) / 60000);
    if (minutes < 1) return t('sosPage.ageNow');
    if (minutes < 60) return t('sosPage.ageMin', { n: minutes });
    var hours = Math.floor(minutes / 60);
    if (hours < 48) return t('sosPage.ageHours', { n: hours });
    return new Date(timestamp).toLocaleDateString(lang);
  }

  function decimalText(position) {
    return position.lat.toFixed(5) + ', ' + position.lng.toFixed(5);
  }

  function accuracyText(position) {
    return position.accuracy ? t('sosPage.meters', { n: Math.round(position.accuracy) }) : '';
  }

  function render() {
    if (!current) {
      if (lastError) metaEl.textContent = lastError;
      return;
    }
    var accuracy = accuracyText(current);
    ddEl.textContent = decimalText(current);
    dmsEl.textContent = toDms(current.lat, t('sosPage.north'), t('sosPage.south')) + '   ' +
      toDms(current.lng, t('sosPage.east'), t('sosPage.west'));

    if (currentIsLive) {
      metaEl.textContent = t('sosPage.accuracy', { accuracy: accuracy, time: formatTime(current.timestamp) });
    } else {
      // Сохранённая точка остаётся на экране — уточняем, почему нет новой
      metaEl.textContent = t('sosPage.lastKnown', { age: formatAge(current.timestamp) }) +
        (accuracy ? ' · ' + accuracy : '') + '. ' + (lastError || t('sosPage.searchingShort'));
    }
    metaEl.classList.toggle('is-stale', !currentIsLive);

    var body = t('sosPage.smsBody', {
      coords: decimalText(current),
      accuracy: accuracy ? ' (' + accuracy + ')' : '',
      dms: dmsEl.textContent,
    });
    // «sms:?&body=» понимают и Android, и iOS
    smsLink.href = 'sms:?&body=' + encodeURIComponent(body);
    smsLink.removeAttribute('aria-disabled');
    copyButton.disabled = false;
  }

  function readLastPosition() {
    try {
      var saved = JSON.parse(readStorage(LAST_POSITION_KEY));
      if (saved && isFinite(saved.lat) && isFinite(saved.lng) && saved.timestamp) return saved;
    } catch (err) {
      // повреждённые данные — игнорируем
    }
    return null;
  }

  function saveLastPosition(position) {
    try {
      localStorage.setItem(LAST_POSITION_KEY, JSON.stringify(position));
    } catch (err) {
      // без сохранения тоже работаем
    }
  }

  copyButton.addEventListener('click', function () {
    if (!current || !navigator.clipboard) return;
    navigator.clipboard.writeText(decimalText(current)).then(function () {
      copyButton.textContent = t('sosPage.copied');
      setTimeout(function () { copyButton.textContent = t('sosPage.copy'); }, 2000);
    }, function () {});
  });

  smsLink.addEventListener('click', function (event) {
    if (!current) event.preventDefault();
  });

  function startGps() {
    if (!('geolocation' in navigator)) {
      lastError = t('sosPage.unsupported');
      render();
      return;
    }
    navigator.geolocation.watchPosition(function (pos) {
      current = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        timestamp: pos.timestamp,
      };
      currentIsLive = true;
      lastError = null;
      saveLastPosition(current);
      render();
    }, function (error) {
      lastError = error.code === error.PERMISSION_DENIED ? t('sosPage.denied') : t('sosPage.noSignal');
      if (!currentIsLive) render();
    }, GPS_OPTIONS);
  }

  // Координаты и GPS — сразу, не дожидаясь словаря
  lang = detectLang();
  current = readLastPosition();
  render();
  startGps();

  if (lang !== 'ru') {
    fetch('/locales/' + lang + '.json')
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (dictionary) {
        if (!dictionary) return;
        messages = dictionary;
        translatePage();
        render();
      })
      .catch(function () {});
  }
})();
