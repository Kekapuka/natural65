// =====================================================================
// Приветствие при первом запуске и обязательный дисклеймер
//
// Три шага: знакомство → офлайн-карта → правовое предупреждение.
// Первые два можно пропустить, третий — нет: окно не закрывается
// клавишей Esc, пока не нажата кнопка «Принимаю».
// Согласие хранится с номером версии текста: если дисклеймер
// изменится, увеличьте DISCLAIMER_VERSION — его покажут заново.
// =====================================================================

import { getItem, setItem } from '../core/storage.js';

// При изменении поправьте и встроенный скрипт в index.html
const DISCLAIMER_VERSION = '1';
const STORAGE_KEY = 'disclaimerAccepted';

export function isDisclaimerAccepted() {
  return getItem(STORAGE_KEY) === DISCLAIMER_VERSION;
}

// onDone({ wantsOfflineMap }) — вызывается после согласия
export function runOnboarding({ onDone } = {}) {
  const dialog = document.getElementById('onboarding');
  const steps = [...dialog.querySelectorAll('[data-step]')];
  const dots = [...dialog.querySelectorAll('.onboarding__dot')];
  let current = 0;
  let wantsOfflineMap = false;

  function show(index, { animate = true } = {}) {
    current = index;
    steps.forEach((step, i) => {
      step.hidden = i !== index;
      step.classList.toggle('is-entering', animate && i === index);
    });
    dots.forEach((dot, i) => dot.classList.toggle('is-active', i === index));
    dialog.setAttribute('aria-labelledby', steps[index].querySelector('h2').id || '');
    steps[index].querySelector('.btn--primary')?.focus();
  }

  dialog.querySelectorAll('[data-onboarding-next]').forEach((button) => {
    button.addEventListener('click', () => {
      if (button.hasAttribute('data-onboarding-download')) wantsOfflineMap = true;
      show(Math.min(current + 1, steps.length - 1));
    });
  });

  dialog.querySelector('[data-onboarding-skip]').addEventListener('click', () => {
    show(steps.length - 1);
  });

  let accepted = false;

  dialog.querySelector('[data-onboarding-accept]').addEventListener('click', () => {
    accepted = true;
    setItem(STORAGE_KEY, DISCLAIMER_VERSION);
    dialog.close();
    onDone?.({ wantsOfflineMap });
  });

  // Без согласия окно не закрыть. Отмены cancel недостаточно:
  // Chrome закрывает диалог по второму Esc подряд даже при
  // preventDefault, поэтому при закрытии без согласия открываем снова.
  dialog.addEventListener('cancel', (event) => event.preventDefault());
  dialog.addEventListener('close', () => {
    if (!accepted) dialog.showModal();
  });

  steps.forEach((step, i) => {
    const heading = step.querySelector('h2');
    if (!heading.id) heading.id = `onboarding-title-${i + 1}`;
  });

  // Окно может быть уже открыто встроенным скриптом в index.html.
  // showModal ставит фокус на первый элемент (выбор языка) —
  // показываем шаг после него, чтобы фокус был на главной кнопке
  if (!dialog.open) dialog.showModal();
  show(0, { animate: false });
}
