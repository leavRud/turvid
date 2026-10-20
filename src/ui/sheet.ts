// Шторка снизу для панели точки на телефоне: краешек с заголовком или почти весь экран.
// Тянется пальцем за край; щелчок по краю — открыть/свернуть. На широком экране — обычная панель.

import { h } from './dom';
import { snapSheet, toggleSheet, type SheetHeights, type SheetState } from './sheet-snap';

/** Высота краешка — столько шторки видно в свёрнутом виде, px. */
export const SHEET_PEEK_PX = 64;
/** Сверху оставляем полоску карты, чтобы было видно, где ты, px. */
const TOP_GAP_PX = 96;
/** Палец сдвинулся меньше — это щелчок, а не жест, px. */
const TAP_PX = 6;

export interface Sheet {
  element: HTMLElement;
  setTitle(text: string): void;
  open(state: SheetState): void;
  state(): SheetState;
  destroy(): void;
}

/** onChange — шторка встала в новое положение; height — её высота, px (0 на широком экране). */
export function createSheet(
  content: HTMLElement,
  onChange: (state: SheetState, height: number) => void = () => undefined,
): Sheet {
  const title = h('span', { class: 'sheet-title' });
  const head = h(
    'div',
    {
      class: 'sheet-head',
      role: 'button',
      tabindex: '0',
      'aria-label': 'Открыть или свернуть панель',
      'aria-expanded': 'false',
    },
    h('span', { class: 'sheet-grip', 'aria-hidden': 'true' }),
    title,
  );
  const body = h('div', { class: 'sheet-body' }, content);
  const element = h('section', { class: 'sheet', 'data-state': 'peek' }, head, body);

  const mq = window.matchMedia?.('(max-width: 899px)') ?? null;
  const isMobile = (): boolean => mq?.matches ?? false;
  let current: SheetState = 'peek';

  /** Высоты положений: от высоты окна и нижней полосы с ползунком. */
  function heights(): SheetHeights {
    const bottom = element.getBoundingClientRect().bottom || window.innerHeight;
    const full = Math.max(SHEET_PEEK_PX * 2, bottom - TOP_GAP_PX);
    return { peek: SHEET_PEEK_PX, full };
  }

  function apply(state: SheetState, animate = true): void {
    current = state;
    element.dataset['state'] = state;
    head.setAttribute('aria-expanded', String(state !== 'peek'));
    if (!isMobile()) {
      element.style.height = '';
      onChange(state, 0);
      return;
    }
    element.classList.toggle('dragging', !animate);
    const height = heights()[state];
    element.style.height = `${height}px`;
    onChange(state, height);
    if (state === 'peek') body.scrollTop = 0;
  }

  // Жест за край шторки.
  let start: { y: number; h: number; t: number } | null = null;
  let lastY = 0;
  let lastT = 0;
  let velocity = 0;
  head.addEventListener('pointerdown', (e) => {
    if (!isMobile()) return;
    start = { y: e.clientY, h: element.getBoundingClientRect().height, t: e.timeStamp };
    lastY = e.clientY;
    lastT = e.timeStamp;
    velocity = 0;
    try {
      head.setPointerCapture(e.pointerId);
    } catch {
      // указатель уже отпущен
    }
  });
  head.addEventListener('pointermove', (e) => {
    if (!start) return;
    const hs = heights();
    const next = Math.min(Math.max(start.h + (start.y - e.clientY), hs.peek), hs.full);
    element.classList.add('dragging');
    element.style.height = `${next}px`;
    const dt = e.timeStamp - lastT;
    if (dt > 0) velocity = (lastY - e.clientY) / dt;
    lastY = e.clientY;
    lastT = e.timeStamp;
  });
  const end = (e: PointerEvent): void => {
    if (!start) return;
    const moved = Math.abs(e.clientY - start.y);
    const height = element.getBoundingClientRect().height;
    start = null;
    if (head.hasPointerCapture(e.pointerId)) head.releasePointerCapture(e.pointerId);
    apply(moved < TAP_PX ? toggleSheet(current) : snapSheet(height, velocity, heights()));
  };
  head.addEventListener('pointerup', end);
  head.addEventListener('pointercancel', end);
  head.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      apply(toggleSheet(current));
    }
  });

  // Поворот экрана, смена ширины — пересчитать высоту; на широком экране — обычная панель.
  const onResize = (): void => apply(current, false);
  window.addEventListener('resize', onResize);
  mq?.addEventListener('change', onResize);
  requestAnimationFrame(() => apply(current, false));

  return {
    element,
    setTitle(text) {
      if (title.textContent !== text) title.textContent = text;
    },
    open(state) {
      if (isMobile()) apply(state);
    },
    state: () => current,
    destroy() {
      window.removeEventListener('resize', onResize);
      mq?.removeEventListener('change', onResize);
    },
  };
}
