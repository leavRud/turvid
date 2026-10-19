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

export interface TimeAxis extends Axis {
  timeToX(t: number): number;
  xToTime(x: number): number;
  days: DaySpan[];
}

/** Доля ширины на разрыв между днями (ночь). */
export const NIGHT_GAP = 0.03;

/**
 * Ось по времени для шкалы времени: дни подряд, ширина дня пропорциональна его длительности,
 * ночь — короткий разрыв. Позиция ↔ время через трек (первое прибытие на позицию).
 */
export function timeAxis(track: TrackData, days: DaySummary[], gap = NIGHT_GAP): TimeAxis {
  const timed = days.filter((d) => d.startT !== null && d.endT !== null);
  const durations = timed.map((d) => Math.max((d.endT as number) - (d.startT as number), 1));
  const total = durations.reduce((s, x) => s + x, 0) || 1;
  const usable = 1 - gap * Math.max(timed.length - 1, 0);

  let x = 0;
  const spans: DaySpan[] = timed.map((d, i) => {
    const w = ((durations[i] as number) / total) * usable;
    const span = { x0: x, x1: x + w, startT: d.startT as number, endT: d.endT as number };
    x += w + gap;
    return span;
  });

  const timeToX = (t: number): number => {
    for (let i = 0; i < spans.length; i++) {
      const s = spans[i] as DaySpan;
      const next = spans[i + 1];
      if (t <= s.endT || !next || t < next.startT) {
        const f =
          s.endT > s.startT
            ? (Math.min(Math.max(t, s.startT), s.endT) - s.startT) / (s.endT - s.startT)
            : 0;
        // Ночь (между концом дня и началом следующего) прилипает к концу дня.
        return s.x0 + f * (s.x1 - s.x0);
      }
    }
    return 1;
  };

  const xToTime = (xv: number): number => {
    const xc = clamp01(xv);
    for (let i = 0; i < spans.length; i++) {
      const s = spans[i] as DaySpan;
      const next = spans[i + 1];
      if (xc <= s.x1 || !next) {
        const f = s.x1 > s.x0 ? Math.min(Math.max((xc - s.x0) / (s.x1 - s.x0), 0), 1) : 0;
        return s.startT + f * (s.endT - s.startT);
      }
      if (xc < next.x0) {
        // В разрыве — к ближайшему краю.
        return xc - s.x1 < next.x0 - xc ? s.endT : next.startT;
      }
    }
    return 0;
  };

  const length = trackLength(track);
  return {
    days: spans,
    timeToX,
    xToTime,
    posToX: (pos) => timeToX(timeAt(track, Math.min(Math.max(pos, 0), length)) ?? 0),
    xToPos: (xv) => posAtTime(track, xToTime(xv)),
  };
}
