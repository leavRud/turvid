// Нижняя полоса: ползунок поверх профиля высоты, шкалы времени или шкалы километров.
// Полосу можно масштабировать: колесо мыши, щипок двумя пальцами, кнопки «−» и «+».
// Шкала времени: небо по солнцу со звёздами, темп линией, подписи привалов и ночёвок;
// впереди ползунка — приглушено (видно пройденное).

import type { DaySummary } from '../track/days';
import type { Stop } from '../track/stops';
import type { TrackData } from '../types';
import { h } from '../ui/dom';
import { formatDuration, formatKm, formatShortDate } from '../ui/format';
import { distanceAxis, timeAxis, type Axis, type TimeAxis } from './axis';
import { MAGNET_PX, magnetTarget } from './magnet';
import type { PositionStore } from './store';
import {
  edgeScroll,
  followView,
  pacePaths,
  paceSamples,
  panView,
  profilePath,
  REST_LABEL_MIN_S,
  restSpans,
  SKY_LAYERS,
  skyLayerOpacity,
  skyStops,
  starsFor,
  zoomView,
  type RestSpan,
  type Star,
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
/** Примерная ширина буквы подписи и поля плашки — чтобы подписи не налезали, px. */
const LABEL_CHAR_PX = 6.2;
const LABEL_PAD_PX = 14;
/** Звёзды — только в верхней части полосы (ниже идёт линия темпа), доля высоты. */
const STARS_TOP = 0.6;
/** Зона у края полосы, где ползунок прокручивает приближенную полосу, px. */
const EDGE_ZONE_PX = 32;
/** Скорость прокрутки у самого края: столько ширин окна в секунду. */
const EDGE_SPEED = 0.8;
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
  /** Позиции «магнитных» точек (с фото или заметкой) — к ним липнет ползунок. */
  magnetic: number[];
  modes: StripInfo;
  store: PositionStore;
  /** Начало трека, секунды Unix (для подписей дней и солнца); null — без времени. */
  startedAt: number | null;
  timezone: string;
}

export interface Strip {
  element: HTMLElement;
  /** Точки поменялись (создали, сдвинули, удалили). */
  setPoints(points: number[], magnetic: number[]): void;
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
  let points = opts.points;
  let magnetic = opts.magnetic;
  /** Где стоит ползунок на оси: при перетаскивании — под пальцем, а не по позиции. */
  let thumbX = 0;
  /** Шкала времени: звёзды и привалы с ночёвками — рисуются поверх, в пикселях. */
  let stars: Star[] = [];
  let rests: RestSpan[] = [];

  const svg = svgEl('svg', {
    class: 'strip-bg',
    viewBox: `0 0 ${VB_W} ${VB_H}`,
    preserveAspectRatio: 'none',
    'aria-hidden': 'true',
  });
  const starLayer = h('div', { class: 'strip-stars', 'aria-hidden': 'true' });
  const labels = h('div', { class: 'strip-labels', 'aria-hidden': 'true' });
  const marks = h('div', { class: 'strip-marks', 'aria-hidden': 'true' });
  // Впереди ползунка — вуаль: пройденное ярко, будущее приглушено.
  const veil = h('div', { class: 'strip-veil', 'aria-hidden': 'true' });
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
    starLayer,
    labels,
    marks,
    veil,
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
  /** Где позиция на оси: на шкале времени — по подсказке времени, если она есть (стоянка, сон). */
  const axisX = (pos: number): number => {
    const t = store.time();
    return timeline && t !== null ? timeline.timeToX(t) : axis.posToX(pos);
  };

  /** Фон и данные в координатах оси — пересобираются только при смене режима. */
  function renderContent(): void {
    svg.replaceChildren();
    modeButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset['mode'] === mode)));

    stars = [];
    rests = [];
    if (mode === 'timeline') {
      const ta = timeAxis(track, opts.days);
      axis = ta;
      timeline = ta;
      // Небо одной лентой через всю ось, включая сон: дневной цвет, поверх — золотой час,
      // заря, сумерки и ночь с прозрачностью по высоте солнца там, где был в этот момент.
      svg.append(rect(0, 1, 0, VB_H, 'strip-sky-day'));
      const defs = svgEl('defs', {});
      svg.append(defs);
      /** Градиент по оси: у каждого отсчёта свой класс цвета и своя непрозрачность. */
      const gradient = (cls: string, stops: { offset: number; opacity: number }[]): string => {
        const id = `strip-grad-${++gradientCounter}`;
        const grad = svgEl('linearGradient', {
          id,
          gradientUnits: 'userSpaceOnUse',
          x1: 0,
          x2: VB_W,
          y1: 0,
          y2: 0,
        });
        for (const st of stops) {
          grad.append(
            svgEl('stop', {
              offset: Math.round(st.offset * 10_000) / 10_000,
              class: cls,
              'stop-opacity': Math.round(st.opacity * 100) / 100,
            }),
          );
        }
        defs.append(grad);
        return `url(#${id})`;
      };
      const sky = opts.startedAt !== null ? skyStops(track, opts.startedAt, ta.xToTime) : [];
      if (sky.length) {
        SKY_LAYERS.forEach((layer, k) => {
          const r = rect(0, 1, 0, VB_H, '');
          r.setAttribute(
            'fill',
            gradient(
              `strip-sky-stop-${layer.name}`,
              sky.map((st) => ({
                offset: st.offset,
                opacity: skyLayerOpacity(st.alt)[k] as number,
              })),
            ),
          );
          svg.append(r);
        });
      }
      stars = starsFor(sky);

      // Темп линией: выше — быстрее, привал — линия на дне, в ночь не тянется.
      const pace = pacePaths(paceSamples(track, ta), VB_W, VB_H);
      svg.append(svgEl('path', { d: pace.area, class: 'strip-pace-area' }));
      const lineAttrs = { d: pace.line, 'vector-effect': 'non-scaling-stroke' };
      svg.append(svgEl('path', { ...lineAttrs, class: 'strip-pace-line' }));
      // Там, где стемнело, линия светлеет — второй слой поверх с прозрачностью «ночности».
      if (sky.length) {
        const night = svgEl('path', { ...lineAttrs, class: 'strip-pace-line' });
        // Через style: цвет линии из CSS-класса перебил бы атрибут stroke.
        night.style.stroke = gradient(
          'strip-pace-night-stop',
          sky.map((st) => ({ offset: st.offset, opacity: st.night })),
        );
        svg.append(night);
      }
      rests = restSpans(track, opts.stops, ta);
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
    thumbX = axisX(store.get());
  }

  /** Подписи, отметки и ползунок — зависят от окна масштаба, пересобираются при каждом сдвиге. */
  function renderOverlay(): void {
    svg.setAttribute('viewBox', `${view.a * VB_W} 0 ${(view.b - view.a) * VB_W} ${VB_H}`);
    labels.replaceChildren();
    marks.replaceChildren();
    starLayer.replaceChildren();
    const width = slider.clientWidth || VB_W;
    const minGap = LABEL_MIN_GAP_PX / width;

    const label = (x: number, text: string, cls: string): void => {
      const el = h('span', { class: `strip-label ${cls}` }, text);
      el.style.left = `${x * 100}%`;
      labels.append(el);
    };

    if (timeline) {
      /** Занятые подписями отрезки в пикселях: следующая подпись не налезает. */
      const taken: [number, number][] = [];
      const fits = (left: number, w: number): boolean => {
        if (left < 0 || left + w > width) return false;
        if (taken.some(([a, b]) => left < b + 4 && left + w > a - 4)) return false;
        taken.push([left, left + w]);
        return true;
      };
      const textWidth = (text: string): number => text.length * LABEL_CHAR_PX + LABEL_PAD_PX;

      timeline.days.forEach((d, i) => {
        if (d.x1 < view.a || d.x0 > view.b) return;
        const date =
          opts.startedAt !== null ? formatShortDate(opts.startedAt + d.startT, opts.timezone) : '';
        const text = `День ${i + 1}${date ? ` · ${date}` : ''}`;
        // Подпись дня — у его левого края, а если край за окном — у края окна.
        const f = Math.max(toLocal(d.x0), 0);
        taken.push([f * width, f * width + textWidth(text)]);
        label(f, text, 'strip-label-day');
      });

      // Ночёвки — первыми, потом привалы от 15 минут, длинные раньше коротких.
      const shown = rests
        .filter((r) => r.kind === 'night' || r.durationS >= REST_LABEL_MIN_S)
        .sort((a, b) =>
          a.kind !== b.kind ? (a.kind === 'night' ? -1 : 1) : b.durationS - a.durationS,
        );
      for (const r of shown) {
        const f = toLocal((r.x0 + r.x1) / 2);
        if (f < 0 || f > 1) continue;
        // Не влезает «ночёвка 14 ч 53 мин» — пробуем просто «14 ч 53 мин».
        const time = formatDuration(r.durationS);
        const text = [`${r.kind === 'night' ? 'ночёвка' : 'привал'} ${time}`, time].find((t) =>
          fits(f * width - textWidth(t) / 2, textWidth(t)),
        );
        if (text) label(f, text, 'strip-label-rest');
      }

      for (const st of stars) {
        const f = toLocal(st.x);
        if (f < 0 || f > 1) continue;
        const star = h('span', { class: 'strip-star' });
        star.style.left = `${f * 100}%`;
        star.style.top = `${st.y * STARS_TOP * 100}%`;
        star.style.width = star.style.height = `${st.size}px`;
        star.style.opacity = String(st.opacity);
        starLayer.append(star);
      }
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

    for (const p of points) {
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
    veil.style.left = `${Math.min(Math.max(f, 0), 1) * 100}%`;
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
    const f = localX(clientX);
    // Магнит: ближе 12 px к точке с фото или заметкой — приклеиваемся к ней.
    const width = slider.clientWidth || VB_W;
    const hit = magnetTarget(
      f * width,
      magnetic.map((p) => toLocal(axis.posToX(p)) * width),
      MAGNET_PX,
    );
    if (hit !== null) {
      const pos = magnetic[hit] as number;
      thumbX = axis.posToX(pos);
      updateThumb();
      store.set(pos, 'slider', null);
      return;
    }
    thumbX = fromLocal(f);
    updateThumb();
    store.set(axis.xToPos(thumbX), 'slider', timeline ? timeline.xToTime(thumbX) : null);
  }

  slider.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, e.clientX);
    slider.setPointerCapture(e.pointerId);
    lastClientX = e.clientX;
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
      lastClientX = e.clientX;
      fromPointer(e.clientX);
      edgeCheck();
    }
  });
  const end = (e: PointerEvent): void => {
    pointers.delete(e.pointerId);
    if (slider.hasPointerCapture(e.pointerId)) slider.releasePointerCapture(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (!pointers.size) dragging = false;
  };

  // Ползунок у края приближенной полосы — полоса сама едет дальше, можно листать.
  let lastClientX = 0;
  let edgeRaf = 0;
  let edgeTs = 0;
  function edgeIntensity(): number {
    const r = slider.getBoundingClientRect();
    if (!r.width) return 0;
    return edgeScroll((lastClientX - r.left) / r.width, EDGE_ZONE_PX / r.width);
  }
  function edgeCheck(): void {
    if (edgeRaf || view.b - view.a >= 1 || edgeIntensity() === 0) return;
    edgeTs = 0;
    edgeRaf = requestAnimationFrame(edgeFrame);
  }
  function edgeFrame(ts: number): void {
    edgeRaf = 0;
    const k = edgeIntensity();
    if (!dragging || k === 0) return;
    const dt = edgeTs ? Math.min((ts - edgeTs) / 1000, 0.1) : 0;
    edgeTs = ts;
    const next = panView(view, k * EDGE_SPEED * (view.b - view.a) * dt);
    if (next.a !== view.a) {
      setView(next);
      fromPointer(lastClientX);
    } else if (dt > 0) {
      return; // упёрлись в начало или конец
    }
    edgeRaf = requestAnimationFrame(edgeFrame);
  }
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
      thumbX = axisX(pos);
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
    setPoints(nextPoints, nextMagnetic) {
      points = nextPoints;
      magnetic = nextMagnetic;
      renderOverlay();
    },
    destroy() {
      unsubscribe();
      resize.disconnect();
      cancelAnimationFrame(edgeRaf);
    },
  };
}
