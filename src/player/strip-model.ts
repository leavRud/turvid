// Данные нижней полосы: выбор режима, профиль высоты, скорость, остановки. Чистые функции.

import type { Stop } from '../track/stops';
import type { TrackData } from '../types';
import type { Axis } from './axis';

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
  /** Подпись с длительностью — для остановок от 10 минут. */
  labeled: boolean;
}

export const STOP_LABEL_MIN_S = 10 * 60;

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
    labeled: s.durationS >= STOP_LABEL_MIN_S,
  }));
}
