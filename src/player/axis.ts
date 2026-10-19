// Оси нижней полосы: как позиция на треке ложится на долю ширины [0..1] и обратно.

import type { DaySummary } from '../track/days';
import type { TrackData } from '../types';
import { posAtTime, timeAt, trackLength } from './position';

export interface Axis {
  /** Позиция (м) → доля ширины 0..1. */
  posToX(pos: number): number;
  /** Доля ширины 0..1 → позиция (м). */
  xToPos(x: number): number;
}

const clamp01 = (x: number): number => Math.min(Math.max(x, 0), 1);

/** Линейная ось по расстоянию: профиль высоты и «только ползунок». */
export function distanceAxis(length: number): Axis {
  return {
    posToX: (pos) => (length > 0 ? clamp01(pos / length) : 0),
    xToPos: (x) => clamp01(x) * length,
  };
}

export interface DaySpan {
  /** Начало и конец дня на оси, доли ширины. */
  x0: number;
  x1: number;
  startT: number;
  endT: number;
}

/** Кусок оси времени: день (в настоящем масштабе) или ночь между днями (сжата). */
export interface AxisSegment {
  x0: number;
  x1: number;
  t0: number;
  t1: number;
  night: boolean;
}

export interface TimeAxis extends Axis {
  timeToX(t: number): number;
  xToTime(x: number): number;
  days: DaySpan[];
  segments: AxisSegment[];
}

/**
 * Во сколько раз ночь на оси короче своего настоящего времени. Ночь — не пробел:
 * время идёт и по ней (под ней тот же непрерывный фон «день/ночь»), просто сжато.
 */
export const NIGHT_SCALE = 0.25;

/**
 * Ось по времени для шкалы времени: без пробелов, от начала первого дня до конца последнего.
 * Дни — в настоящем масштабе, ночи между ними сжаты в NIGHT_SCALE раз.
 * Позиция → время через трек (первое прибытие на позицию).
 */
export function timeAxis(track: TrackData, days: DaySummary[], nightScale = NIGHT_SCALE): TimeAxis {
  const timed = days.filter((d) => d.startT !== null && d.endT !== null);
  const raw: { t0: number; t1: number; night: boolean; weight: number }[] = [];
  timed.forEach((d, i) => {
    const t0 = d.startT as number;
    const t1 = d.endT as number;
    raw.push({ t0, t1, night: false, weight: Math.max(t1 - t0, 1) });
    const next = timed[i + 1];
    if (next) {
      const n0 = next.startT as number;
      raw.push({ t0: t1, t1: n0, night: true, weight: Math.max(n0 - t1, 1) * nightScale });
    }
  });
  const total = raw.reduce((s, r) => s + r.weight, 0) || 1;
  let x = 0;
  const segments: AxisSegment[] = raw.map((r) => {
    const w = r.weight / total;
    const seg = { x0: x, x1: x + w, t0: r.t0, t1: r.t1, night: r.night };
    x += w;
    return seg;
  });
  const last = segments[segments.length - 1];
  if (last) last.x1 = 1;

  const timeToX = (t: number): number => {
    const first = segments[0];
    if (!first || t <= first.t0) return 0;
    for (const s of segments) {
      if (t <= s.t1) return s.x0 + ((t - s.t0) / Math.max(s.t1 - s.t0, 1e-9)) * (s.x1 - s.x0);
    }
    return 1;
  };

  const xToTime = (xv: number): number => {
    const xc = clamp01(xv);
    for (const s of segments) {
      if (xc <= s.x1) {
        const f = s.x1 > s.x0 ? (xc - s.x0) / (s.x1 - s.x0) : 0;
        return s.t0 + Math.min(Math.max(f, 0), 1) * (s.t1 - s.t0);
      }
    }
    return last ? last.t1 : 0;
  };

  const length = trackLength(track);
  return {
    days: segments
      .filter((s) => !s.night)
      .map((s) => ({ x0: s.x0, x1: s.x1, startT: s.t0, endT: s.t1 })),
    segments,
    timeToX,
    xToTime,
    posToX: (pos) => timeToX(timeAt(track, Math.min(Math.max(pos, 0), length)) ?? 0),
    xToPos: (xv) => posAtTime(track, xToTime(xv)),
  };
}

/** Ночь ли в момент t (между днями, когда часы не писали трек). */
export function isNight(axis: TimeAxis, t: number): boolean {
  return axis.segments.some((s) => s.night && t > s.t0 && t < s.t1);
}
