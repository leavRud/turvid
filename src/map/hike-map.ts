// Карта похода: подложка OpenFreeMap, трек по дням, пройденная часть, точки и стрелка.

import 'maplibre-gl/dist/maplibre-gl.css';
import {
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  setWorkerUrl,
  type GeoJSONSource,
  type IControl,
} from 'maplibre-gl';
import mapWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { MAGNET_PX, magnetTarget } from '../player/magnet';
import { bearingAt, pointAt } from '../player/position';
import type { PositionStore } from '../player/store';
import { splitDays } from '../track/days';
import { nearestOnTrack } from '../track/nearest';
import type { Point, TrackData } from '../types';
import { h } from '../ui/dom';
import { followStep } from './follow';
import { followTheme, mapStyleUrl } from './style';
import { MEDIA_DRAG_TYPE } from '../ui/drag';

// Воркер MapLibre ищется по относительному адресу, который Vite при сборке теряет; отдаём его явно.
setWorkerUrl(mapWorkerUrl);

/** Перетаскивая стрелку, ищем ближайшее место только в этом окне вокруг позиции, м. */
export const DRAG_WINDOW_M = 1000;
/**
 * Курсор дальше этого от трека — стрелка стоит, экранные пиксели.
 * В ТЗ было 50 м, но на общем виде это доля пикселя; решили считать в пикселях (раздел 9 ТЗ).
 */
export const DRAG_MAX_OFFSET_PX = 30;
/** Долгое нажатие на карту, мс. */
const LONG_PRESS_MS = 600;
/** Палец сдвинулся больше — это уже не долгое нажатие и не клик, px. */
const MOVE_TOLERANCE_PX = 8;

type Coord = [number, number];

/** Место на треке. */
export interface TrackPlace {
  pos: number;
  lat: number;
  lon: number;
}

export interface HikeMapOptions {
  container: HTMLElement;
  track: TrackData;
  bbox: [number, number, number, number];
  points: Point[];
  store: PositionStore;
  /** Текст плашки у стрелки для позиции. */
  label: (pos: number) => string;
  /** Позиции «магнитных» точек (с фото или заметкой) — к ним липнет стрелка. */
  magnetic: () => number[];
  /** Можно ли двигать точки и ставить новые долгим нажатием. */
  editable: boolean;
  onPointMove?: (point: Point, place: TrackPlace) => void;
  onLongPress?: (place: TrackPlace) => void;
  /** Фото из лотка бросили на карту — в ближайшее место трека. */
  onDropMedia?: (mediaId: string, place: TrackPlace) => void;
}

export interface HikeMap {
  setPoints(points: Point[]): void;
  destroy(): void;
}

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Трек по дням: ночь не рисуется перелётом. */
function dayLines(track: TrackData): Coord[][] {
  return splitDays(track.t, track.lat.length).map(({ start, end }) => {
    const line: Coord[] = [];
    for (let i = start; i <= end; i++) line.push([track.lon[i] as number, track.lat[i] as number]);
    return line;
  });
}

/** Пройденная часть до позиции, тоже по дням. */
function passedLines(track: TrackData, pos: number): Coord[][] {
  const here = pointAt(track, pos);
  const lines: Coord[][] = [];
  for (const { start, end } of splitDays(track.t, track.lat.length)) {
    if (here.index < start) break;
    const partial = here.index < end;
    const last = partial ? here.index : end;
    const line: Coord[] = [];
    for (let i = start; i <= last; i++) line.push([track.lon[i] as number, track.lat[i] as number]);
    if (partial) line.push([here.lon, here.lat]);
    if (line.length >= 2) lines.push(line);
    if (partial) break;
  }
  return lines;
}

const multiLine = (lines: Coord[][]): GeoJSON.Feature<GeoJSON.MultiLineString> => ({
  type: 'Feature',
  properties: {},
  geometry: { type: 'MultiLineString', coordinates: lines },
});

/** Кнопка «Следовать» на карте. */
class FollowControl implements IControl {
  readonly button: HTMLButtonElement;
  private readonly root: HTMLElement;
  constructor(onClick: () => void) {
    this.button = h(
      'button',
      { type: 'button', class: 'map-follow', 'aria-pressed': 'true' },
      'Следовать',
    );
    this.button.addEventListener('click', onClick);
    this.root = h('div', { class: 'maplibregl-ctrl' }, this.button);
  }
  onAdd(): HTMLElement {
    return this.root;
  }
  onRemove(): void {
    this.root.remove();
  }
}

export function createHikeMap(opts: HikeMapOptions): HikeMap {
  const { container, track, bbox, store, label } = opts;
  const map = new MapLibreMap({
    container,
    style: mapStyleUrl(),
    bounds: [
      [bbox[0], bbox[1]],
      [bbox[2], bbox[3]],
    ],
    fitBoundsOptions: { padding: 40 },
    // Стрелки клавиатуры двигают позицию, а не карту; поворот выключен — стрелку проще читать.
    keyboard: false,
    dragRotate: false,
    pitchWithRotate: false,
    attributionControl: { compact: true },
  });
  map.touchZoomRotate.disableRotation();

  let follow = true;
  const followControl = new FollowControl(() => setFollow(!follow));
  map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
  map.addControl(followControl, 'top-right');

  function setFollow(on: boolean): void {
    follow = on;
    followControl.button.setAttribute('aria-pressed', String(on));
    if (on) keepInView();
  }

  // Пользователь сам сдвинул карту — перестаём следовать.
  map.on('dragstart', (e) => {
    if (e.originalEvent) setFollow(false);
  });

  /** Экранные координаты события относительно карты. */
  function local(e: PointerEvent): [number, number] {
    const rect = container.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  /** Ближайшее место трека к экранной точке в окне вокруг `around`; null — дальше 30 px. */
  function placeNear(x: number, y: number, around: number | null): TrackPlace | null {
    const ll = map.unproject([x, y]);
    const near = nearestOnTrack(
      track,
      ll.lat,
      ll.lng,
      around === null ? undefined : { from: around - DRAG_WINDOW_M, to: around + DRAG_WINDOW_M },
    );
    if (!near) return null;
    const p = map.project([near.lon, near.lat]);
    if (around !== null && Math.hypot(p.x - x, p.y - y) > DRAG_MAX_OFFSET_PX) return null;
    return { pos: near.pos, lat: near.lat, lon: near.lon };
  }

  /** Тащить элемент пальцем: нажатие не уходит карте, движение — в `onMove`. */
  function draggable(
    el: HTMLElement,
    handlers: { onMove: (e: PointerEvent) => void; onEnd: (moved: boolean) => void },
  ): void {
    let start: [number, number] | null = null;
    let moved = false;
    const stop = (e: Event): void => e.stopPropagation();
    el.addEventListener('mousedown', stop);
    el.addEventListener('touchstart', stop, { passive: true });
    el.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      start = [e.clientX, e.clientY];
      moved = false;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // указатель уже отпущен
      }
      el.classList.add('dragging');
    });
    el.addEventListener('pointermove', (e) => {
      if (!start) return;
      if (!moved && Math.hypot(e.clientX - start[0], e.clientY - start[1]) < MOVE_TOLERANCE_PX) {
        return;
      }
      moved = true;
      handlers.onMove(e);
    });
    const end = (e: PointerEvent): void => {
      if (!start) return;
      start = null;
      el.classList.remove('dragging');
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      handlers.onEnd(moved);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  // Стрелка с плашкой
  const arrowIcon = h('div', { class: 'map-arrow-icon' });
  arrowIcon.innerHTML =
    '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 3 L27 28 L16 22 L5 28 Z"/></svg>';
  const badge = h('div', { class: 'map-arrow-badge' });
  const arrowEl = h(
    'div',
    { class: 'map-arrow', role: 'slider', 'aria-label': 'Позиция на треке' },
    arrowIcon,
    badge,
  );
  const marker = new Marker({ element: arrowEl, anchor: 'center' });

  function placeArrow(pos: number): void {
    const p = pointAt(track, pos);
    marker.setLngLat([p.lon, p.lat]);
    arrowIcon.style.transform = `rotate(${bearingAt(track, pos)}deg)`;
    badge.textContent = label(pos);
  }

  // «Следовать»: каждый кадр центр карты плавно подтягивается к стрелке, пока не догонит.
  let followRaf = 0;
  let followTs = 0;
  let arrowDragging = false;
  function followTick(ts: number): void {
    followRaf = 0;
    if (!follow || arrowDragging) return;
    // Пока человек сам масштабирует колесом или щипком — не мешаем, догоним после.
    if (map.isZooming()) {
      followTs = 0;
      followRaf = requestAnimationFrame(followTick);
      return;
    }
    const p = pointAt(track, store.get());
    const at = map.project([p.lon, p.lat]);
    const halfW = container.clientWidth / 2;
    const halfH = container.clientHeight / 2;
    const dx = at.x - halfW;
    const dy = at.y - halfH;
    if (Math.hypot(dx, dy) < 0.5) {
      followTs = 0;
      return;
    }
    const dt = followTs ? Math.min((ts - followTs) / 1000, 0.1) : 1 / 60;
    followTs = ts;
    const [mx, my] = followStep(dx, dy, dt, halfW, halfH);
    map.jumpTo({ center: map.unproject([halfW + mx, halfH + my]) });
    followRaf = requestAnimationFrame(followTick);
  }
  function keepInView(): void {
    if (followRaf || !follow) return;
    followTs = 0;
    followRaf = requestAnimationFrame(followTick);
  }

  // Перетаскивание стрелки: ближайшее место трека в окне ±1 км; у точки с фото — магнит 12 px.
  draggable(arrowEl, {
    onMove(e) {
      arrowDragging = true;
      const [x, y] = local(e);
      const place = placeNear(x, y, store.get());
      if (!place) return;
      const here = map.project([place.lon, place.lat]);
      const magnetic = opts.magnetic();
      const screen = magnetic.map((pos) => {
        const p = pointAt(track, pos);
        const s = map.project([p.lon, p.lat]);
        return Math.hypot(s.x - here.x, s.y - here.y);
      });
      const hit = magnetTarget(0, screen, MAGNET_PX);
      store.set(hit === null ? place.pos : (magnetic[hit] as number), 'arrow');
    },
    onEnd() {
      // Отпустили стрелку — карта плавно возвращает её в центр.
      arrowDragging = false;
      keepInView();
    },
  });

  // Точки — маркеры: клик ставит стрелку на точку, перетаскивание двигает точку по треку.
  let pointMarkers: Marker[] = [];
  function setPoints(points: Point[]): void {
    pointMarkers.forEach((m) => m.remove());
    pointMarkers = points.map((point) => {
      const el = h('div', {
        class: 'map-point',
        role: 'button',
        tabindex: '0',
        'aria-label': point.title || 'Точка',
        title: point.title,
      });
      const m = new Marker({ element: el, anchor: 'center' }).setLngLat([point.lon, point.lat]);
      let moving: TrackPlace | null = null;
      draggable(el, {
        onMove(e) {
          if (!opts.editable) return;
          const [x, y] = local(e);
          const place = placeNear(x, y, moving?.pos ?? point.pos_m);
          if (!place) return;
          moving = place;
          m.setLngLat([place.lon, place.lat]);
        },
        onEnd(moved) {
          if (!moved) {
            store.set(point.pos_m, 'list');
            return;
          }
          if (moving && opts.onPointMove) opts.onPointMove(point, moving);
          moving = null;
        },
      });
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          store.set(point.pos_m, 'list');
        }
      });
      return m.addTo(map);
    });
  }

  // Долгое нажатие на карту — новая точка в ближайшем месте трека.
  if (opts.editable && opts.onLongPress) {
    const canvasBox = map.getCanvasContainer();
    let timer = 0;
    let start: [number, number] | null = null;
    const cancel = (): void => {
      clearTimeout(timer);
      start = null;
    };
    canvasBox.addEventListener('pointerdown', (e) => {
      if (e.target !== map.getCanvas() || (e.pointerType === 'mouse' && e.button !== 0)) return;
      start = [e.clientX, e.clientY];
      const [x, y] = local(e);
      timer = window.setTimeout(() => {
        start = null;
        const place = placeNear(x, y, null);
        if (place) opts.onLongPress?.(place);
      }, LONG_PRESS_MS);
    });
    canvasBox.addEventListener('pointermove', (e) => {
      if (start && Math.hypot(e.clientX - start[0], e.clientY - start[1]) > MOVE_TOLERANCE_PX) {
        cancel();
      }
    });
    canvasBox.addEventListener('pointerup', cancel);
    canvasBox.addEventListener('pointercancel', cancel);
    // Долгое нажатие на телефоне не должно открывать меню браузера.
    canvasBox.addEventListener('contextmenu', (e) => e.preventDefault());
    map.on('movestart', cancel);
  }

  // Фото из лотка неразобранных можно бросить на карту — встанет в ближайшее место трека.
  if (opts.editable && opts.onDropMedia) {
    container.addEventListener('dragover', (e) => {
      if (e.dataTransfer?.types.includes(MEDIA_DRAG_TYPE)) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      }
    });
    container.addEventListener('drop', (e) => {
      const id = e.dataTransfer?.getData(MEDIA_DRAG_TYPE);
      if (!id) return;
      e.preventDefault();
      const rect = container.getBoundingClientRect();
      const place = placeNear(e.clientX - rect.left, e.clientY - rect.top, null);
      if (place) opts.onDropMedia?.(id, place);
    });
  }

  // Обновления позиции — не чаще кадра.
  let frame = 0;
  let pendingSource: string | null = null;
  const unsubscribe = store.subscribe((_pos, source) => {
    pendingSource = source;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const pos = store.get();
      placeArrow(pos);
      const passed = map.getSource('track-passed') as GeoJSONSource | undefined;
      passed?.setData(multiLine(passedLines(track, pos)));
      if (pendingSource !== 'arrow') keepInView();
      pendingSource = null;
    });
  });

  // Слои трека — на каждой загрузке стиля: смена темы меняет стиль и стирает их.
  const stopTheme = followTheme(map, () => {
    map.addSource('track-all', { type: 'geojson', data: multiLine(dayLines(track)) });
    map.addSource('track-passed', {
      type: 'geojson',
      data: multiLine(passedLines(track, store.get())),
    });
    const line = { 'line-join': 'round', 'line-cap': 'round' } as const;
    map.addLayer({
      id: 'track-casing',
      type: 'line',
      source: 'track-all',
      layout: line,
      paint: { 'line-color': cssVar('--color-track-casing'), 'line-width': 7 },
    });
    map.addLayer({
      id: 'track-all',
      type: 'line',
      source: 'track-all',
      layout: line,
      paint: { 'line-color': cssVar('--color-track-muted'), 'line-width': 4 },
    });
    map.addLayer({
      id: 'track-passed',
      type: 'line',
      source: 'track-passed',
      layout: line,
      paint: { 'line-color': cssVar('--color-accent'), 'line-width': 5 },
    });
  });

  setPoints(opts.points);
  placeArrow(store.get());
  marker.addTo(map);

  return {
    setPoints,
    destroy() {
      unsubscribe();
      cancelAnimationFrame(followRaf);
      stopTheme();
      if (frame) cancelAnimationFrame(frame);
      map.remove();
    },
  };
}
