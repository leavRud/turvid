// Нижняя полоса: ползунок поверх профиля высоты, шкалы времени или шкалы километров.

import type { DaySummary } from '../track/days';
import type { Stop } from '../track/stops';
import type { TrackData } from '../types';
import { h } from '../ui/dom';
import { formatDuration, formatKm, formatShortDate } from '../ui/format';
import { distanceAxis, timeAxis, type Axis } from './axis';
import type { PositionStore } from './store';
import { profilePath, speedBands, stopMarks, type StripInfo, type StripMode } from './strip-model';

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Внутренняя система координат SVG: ширина 1000, высота H; растягивается на всю полосу. */
const VB_W = 1000;
const VB_H = 100;
/** Подписи ближе этого не показываем — налезут друг на друга, px. */
const LABEL_MIN_GAP_PX = 72;

const MODE_TITLES: Record<StripMode, string> = {
  profile: 'Высота',
  timeline: 'Время',
  slider: 'Км',
};

export interface StripOptions {
  track: TrackData;
  days: DaySummary[];
  stops: Stop[];
  /** Позиции точек, м. */
  points: number[];
  modes: StripInfo;
  store: PositionStore;
  /** Начало трека, секунды Unix (для подписей дней); null — без времени. */
  startedAt: number | null;
  timezone: string;
}

export interface Strip {
  element: HTMLElement;
  destroy(): void;
}

function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

function rect(x0: number, x1: number, y: number, height: number, cls: string): SVGRectElement {
  return svgEl('rect', {
    x: x0 * VB_W,
    y,
    width: Math.max((x1 - x0) * VB_W, 1),
    height,
    class: cls,
  });
}

/** Шаг подписей километров: не больше ~8 штук. */
function kmStep(length: number): number {
  const steps = [100, 200, 500, 1000, 2000, 5000, 10_000, 20_000, 50_000, 100_000];
  return steps.find((s) => length / s <= 8) ?? 200_000;
}

export function createStrip(opts: StripOptions): Strip {
  const { track, store } = opts;
  const length = store.length;
  let mode: StripMode = opts.modes.auto;
  let axis: Axis = distanceAxis(length);
  /** Где стоит ползунок, доля ширины: при перетаскивании — под пальцем, а не по позиции. */
  let thumbX = 0;

  const svg = svgEl('svg', {
    class: 'strip-bg',
    viewBox: `0 0 ${VB_W} ${VB_H}`,
    preserveAspectRatio: 'none',
    'aria-hidden': 'true',
  });
  const labels = h('div', { class: 'strip-labels', 'aria-hidden': 'true' });
  const marks = h('div', { class: 'strip-marks', 'aria-hidden': 'true' });
  const thumb = h('div', { class: 'strip-thumb' });
  const slider = h(
    'div',
    {
      class: 'strip-track',
      role: 'slider',
      tabindex: '0',
      'aria-label': 'Позиция на треке',
      'aria-valuemin': '0',
      'aria-valuemax': String(Math.round(length)),
    },
    svg,
    labels,
    marks,
    thumb,
  );

  const modeButtons = opts.modes.available.map((m) => {
    const b = h('button', { type: 'button', class: 'strip-mode', 'data-mode': m }, MODE_TITLES[m]);
    b.addEventListener('click', () => setMode(m));
    return b;
  });
  const modeGroup =
    modeButtons.length > 1
      ? h(
          'div',
          { class: 'strip-modes', role: 'group', 'aria-label': 'Режим полосы' },
          ...modeButtons,
        )
      : null;

  const element = h('div', { class: 'strip' }, modeGroup, slider);

  function label(x: number, text: string, cls = ''): HTMLElement {
    const el = h('span', { class: `strip-label ${cls}`.trim() }, text);
    el.style.left = `${x * 100}%`;
    return el;
  }

  function render(): void {
    const minGap = LABEL_MIN_GAP_PX / (slider.clientWidth || VB_W);
    svg.replaceChildren();
    labels.replaceChildren();
    marks.replaceChildren();
    modeButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset['mode'] === mode)));

    if (mode === 'timeline') {
      const ta = timeAxis(track, opts.days);
      axis = ta;
      ta.days.forEach((d, i) => {
        svg.append(rect(d.x0, d.x1, 0, VB_H, 'strip-day'));
        const date =
          opts.startedAt !== null ? formatShortDate(opts.startedAt + d.startT, opts.timezone) : '';
        labels.append(label(d.x0, `День ${i + 1}${date ? ` · ${date}` : ''}`, 'strip-label-day'));
      });
      for (const b of speedBands(track, ta.timeToX)) {
        svg.append(rect(b.x0, b.x1, VB_H - 14, 14, `strip-speed speed-${b.level}`));
      }
      let lastLabel = -1;
      for (const s of stopMarks(track, opts.stops, ta.timeToX)) {
        svg.append(rect(s.x0, s.x1, 30, VB_H - 44, 'strip-stop'));
        const mid = (s.x0 + s.x1) / 2;
        if (s.labeled && mid - lastLabel >= minGap) {
          labels.append(label(mid, formatDuration(s.durationS), 'strip-label-stop'));
          lastLabel = mid;
        }
      }
    } else if (mode === 'profile') {
      axis = distanceAxis(length);
      svg.append(
        svgEl('path', { d: profilePath(track, axis, VB_W, VB_H), class: 'strip-profile' }),
      );
    } else {
      axis = distanceAxis(length);
      svg.append(rect(0, 1, 0, VB_H, 'strip-day'));
    }

    // Шкала километров — в профиле и в режиме «только ползунок».
    if (mode !== 'timeline') {
      const step = kmStep(length);
      let lastKm = 0;
      for (let d = step; d < length; d += step) {
        const x = axis.posToX(d);
        svg.append(rect(x, x, VB_H - 10, 10, 'strip-tick'));
        if (x - lastKm >= minGap && 1 - x >= minGap / 2) {
          labels.append(label(x, formatKm(d), 'strip-label-km'));
          lastKm = x;
        }
      }
    }

    for (const p of opts.points) {
      const mark = h('span', { class: 'strip-point' });
      mark.style.left = `${axis.posToX(p) * 100}%`;
      marks.append(mark);
    }
    thumbX = axis.posToX(store.get());
    updateThumb();
  }

  function updateThumb(): void {
    thumb.style.left = `${thumbX * 100}%`;
    const pos = store.get();
    slider.setAttribute('aria-valuenow', String(Math.round(pos)));
    slider.setAttribute('aria-valuetext', formatKm(pos));
  }

  function setMode(m: StripMode): void {
    if (m === mode) return;
    mode = m;
    render();
  }

  // Ползунок: тянем пальцем или мышью по всей высоте полосы.
  let dragging = false;
  function fromPointer(e: PointerEvent): void {
    const r = slider.getBoundingClientRect();
    thumbX = Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1);
    updateThumb();
    store.set(axis.xToPos(thumbX), 'slider');
  }
  slider.addEventListener('pointerdown', (e) => {
    dragging = true;
    slider.setPointerCapture(e.pointerId);
    slider.focus({ preventScroll: true });
    fromPointer(e);
  });
  slider.addEventListener('pointermove', (e) => {
    if (dragging) fromPointer(e);
  });
  const end = (e: PointerEvent): void => {
    dragging = false;
    if (slider.hasPointerCapture(e.pointerId)) slider.releasePointerCapture(e.pointerId);
  };
  slider.addEventListener('pointerup', end);
  slider.addEventListener('pointercancel', end);

  const unsubscribe = store.subscribe((pos, source) => {
    if (source !== 'slider') thumbX = axis.posToX(pos);
    updateThumb();
  });

  // Подписи прореживаются по ширине в пикселях — при смене ширины перерисовываем.
  let lastWidth = 0;
  const resize = new ResizeObserver(() => {
    const w = slider.clientWidth;
    if (Math.abs(w - lastWidth) < 8) return;
    lastWidth = w;
    render();
  });
  resize.observe(slider);

  render();
  return {
    element,
    destroy() {
      unsubscribe();
      resize.disconnect();
    },
  };
}
