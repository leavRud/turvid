// Полноэкранный просмотр фото и видео: листание свайпом и стрелками, подпись — точка и время.

import type { MediaItem } from '../types';
import { h } from './dom';
import { clampZoom, doubleTap, NO_ZOOM, pinch, zoomAt, type Box, type Zoom } from './zoom';

export interface ViewerItem {
  media: MediaItem;
  /** Подпись: название точки и время съёмки. */
  caption: string;
}

/** Свайп короче этого — не листание, px. */
const SWIPE_PX = 50;
/** Палец сдвинулся меньше и отпустил быстрее — это тап, px и мс. */
const TAP_PX = 10;
const TAP_MS = 300;
/** Два тапа в пределах — двойной тап, мс. */
const DOUBLE_TAP_MS = 300;
/** Насколько приближает один «щелчок» колеса (на единицу deltaY). */
const WHEEL_ZOOM = 0.002;

let open = false;

/** Открыт ли просмотр — тогда клавиши экрана похода не работают. */
export function isViewerOpen(): boolean {
  return open;
}

export function openViewer(items: ViewerItem[], startIndex: number): void {
  if (!items.length) return;
  let index = Math.min(Math.max(startIndex, 0), items.length - 1);

  const stage = h('div', { class: 'viewer-stage' });
  const caption = h('p', { class: 'viewer-caption' });
  const counter = h('span', { class: 'viewer-counter' });
  const prev = h(
    'button',
    { type: 'button', class: 'viewer-nav viewer-prev', 'aria-label': 'Предыдущее' },
    '‹',
  );
  const next = h(
    'button',
    { type: 'button', class: 'viewer-nav viewer-next', 'aria-label': 'Следующее' },
    '›',
  );
  const close = h(
    'button',
    { type: 'button', class: 'viewer-close', 'aria-label': 'Закрыть' },
    '✕',
  );
  const root = h(
    'div',
    { class: 'viewer', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Просмотр фото' },
    stage,
    prev,
    next,
    close,
    h('div', { class: 'viewer-bar' }, caption, counter),
  );

  /** Приближение текущего фото; при листании — снова целиком. */
  let zoom: Zoom = NO_ZOOM;

  function show(): void {
    const item = items[index] as ViewerItem;
    const m = item.media;
    zoom = NO_ZOOM;
    stage.classList.remove('zoomed');
    stage.replaceChildren(
      m.kind === 'video'
        ? h('video', {
            src: m.url,
            poster: m.thumbUrl,
            controls: true,
            autoplay: true,
            playsinline: true,
            class: 'viewer-media',
          })
        : // draggable=false: свайп мышью листает, а не тащит картинку.
          h('img', {
            src: m.url,
            alt: item.caption,
            class: 'viewer-media',
            decoding: 'async',
            draggable: 'false',
          }),
    );
    caption.textContent = item.caption;
    counter.textContent = items.length > 1 ? `${index + 1} / ${items.length}` : '';
    prev.hidden = index === 0;
    next.hidden = index === items.length - 1;
  }

  const go = (d: number): void => {
    const nextIndex = index + d;
    if (nextIndex < 0 || nextIndex >= items.length) return;
    index = nextIndex;
    show();
  };

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') hide();
    else if (e.key === 'ArrowLeft') go(-1);
    else if (e.key === 'ArrowRight') go(1);
    else return;
    e.preventDefault();
    e.stopPropagation();
  }

  function hide(): void {
    open = false;
    document.removeEventListener('keydown', onKey, true);
    root.remove();
    document.body.classList.remove('viewer-open');
  }

  prev.addEventListener('click', () => go(-1));
  next.addEventListener('click', () => go(1));
  close.addEventListener('click', hide);

  // Жесты: фото целиком — свайп листает; приближено — палец двигает фото;
  // два пальца — щипок; двойной тап — приблизить/вернуть; колесо — приблизить к курсору.
  const pointers = new Map<number, { x: number; y: number }>();
  let gesture:
    | { kind: 'swipe'; x0: number; y0: number; t0: number }
    | { kind: 'pan'; z0: Zoom; x0: number; y0: number; t0: number; moved: boolean }
    | { kind: 'pinch'; z0: Zoom; d0: number; mx0: number; my0: number }
    | null = null;
  let lastTap = { t: 0, x: 0, y: 0 };

  const photo = (): HTMLImageElement | null => stage.querySelector('img');
  const boxOf = (el: HTMLElement): Box => ({
    w: el.offsetWidth,
    h: el.offsetHeight,
    stageW: stage.clientWidth,
    stageH: stage.clientHeight,
  });
  /** Экранная точка — от центра сцены. */
  const rel = (x: number, y: number): [number, number] => {
    const r = stage.getBoundingClientRect();
    return [x - r.left - r.width / 2, y - r.top - r.height / 2];
  };
  const twoFingers = (): { d: number; mx: number; my: number } => {
    const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
    const [mx, my] = rel((a.x + b.x) / 2, (a.y + b.y) / 2);
    return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx, my };
  };
  function applyZoom(z: Zoom, animate = false): void {
    zoom = z;
    const el = photo();
    if (!el) return;
    el.style.transition = animate ? 'transform 0.2s ease-out' : '';
    el.style.transform = z.s === 1 ? '' : `translate(${z.x}px, ${z.y}px) scale(${z.s})`;
    stage.classList.toggle('zoomed', z.s > 1);
  }
  const startOne = (x: number, y: number, t: number): void => {
    gesture =
      zoom.s > 1
        ? { kind: 'pan', z0: zoom, x0: x, y0: y, t0: t, moved: false }
        : { kind: 'swipe', x0: x, y0: y, t0: t };
  };

  stage.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    // Захват — только у фото: у видео нажатия должны доходить до кнопок плеера.
    if (photo()) {
      try {
        stage.setPointerCapture(e.pointerId);
      } catch {
        // указатель уже отпущен
      }
    }
    if (pointers.size === 2 && photo()) {
      const f = twoFingers();
      gesture = { kind: 'pinch', z0: zoom, d0: f.d, mx0: f.mx, my0: f.my };
    } else if (pointers.size === 1) {
      startOne(e.clientX, e.clientY, e.timeStamp);
    }
  });
  stage.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const el = photo();
    if (!el || !gesture) return;
    if (gesture.kind === 'pinch' && pointers.size >= 2) {
      const f = twoFingers();
      const g = gesture;
      applyZoom(pinch(g.z0, g.d0, g.mx0, g.my0, f.d, f.mx, f.my, boxOf(el)));
    } else if (gesture.kind === 'pan') {
      const dx = e.clientX - gesture.x0;
      const dy = e.clientY - gesture.y0;
      if (Math.hypot(dx, dy) > TAP_PX) gesture.moved = true;
      applyZoom(
        clampZoom({ ...gesture.z0, x: gesture.z0.x + dx, y: gesture.z0.y + dy }, boxOf(el)),
      );
    }
  });
  const end = (e: PointerEvent): void => {
    if (!pointers.delete(e.pointerId)) return;
    const g = gesture;
    if (g?.kind === 'pinch') {
      // Один палец остался — продолжаем двигать им, без листания.
      const rest = [...pointers.values()][0];
      if (rest) startOne(rest.x, rest.y, e.timeStamp);
      else gesture = null;
      return;
    }
    gesture = null;
    if (!g || e.type === 'pointercancel') return;
    const dx = e.clientX - g.x0;
    const dy = e.clientY - g.y0;
    const tap = Math.hypot(dx, dy) <= TAP_PX && e.timeStamp - g.t0 < TAP_MS;
    if (tap && photo()) {
      // Второй тап рядом и быстро — приблизить в эту точку или вернуть.
      if (
        e.timeStamp - lastTap.t < DOUBLE_TAP_MS &&
        Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < TAP_PX * 3
      ) {
        const [cx, cy] = rel(e.clientX, e.clientY);
        applyZoom(doubleTap(zoom, cx, cy, boxOf(photo() as HTMLElement)), true);
        lastTap = { t: 0, x: 0, y: 0 };
      } else {
        lastTap = { t: e.timeStamp, x: e.clientX, y: e.clientY };
      }
      return;
    }
    if (g.kind === 'swipe' && Math.abs(dx) >= SWIPE_PX && Math.abs(dx) > Math.abs(dy)) {
      go(dx < 0 ? 1 : -1);
    }
  };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);
  stage.addEventListener(
    'wheel',
    (e) => {
      const el = photo();
      if (!el) return;
      e.preventDefault();
      const [cx, cy] = rel(e.clientX, e.clientY);
      applyZoom(zoomAt(zoom, zoom.s * Math.exp(-e.deltaY * WHEEL_ZOOM), cx, cy, boxOf(el)));
    },
    { passive: false },
  );

  open = true;
  document.addEventListener('keydown', onKey, true);
  document.body.classList.add('viewer-open');
  document.body.append(root);
  show();
  close.focus();
}
