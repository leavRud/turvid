// Позиция на треке (метры от старта) → координаты, направление, время. Чистые функции.

import { localProjection } from '../track/geo';
import type { TrackData } from '../types';

/** Окно для направления стрелки: точки за столько метров до и после позиции. */
export const BEARING_WINDOW_M = 20;

export interface TrackPoint {
  lat: number;
  lon: number;
  /** Высота, если есть в треке. */
  ele: number | null;
  /** Секунды от старта трека, если есть время. */
  t: number | null;
  /** Индекс начала отрезка, на котором стоит позиция. */
  index: number;
}

export function trackLength(track: Pick<TrackData, 'dist'>): number {
  return track.dist[track.dist.length - 1] ?? 0;
}

export function clampPos(pos: number, length: number): number {
  return Math.min(Math.max(pos, 0), length);
}

/** Первый индекс j, где dist[j] >= pos (двоичный поиск). */
function lowerBound(values: ArrayLike<number>, target: number): number {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((values[mid] as number) < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Отрезок [i, i+1] и доля пути по нему для позиции. При «плато» берётся первое прибытие. */
function locate(dist: number[], pos: number): { i: number; f: number } {
  const n = dist.length;
  if (n < 2) return { i: 0, f: 0 };
  const j = Math.min(Math.max(lowerBound(dist, pos), 1), n - 1);
  const i = j - 1;
  const d0 = dist[i] as number;
  const d1 = dist[j] as number;
  const f = d1 > d0 ? Math.min(Math.max((pos - d0) / (d1 - d0), 0), 1) : 0;
  return { i, f };
}

const lerp = (a: number, b: number, f: number): number => a + (b - a) * f;

/** Точка трека на позиции `pos` (интерполяция между соседними точками). */
export function pointAt(track: TrackData, pos: number): TrackPoint {
  const { i, f } = locate(track.dist, pos);
  const j = Math.min(i + 1, track.dist.length - 1);
  const at = (arr: number[]): number => lerp(arr[i] as number, arr[j] as number, f);
  return {
    lat: at(track.lat),
    lon: at(track.lon),
    ele: track.ele ? at(track.ele) : null,
    t: track.t ? at(track.t) : null,
    index: i,
  };
}

/** Время на позиции (первое прибытие), секунды от старта; null — без времени. */
export function timeAt(track: TrackData, pos: number): number | null {
  return pointAt(track, pos).t;
}

/** Позиция, где был в момент `t` (секунды от старта). */
export function posAtTime(track: TrackData, t: number): number {
  const times = track.t;
  if (!times || times.length < 2) return 0;
  const j = Math.min(Math.max(lowerBound(times, t), 1), times.length - 1);
  const i = j - 1;
  const t0 = times[i] as number;
  const t1 = times[j] as number;
  const f = t1 > t0 ? Math.min(Math.max((t - t0) / (t1 - t0), 0), 1) : 0;
  return lerp(track.dist[i] as number, track.dist[j] as number, f);
}

/**
 * Направление движения в градусах (0 — север, по часовой).
 * Берётся между точками за `window` м до и после позиции, чтобы стрелка не дёргалась на зигзагах.
 */
export function bearingAt(track: TrackData, pos: number, window = BEARING_WINDOW_M): number {
  const length = trackLength(track);
  let a = pointAt(track, clampPos(pos - window, length));
  let b = pointAt(track, clampPos(pos + window, length));
  if (a.lat === b.lat && a.lon === b.lon) {
    // Трек короче окна или стоим на месте — берём весь трек.
    a = pointAt(track, 0);
    b = pointAt(track, length);
  }
  const project = localProjection(a.lat);
  const [ax, ay] = project(a.lat, a.lon);
  const [bx, by] = project(b.lat, b.lon);
  const deg = (Math.atan2(bx - ax, by - ay) * 180) / Math.PI;
  return (deg + 360) % 360;
}

/** Номер дня (с нуля) для отрезка с индексом `index`. */
export function dayIndexAt(days: { start: number; end: number }[], index: number): number {
  const found = days.findIndex((d) => index >= d.start && index < Math.max(d.end, d.start + 1));
  return found < 0 ? Math.max(days.length - 1, 0) : found;
}

/** Позиция из параметра адреса `?pos=`; null, если его нет или он кривой. */
export function parsePosParam(search: string, length: number): number | null {
  const raw = new URLSearchParams(search).get('pos');
  if (raw === null || raw.trim() === '') return null;
  const pos = Number(raw);
  return Number.isFinite(pos) ? clampPos(pos, length) : null;
}
