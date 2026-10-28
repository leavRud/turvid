// Данные нижней полосы: выбор режима, профиль высоты, скорость, остановки. Чистые функции.

import type { Stop } from '../track/stops';
import type { TrackData } from '../types';
import type { Axis, TimeAxis } from './axis';
import { pointAt, posAtTime } from './position';
import { daylight, sunAltitude } from './sun';

export type StripMode = 'profile' | 'timeline' | 'slider';

/** Перепад высот, начиная с которого по умолчанию показывается профиль, м. */
export const PROFILE_MIN_RANGE_M = 150;

export interface StripInfo {
  /** Режим по умолчанию. */
  auto: StripMode;
  /** Режимы, которые можно выбрать вручную. */
  available: StripMode[];
}

/** Профиль — если высота надёжна и перепад больше 150 м; иначе шкала времени, если есть время. */
export function stripModes(
  track: TrackData,
  elevationReliable: boolean,
  elevRangeM: number | null,
): StripInfo {
  const hasEle = elevationReliable && track.ele !== null;
  const hasTime = track.t !== null;
  const available: StripMode[] = [];
  if (hasEle) available.push('profile');
  if (hasTime) available.push('timeline');
  available.push('slider');
  const auto: StripMode =
    hasEle && (elevRangeM ?? 0) > PROFILE_MIN_RANGE_M ? 'profile' : hasTime ? 'timeline' : 'slider';
  return { auto, available };
}

/** Путь SVG профиля высоты (замкнутый к низу) в рамке width×height. */
export function profilePath(track: TrackData, axis: Axis, width: number, height: number): string {
  const ele = track.ele;
  if (!ele || ele.length < 2) return '';
  let min = Infinity;
  let max = -Infinity;
  for (const e of ele) {
    if (e < min) min = e;
    if (e > max) max = e;
  }
  const span = max - min || 1;
  const pad = height * 0.1;
  const y = (e: number): number => height - pad - ((e - min) / span) * (height - 2 * pad);
  const fmt = (v: number): string => (Math.round(v * 10) / 10).toString();
  const parts: string[] = [];
  let lastX = -1;
  ele.forEach((e, i) => {
    const x = axis.posToX(track.dist[i] as number) * width;
    // Не больше одной вершины на пиксель.
    if (i > 0 && i < ele.length - 1 && x - lastX < 1) return;
    lastX = x;
    parts.push(`${parts.length ? 'L' : 'M'}${fmt(x)} ${fmt(y(e))}`);
  });
  const x0 = axis.posToX(0) * width;
  const x1 = axis.posToX(track.dist[track.dist.length - 1] as number) * width;
  return `${parts.join('')}L${fmt(x1)} ${height}L${fmt(x0)} ${height}Z`;
}

export interface SpeedBand {
  x0: number;
  x1: number;
  /** 0 — стоял, 1 — медленно, 2 — обычный шаг, 3 — быстро. */
  level: 0 | 1 | 2 | 3;
}

/** Границы уровней скорости, км/ч. */
export const SPEED_LEVELS_KMH = [1, 3, 5] as const;

export function speedLevel(kmh: number): SpeedBand['level'] {
  if (kmh < SPEED_LEVELS_KMH[0]) return 0;
  if (kmh < SPEED_LEVELS_KMH[1]) return 1;
  if (kmh < SPEED_LEVELS_KMH[2]) return 2;
  return 3;
}

/**
 * Полоса скорости по оси времени: отрезки трека, склеенные по уровню скорости.
 * Скорость считается по окнам не короче `minSpanS` секунд, чтобы не мельтешило.
 */
export function speedBands(
  track: TrackData,
  timeToX: (t: number) => number,
  minSpanS = 60,
): SpeedBand[] {
  const t = track.t;
  if (!t || t.length < 2) return [];
  const bands: SpeedBand[] = [];
  let i = 0;
  while (i < t.length - 1) {
    let j = i + 1;
    while (j < t.length - 1 && (t[j] as number) - (t[i] as number) < minSpanS) j++;
    const dt = (t[j] as number) - (t[i] as number);
    // Ночной разрыв не красим.
    if (dt <= 3 * 3600 && dt > 0) {
      const kmh = (((track.dist[j] as number) - (track.dist[i] as number)) / dt) * 3.6;
      const level = speedLevel(kmh);
      const x0 = timeToX(t[i] as number);
      const x1 = timeToX(t[j] as number);
      const last = bands[bands.length - 1];
      if (last && last.level === level && Math.abs(last.x1 - x0) < 1e-9) last.x1 = x1;
      else bands.push({ x0, x1, level });
    }
    i = j;
  }
  return bands;
}

export interface StopMark {
  x0: number;
  x1: number;
  durationS: number;
}

/** Отметки остановок на оси времени (без подписей длительности — так решили на этапе 3). */
export function stopMarks(
  track: TrackData,
  stops: Stop[],
  timeToX: (t: number) => number,
): StopMark[] {
  const t = track.t;
  if (!t) return [];
  return stops.map((s) => ({
    x0: timeToX(t[s.start] as number),
    x1: timeToX(t[s.end] as number),
    durationS: s.durationS,
  }));
}

export interface NightStop {
  /** Доля оси 0..1. */
  offset: number;
  /** 0 — светло, 1 — ночь. */
  night: number;
  /** Высота солнца, °. */
  alt: number;
}

/**
 * Небо для фона шкалы времени — одной непрерывной лентой по всей оси, включая сон,
 * когда часы не писали трек: высота солнца в том месте, где был в этот момент.
 * `samples` точек по оси; xToTime — та же ось, что у полосы.
 */
export function skyStops(
  track: TrackData,
  startedAt: number,
  xToTime: (x: number) => number,
  samples = 400,
): NightStop[] {
  const out: NightStop[] = [];
  for (let i = 0; i < samples; i++) {
    const x = i / (samples - 1);
    const t = xToTime(x);
    const p = pointAt(track, posAtTime(track, t));
    const alt = sunAltitude((startedAt + t) * 1000, p.lat, p.lon);
    out.push({ offset: x, night: 1 - daylight(alt), alt });
  }
  return out;
}

/** Видимое окно полосы при масштабе: доли оси [a, b]. */
export interface View {
  a: number;
  b: number;
}

/** Самое узкое окно — 1% оси (масштаб ×100). */
export const MIN_VIEW = 0.01;

function clampView(a: number, w: number): View {
  const width = Math.min(Math.max(w, MIN_VIEW), 1);
  const start = Math.min(Math.max(a, 0), 1 - width);
  return { a: start, b: start + width };
}

/** Масштаб в factor раз (меньше 1 — приблизить) вокруг точки оси at, которая остаётся на месте. */
export function zoomView(view: View, factor: number, at: number): View {
  const w = view.b - view.a;
  const f = w > 0 ? (at - view.a) / w : 0.5;
  const nw = Math.min(Math.max(w * factor, MIN_VIEW), 1);
  return clampView(at - f * nw, nw);
}

/** Сдвиг окна на dx долей оси. */
export function panView(view: View, dx: number): View {
  return clampView(view.a + dx, view.b - view.a);
}

/** Минимально сдвигает окно, чтобы x было не ближе margin (доля окна) к краю. */
export function followView(view: View, x: number, margin = 0.1): View {
  const w = view.b - view.a;
  const m = w * margin;
  if (x < view.a + m) return clampView(x - m, w);
  if (x > view.b - m) return clampView(x + m - w, w);
  return view;
}

/**
 * Прокрутка у края при перетаскивании ползунка: f — палец, доля ширины полосы (может выйти
 * за 0..1), zone — ширина зоны у края в долях. −1..0 — влево, 0..1 — вправо, сильнее у самого края.
 */
export function edgeScroll(f: number, zone: number): number {
  if (zone <= 0) return 0;
  if (f < zone) return -Math.min((zone - f) / zone, 1);
  if (f > 1 - zone) return Math.min((f - (1 - zone)) / zone, 1);
  return 0;
}

// ——— Шкала времени: небо по солнцу, звёзды, темп линией, привалы и ночёвки ———

/**
 * Небо кладётся слоями поверх дневного цвета: золотой час, заря, сумерки, ночь.
 * Слой k проявляется, пока солнце опускается от a0 до a1 (°), — так выходит плавный переход
 * день → золото → заря → сумерки → ночь, а цвета остаются в CSS (светлая и тёмная тема).
 */
export const SKY_LAYERS = [
  { name: 'golden', a0: 12, a1: 4 },
  { name: 'dawn', a0: 4, a1: -1 },
  { name: 'deep', a0: -1, a1: -6 },
  { name: 'night', a0: -6, a1: -12 },
] as const;

const clamp01 = (v: number): number => Math.min(Math.max(v, 0), 1);

/** Непрозрачность каждого слоя неба при этой высоте солнца, по порядку SKY_LAYERS. */
export function skyLayerOpacity(alt: number): number[] {
  return SKY_LAYERS.map((l) => clamp01((l.a0 - alt) / (l.a0 - l.a1)));
}

/** Насколько звёздно: 0 — светло, 1 — звёзды во всю силу (солнце ниже −12°). */
export function starriness(alt: number): number {
  return clamp01((-4 - alt) / 8);
}

export interface Star {
  /** Доля оси 0..1. */
  x: number;
  /** Доля высоты сверху 0..1. */
  y: number;
  /** Диаметр, px. */
  size: number;
  opacity: number;
}

/**
 * Звёзды по оси — там, где солнце ниже горизонта. Раскладка детерминированная (одна и та же
 * при каждой перерисовке), гуще там, где темнее. `slots` — сколько мест под звезду по всей оси.
 */
export function starsFor(sky: NightStop[], slots = 1500, seed = 7): Star[] {
  if (sky.length < 2) return [];
  let state = seed;
  const rnd = (): number => (state = (state * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31;
  const stars: Star[] = [];
  for (let i = 0; i < slots; i++) {
    const x = (i + rnd()) / slots;
    const sample = sky[Math.round(x * (sky.length - 1))] as NightStop;
    const k = starriness(sample.alt);
    const roll = rnd();
    const y = rnd();
    const size = 1 + rnd() * 1.5;
    const opacity = 0.35 + rnd() * 0.65;
    if (roll < k * 0.3) stars.push({ x, y, size, opacity: Math.round(opacity * k * 100) / 100 });
  }
  return stars;
}

export interface PaceSample {
  /** Доля оси 0..1. */
  x: number;
  /** Сглаженная скорость, км/ч; null — ночной разрыв, трека нет. */
  kmh: number | null;
}

/** Выше этой скорости линия темпа упирается в потолок, км/ч. */
export const PACE_MAX_KMH = 6;
/** Окно сглаживания скорости, с: шаги и мелкие заминки не дёргают линию. */
export const PACE_WINDOW_S = 300;

/** Скорость по оси времени — для линии темпа. */
export function paceSamples(track: TrackData, axis: TimeAxis, samples = 600): PaceSample[] {
  const out: PaceSample[] = [];
  const half = PACE_WINDOW_S / 2;
  for (let i = 0; i < samples; i++) {
    const x = i / (samples - 1);
    const night = axis.segments.some((s) => s.night && x > s.x0 && x < s.x1);
    if (night) {
      out.push({ x, kmh: null });
      continue;
    }
    const t = axis.xToTime(x);
    const d = posAtTime(track, t + half) - posAtTime(track, t - half);
    out.push({ x, kmh: Math.max(0, (d / PACE_WINDOW_S) * 3.6) });
  }
  return out;
}

/**
 * Линия темпа и заливка под ней в рамке width×height: внизу — стоял, вверху — PACE_MAX_KMH.
 * Линия занимает нижнюю долю `amp` высоты; в ночной разрыв не тянется.
 */
export function pacePaths(
  samples: PaceSample[],
  width: number,
  height: number,
  amp = 0.5,
): { line: string; area: string } {
  const base = height - 2;
  const y = (kmh: number): number =>
    base - (Math.min(kmh, PACE_MAX_KMH) / PACE_MAX_KMH) * height * amp;
  const fmt = (v: number): string => (Math.round(v * 10) / 10).toString();
  let line = '';
  let area = '';
  let run: { x: number; kmh: number }[] = [];
  const flush = (): void => {
    if (run.length >= 2) {
      const pts = run.map((s) => `${fmt(s.x * width)} ${fmt(y(s.kmh))}`).join('L');
      const x0 = fmt((run[0] as { x: number }).x * width);
      const x1 = fmt((run[run.length - 1] as { x: number }).x * width);
      line += `M${pts}`;
      area += `M${x0} ${base}L${pts}L${x1} ${base}Z`;
    }
    run = [];
  };
  for (const s of samples) {
    if (s.kmh === null) flush();
    else run.push({ x: s.x, kmh: s.kmh });
  }
  flush();
  return { line, area };
}

export interface RestSpan {
  kind: 'stop' | 'night';
  /** Доли оси. */
  x0: number;
  x1: number;
  durationS: number;
}

/** Привал кончился не раньше чем за столько до конца дня — он часть ночёвки, с. */
export const NIGHT_MERGE_S = 120;
/** Привалы короче — без подписи (так решили по макету), с. */
export const REST_LABEL_MIN_S = 15 * 60;

/**
 * Остановки, между которыми не больше столько, — один привал на полосе, с. Поиск остановок
 * режет долгий привал на куски, стоит отойти от первой точки дальше 30 м (ходил по лагерю).
 */
export const STOP_JOIN_S = 3 * 60;

/** Склеить соседние куски одного привала (см. STOP_JOIN_S). */
export function joinStops(t: ArrayLike<number>, stops: Stop[]): Stop[] {
  const out: Stop[] = [];
  for (const s of [...stops].sort((a, b) => a.start - b.start)) {
    const last = out[out.length - 1];
    if (last && (t[s.start] as number) - (t[last.end] as number) <= STOP_JOIN_S) {
      last.end = Math.max(last.end, s.end);
      last.durationS = (t[last.end] as number) - (t[last.start] as number);
    } else {
      out.push({ ...s });
    }
  }
  return out;
}

/**
 * Привалы и ночёвки для подписей на шкале времени. Соседние куски одного привала склеены.
 * Привал, которым кончился день (сразу перед ночёвкой), входит в ночёвку: она начинается
 * с него, и длительность — вместе с ним.
 */
export function restSpans(track: TrackData, rawStops: Stop[], axis: TimeAxis): RestSpan[] {
  const t = track.t;
  if (!t) return [];
  const stops = joinStops(t, rawStops);
  const nights = axis.segments.filter((s) => s.night);
  const merged = new Set<Stop>();
  const out: RestSpan[] = nights.map((n) => {
    const before = stops.find((s) => {
      const end = t[s.end] as number;
      return end <= n.t0 && n.t0 - end <= NIGHT_MERGE_S;
    });
    if (before) merged.add(before);
    const t0 = before ? (t[before.start] as number) : n.t0;
    return { kind: 'night', x0: axis.timeToX(t0), x1: n.x1, durationS: n.t1 - t0 };
  });
  for (const s of stops) {
    if (merged.has(s)) continue;
    out.push({
      kind: 'stop',
      x0: axis.timeToX(t[s.start] as number),
      x1: axis.timeToX(t[s.end] as number),
      durationS: s.durationS,
    });
  }
  return out.sort((a, b) => a.x0 - b.x0);
}
