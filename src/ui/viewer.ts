// Полноэкранный просмотр фото и видео: листание свайпом и стрелками, подпись — точка и время.

import type { MediaItem } from '../types';
import { h } from './dom';

export interface ViewerItem {
  media: MediaItem;
  /** Подпись: название точки и время съёмки. */
  caption: string;
}

/** Свайп короче этого — не листание, px. */
const SWIPE_PX = 50;

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

  function show(): void {
    const item = items[index] as ViewerItem;
    const m = item.media;
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

  // Свайп влево-вправо по картинке.
  let startX: number | null = null;
  stage.addEventListener('pointerdown', (e) => {
    startX = e.clientX;
  });
  stage.addEventListener('pointerup', (e) => {
    if (startX === null) return;
    const dx = e.clientX - startX;
    startX = null;
    if (Math.abs(dx) >= SWIPE_PX) go(dx < 0 ? 1 : -1);
  });

  open = true;
  document.addEventListener('keydown', onKey, true);
  document.body.classList.add('viewer-open');
  document.body.append(root);
  show();
  close.focus();
}
