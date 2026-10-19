// Тема: светлая, тёмная или как в системе. Выбор запоминается; смена — без перезагрузки.

import { h } from './dom';

export type ThemeChoice = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'turvid-theme';
/** Событие на window: тема поменялась (выбором или настройкой системы). */
export const THEME_EVENT = 'turvid-theme';

const media = (): MediaQueryList | null =>
  window.matchMedia?.('(prefers-color-scheme: dark)') ?? null;

export function getThemeChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

/** Тёмная ли сейчас тема на самом деле (с учётом системы). */
export function isDarkTheme(): boolean {
  const choice = getThemeChoice();
  return choice === 'dark' || (choice === 'system' && (media()?.matches ?? false));
}

function apply(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
  root.style.colorScheme = isDarkTheme() ? 'dark' : 'light';
  window.dispatchEvent(new Event(THEME_EVENT));
}

export function setThemeChoice(choice: ThemeChoice): void {
  try {
    if (choice === 'system') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    // без хранилища выбор живёт до перезагрузки
  }
  apply(choice);
}

/** Применить сохранённый выбор и следить за системной темой. Вызывается один раз при старте. */
export function initTheme(): void {
  apply(getThemeChoice());
  media()?.addEventListener('change', () => {
    if (getThemeChoice() === 'system') apply('system');
  });
}

/** Подписка на смену темы. Возвращает отписку. */
export function onThemeChange(cb: () => void): () => void {
  window.addEventListener(THEME_EVENT, cb);
  return () => window.removeEventListener(THEME_EVENT, cb);
}

const LABELS: Record<ThemeChoice, string> = {
  system: 'Как в системе',
  light: 'Светлая',
  dark: 'Тёмная',
};

/** Выпадающий переключатель темы для шапок экранов. */
export function themeSwitcher(): HTMLElement {
  const select = h('select', { class: 'theme-select', 'aria-label': 'Тема' });
  (Object.keys(LABELS) as ThemeChoice[]).forEach((c) => {
    select.append(h('option', { value: c, selected: c === getThemeChoice() }, LABELS[c]));
  });
  select.addEventListener('change', () => setThemeChoice(select.value as ThemeChoice));
  return select;
}
