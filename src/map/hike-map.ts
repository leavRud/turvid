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
import { bearingAt, pointAt } from '../player/position';
import type { PositionStore } from '../player/store';
import { splitDays } from '../track/days';
import { nearestOnTrack } from '../track/nearest';
import type { Point, TrackData } from '../types';
import { h } from '../ui/dom';

// Воркер MapLibre ищется по относительному адресу, который Vite при сборке теряет; отдаём его явно.
setWorkerUrl(mapWorkerUrl);

/** Перетаскивая стрелку, ищем ближайшее место только в этом окне вокруг позиции, м. */
export const DRAG_WINDOW_M = 1000;
/**
 * Курсор дальше этого от трека — стрелка стоит, экранные пиксели.
 * В ТЗ было 50 м, но на общем виде это доля пикселя; решили считать в пикселях (раздел 9 ТЗ).
 */
export const DRAG_MAX_OFFSET_PX = 30;
/** Стрелка ближе к краю карты, чем эта доля, — карта подтягивается. */
const FOLLOW_MARGIN = 0.2;

const STYLE_LIGHT = 'https://tiles.openfreemap.org/styles/liberty';
const STYLE_DARK = 'https://tiles.openfreemap.org/styles/dark';

type Coord = [number, number];

export interface HikeMapOptions {
  container: HTMLElement;
  track: TrackData;
  bbox: [number, number, number, number];
  points: Point[];
  store: PositionStore;
  /** Текст плашки у стрелки для позиции. */
  label: (pos: number) => string;
}

export interface HikeMap {
  destroy(): void;
}

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function prefersDark(): boolean {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
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

export function createHikeMap({
  container,
  track,
  bbox,
  points,
  store,
  label,
}: HikeMapOptions): HikeMap {
  const map = new MapLibreMap({
    container,
    style: prefersDark() ? STYLE_DARK : STYLE_LIGHT,
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
    if (on) keepInView(true);
  }

  // Пользователь сам сдвинул карту — перестаём следовать.
  map.on('dragstart', (e) => {
    if (e.originalEvent) setFollow(false);
  });

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

  function keepInView(force = false): void {
    const p = pointAt(track, store.get());
    const { x, y } = map.project([p.lon, p.lat]);
    const w = container.clientWidth;
    const hgt = container.clientHeight;
    const inside =
      x > w * FOLLOW_MARGIN &&
      x < w * (1 - FOLLOW_MARGIN) &&
      y > hgt * FOLLOW_MARGIN &&
      y < hgt * (1 - FOLLOW_MARGIN);
    if (force || !inside) map.easeTo({ center: [p.lon, p.lat], duration: 400 });
  }

  // Перетаскивание стрелки мышью или пальцем: ближайшее место трека в окне ±1 км.
  let dragging = false;
  const stop = (e: Event): void => e.stopPropagation();
  arrowEl.addEventListener('mousedown', stop);
  arrowEl.addEventListener('touchstart', stop, { passive: true });
  arrowEl.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    e.preventDefault();
    dragging = true;
    arrowEl.setPointerCapture(e.pointerId);
    arrowEl.classList.add('dragging');
  });
  arrowEl.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const rect = container.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const ll = map.unproject([cx, cy]);
    const pos = store.get();
    const near = nearestOnTrack(track, ll.lat, ll.lng, {
      from: pos - DRAG_WINDOW_M,
      to: pos + DRAG_WINDOW_M,
    });
    if (!near) return;
    const p = map.project([near.lon, near.lat]);
    if (Math.hypot(p.x - cx, p.y - cy) <= DRAG_MAX_OFFSET_PX) store.set(near.pos, 'arrow');
  });
  const endDrag = (e: PointerEvent): void => {
    if (!dragging) return;
    dragging = false;
    arrowEl.classList.remove('dragging');
    if (arrowEl.hasPointerCapture(e.pointerId)) arrowEl.releasePointerCapture(e.pointerId);
  };
  arrowEl.addEventListener('pointerup', endDrag);
  arrowEl.addEventListener('pointercancel', endDrag);

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
      if (follow && pendingSource !== 'arrow') keepInView();
      pendingSource = null;
    });
  });

  map.on('load', () => {
    const accent = cssVar('--color-accent');
    map.addSource('track-all', { type: 'geojson', data: multiLine(dayLines(track)) });
    map.addSource('track-passed', {
      type: 'geojson',
      data: multiLine(passedLines(track, store.get())),
    });
    map.addSource('points', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: points.map((p) => ({
          type: 'Feature',
          properties: { pos: p.pos_m, title: p.title },
          geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
        })),
      },
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
      paint: { 'line-color': accent, 'line-width': 5 },
    });
    map.addLayer({
      id: 'points',
      type: 'circle',
      source: 'points',
      paint: {
        'circle-radius': 7,
        'circle-color': cssVar('--color-point'),
        'circle-stroke-color': cssVar('--color-surface'),
        'circle-stroke-width': 2,
      },
    });
    map.on('click', 'points', (e) => {
      const pos = e.features?.[0]?.properties?.['pos'];
      if (typeof pos === 'number') store.set(pos, 'list');
    });
    map.on('mouseenter', 'points', () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', 'points', () => (map.getCanvas().style.cursor = ''));
  });

  placeArrow(store.get());
  marker.addTo(map);

  return {
    destroy() {
      unsubscribe();
      if (frame) cancelAnimationFrame(frame);
      map.remove();
    },
  };
}
