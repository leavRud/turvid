// Нижняя полоса: ползунок поверх профиля высоты, шкалы времени или шкалы километров.
// Полосу можно масштабировать: колесо мыши, щипок двумя пальцами, кнопки «−» и «+».

import type { DaySummary } from '../track/days';
import type { Stop } from '../track/stops';
import type { TrackData } from '../types';
import { h } from '../ui/dom';
import { formatKm, formatShortDate } from '../ui/format';
import { distanceAxis, timeAxis, type Axis, type TimeAxis } from './axis';
import type { PositionStore } from './store';
import {
  followView,
  nightStops,
  panView,
  profilePath,
  speedBands,
  stopMarks,
  zoomView,
  type StripInfo,
  type StripMode,
  type View,
} from './strip-model';

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Внутренняя система координат SVG: ось 0..1 → 0..1000, высота 100; растягивается на всю полосу. */
const VB_W = 1000;
const VB_H = 100;
/** Подписи ближе этого не показываем — налезут друг на друга, px. */
const LABEL_MIN_GAP_PX = 72;
/** Во сколько раз меняет масштаб кнопка «+» / «−». */
const ZOOM_STEP = 2;

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
  /** Начало трека, секунды Unix (для подписей дней и солнца); null — без времени. */
  startedAt: number | null;
  timezone: string;
}

export interface Strip {
  element: HTMLElement;
  destroy(): void;
}

let gradientCounter = 0;

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
    width: Math.max((x1 - x0) * VB_W, 0.05),
    height,
    class: cls,
  });
}

/** Шаг подписей километров для видимого куска длиной `visible` м: не больше ~8 штук. */
function kmStep(visible: number): number {
  const steps = [50, 100, 200, 500, 1000, 2000, 5000, 10_000, 20_000, 50_000, 100_000];
  return steps.find((s) => visible / s <= 8) ?? 200_000;
}

export function createStrip(opts: StripOptions): Strip {
  const { track, store } = opts;
  const length = store.length;
  let mode: StripMode = opts.modes.auto;
  let axis: Axis = distanceAxis(length);
  /** Ось времени, когда включена шкала времени. */
  let timeline: TimeAxis | null = null;
  /** Видимое окно оси: при масштабе ×1 — вся ось. */
  let view: View = { a: 0, b: 1 };
  /** Где стоит ползунок на оси: при перетаскивании — под пальцем, а не по позиции. */
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
  const zoomOut = h(
    'button',
    { type: 'button', class: 'strip-mode strip-zoom', 'aria-label': 'Отдалить полосу' },
    '−',
  );
  const zoomIn = h(
    'button',
    { type: 'button', class: 'strip-mode strip-zoom', 'aria-label': 'Приблизить полосу' },
    '+',
  );
  zoomOut.addEventListener('click', () => setView(zoomView(view, ZOOM_STEP, thumbX)));
  zoomIn.addEventListener('click', () => setView(zoomView(view, 1 / ZOOM_STEP, thumbX)));

  const toolbar = h(
    'div',
    { class: 'strip-toolbar' },
    modeButtons.length > 1
      ? h(
          'div',
          { class: 'strip-modes', role: 'group', 'aria-label': 'Режим полосы' },
          ...modeButtons,
        )
      : h('div', {}),
    h(
      'div',
      { class: 'strip-modes', role: 'group', 'aria-label': 'Масштаб полосы' },
      zoomOut,
      zoomIn,
    ),
  );

  const element = h('div', { class: 'strip' }, toolbar, slider);

  /** Ось → доля видимой ширины. */
  const toLocal = (x: number): number => (x - view.a) / (view.b - view.a);
  /** Доля видимой ширины → ось. */
  const fromLocal = (f: number): number => view.a + f * (view.b - view.a);

  /** Фон и данные в координатах оси — пересобираются только при смене режима. */
  function renderContent(): void {
    svg.replaceChildren();
    modeButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset['mode'] === mode)));

    if (mode === 'timeline') {
      const ta = timeAxis(track, opts.days);
      axis = ta;
      timeline = ta;
      const defs = svgEl('defs', {});
      svg.append(defs);
      // Ночь между днями — тёмная.
      svg.append(rect(0, 1, 0, VB_H, 'strip-night'));
      ta.days.forEach((d) => {
        svg.append(rect(d.x0, d.x1, 0, VB_H, 'strip-daylight'));
        if (opts.startedAt === null) return;
        // Поверх дня — темнота по высоте солнца: видно, где рассвет и закат.
        const id = `strip-night-${++gradientCounter}`;
        const grad = svgEl('linearGradient', { id, x1: 0, x2: 1, y1: 0, y2: 0 });
        for (const s of nightStops(track, opts.startedAt, d.startT, d.endT)) {
          grad.append(
            svgEl('stop', {
              offset: s.offset,
              class: 'strip-night-stop',
              'stop-opacity': Math.round(s.night * 100) / 100,
            }),
          );
        }
        defs.append(grad);
        const shade = rect(d.x0, d.x1, 0, VB_H, '');
        shade.setAttribute('fill', `url(#${id})`);
        svg.append(shade);
      });
      for (const s of stopMarks(track, opts.stops, ta.timeToX)) {
        svg.append(rect(s.x0, s.x1, 30, VB_H - 44, 'strip-stop'));
      }
      for (const b of speedBands(track, ta.timeToX)) {
        svg.append(rect(b.x0, b.x1, VB_H - 14, 14, `strip-speed speed-${b.level}`));
      }
    } else if (mode === 'profile') {
      axis = distanceAxis(length);
      timeline = null;
      svg.append(rect(0, 1, 0, VB_H, 'strip-daylight'));
      svg.append(
        svgEl('path', { d: profilePath(track, axis, VB_W, VB_H), class: 'strip-profile' }),
      );
    } else {
      axis = distanceAxis(length);
      timeline = null;
      svg.append(rect(0, 1, 0, VB_H, 'strip-daylight'));
    }
    thumbX = axis.posToX(store.get());
  }

  /** Подписи, отметки и ползунок — зависят от окна масштаба, пересобираются при каждом сдвиге. */
  function renderOverlay(): void {
    svg.setAttribute('viewBox', `${view.a * VB_W} 0 ${(view.b - view.a) * VB_W} ${VB_H}`);
    labels.replaceChildren();
    marks.replaceChildren();
    const width = slider.clientWidth || VB_W;
    const minGap = LABEL_MIN_GAP_PX / width;

    const label = (x: number, text: string, cls: string): void => {
      const el = h('span', { class: `strip-label ${cls}` }, text);
      el.style.left = `${x * 100}%`;
      labels.append(el);
    };

    if (timeline) {
      timeline.days.forEach((d, i) => {
        if (d.x1 < view.a || d.x0 > view.b) return;
        const date =
          opts.startedAt !== null ? formatShortDate(opts.startedAt + d.startT, opts.timezone) : '';
        // Подпись дня — у его левого края, а если край за окном — у края окна.
        label(
          Math.max(toLocal(d.x0), 0),
          `День ${i + 1}${date ? ` · ${date}` : ''}`,
          'strip-label-day',
        );
      });
    } else {
      const startM = axis.xToPos(view.a);
      const endM = axis.xToPos(view.b);
      const step = kmStep(endM - startM);
      let last = -Infinity;
      for (let d = Math.ceil(startM / step) * step; d <= endM; d += step) {
        if (d <= 0 || d >= length) continue;
        const f = toLocal(axis.posToX(d));
        const tick = h('span', { class: 'strip-tick' });
        tick.style.left = `${f * 100}%`;
        labels.append(tick);
        if (f - last >= minGap && 1 - f >= minGap / 2) {
          label(f, formatKm(d), 'strip-label-km');
          last = f;
        }
      }
    }

    for (const p of opts.points) {
      const f = toLocal(axis.posToX(p));
      if (f < 0 || f > 1) continue;
      const mark = h('span', { class: 'strip-point' });
      mark.style.left = `${f * 100}%`;
      marks.append(mark);
    }

    const zoomed = view.b - view.a < 1 - 1e-9;
    zoomOut.disabled = !zoomed;
    zoomIn.disabled = view.b - view.a <= 0.0100001;
    slider.classList.toggle('zoomed', zoomed);
    updateThumb();
  }

  function updateThumb(): void {
    const f = toLocal(thumbX);
    thumb.hidden = f < -0.001 || f > 1.001;
    thumb.style.left = `${f * 100}%`;
    const pos = store.get();
    slider.setAttribute('aria-valuenow', String(Math.round(pos)));
    slider.setAttribute('aria-valuetext', formatKm(pos));
  }

  function setView(next: View): void {
    if (next.a === view.a && next.b === view.b) return;
    view = next;
    renderOverlay();
  }

  function setMode(m: StripMode): void {
    if (m === mode) return;
    mode = m;
    view = { a: 0, b: 1 };
    renderContent();
    renderOverlay();
  }

  // Указатели: один — тянем ползунок, два — масштабируем щипком.
  const pointers = new Map<number, number>();
  let dragging = false;
  let pinch: { dist: number; view: View; at: number } | null = null;

  function localX(clientX: number): number {
    const r = slider.getBoundingClientRect();
    return Math.min(Math.max((clientX - r.left) / r.width, 0), 1);
  }

  function fromPointer(clientX: number): void {
    thumbX = fromLocal(localX(clientX));
    updateThumb();
    store.set(axis.xToPos(thumbX), 'slider');
  }

  slider.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, e.clientX);
    slider.setPointerCapture(e.pointerId);
    if (pointers.size === 2) {
      const [x1, x2] = [...pointers.values()] as [number, number];
      dragging = false;
      pinch = { dist: Math.abs(x2 - x1) || 1, view, at: fromLocal(localX((x1 + x2) / 2)) };
      return;
    }
    dragging = true;
    slider.focus({ preventScroll: true });
    fromPointer(e.clientX);
  });
  slider.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, e.clientX);
    if (pinch && pointers.size >= 2) {
      const [x1, x2] = [...pointers.values()] as [number, number];
      const dist = Math.abs(x2 - x1) || 1;
      setView(zoomView(pinch.view, pinch.dist / dist, pinch.at));
    } else if (dragging) {
      fromPointer(e.clientX);
    }
  });
  const end = (e: PointerEvent): void => {
    pointers.delete(e.pointerId);
    if (slider.hasPointerCapture(e.pointerId)) slider.releasePointerCapture(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (!pointers.size) dragging = false;
  };
  slider.addEventListener('pointerup', end);
  slider.addEventListener('pointercancel', end);

  // Колесо: вверх-вниз — масштаб вокруг курсора, вбок или с Shift — сдвиг.
  slider.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const w = view.b - view.a;
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        const delta = (e.shiftKey ? e.deltaY : e.deltaX) / (slider.clientWidth || VB_W);
        setView(panView(view, delta * w));
      } else {
        setView(zoomView(view, Math.exp(e.deltaY * 0.002), fromLocal(localX(e.clientX))));
      }
    },
    { passive: false },
  );

  const unsubscribe = store.subscribe((pos, source) => {
    if (source !== 'slider') {
      thumbX = axis.posToX(pos);
      // Полоса прокручивается за стрелкой, если та ушла за край окна.
      const next = followView(view, thumbX);
      if (next !== view) {
        view = next;
        renderOverlay();
        return;
      }
    }
    updateThumb();
  });

  // Подписи прореживаются по ширине в пикселях — при смене ширины перерисовываем.
  let lastWidth = 0;
  const resize = new ResizeObserver(() => {
    const w = slider.clientWidth;
    if (Math.abs(w - lastWidth) < 8) return;
    lastWidth = w;
    renderOverlay();
  });
  resize.observe(slider);

  renderContent();
  renderOverlay();
  return {
    element,
    destroy() {
      unsubscribe();
      resize.disconnect();
    },
  };
}
