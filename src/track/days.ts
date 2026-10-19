// Деление трека на дни по разрывам во времени.

/** Разрыв больше этого начинает новый день, с. */
export const DAY_GAP_S = 3 * 3600;

/** День — отрезок индексов точек [start, end] включительно. */
export interface DayRange {
  start: number;
  end: number;
}

export interface DaySummary extends DayRange {
  /** Время начала и конца дня, секунды от старта трека; null — без времени. */
  startT: number | null;
  endT: number | null;
  distanceM: number;
}

/** Дни упрощённого трека с расстоянием и временем (дни не хранятся, а считаются). */
export function summarizeDays(track: { t: number[] | null; dist: number[] }): DaySummary[] {
  return splitDays(track.t, track.dist.length).map((d) => ({
    ...d,
    startT: track.t ? (track.t[d.start] as number) : null,
    endT: track.t ? (track.t[d.end] as number) : null,
    distanceM: (track.dist[d.end] as number) - (track.dist[d.start] as number),
  }));
}

/** Без времени весь трек — один день. */
export function splitDays(t: ArrayLike<number> | null, count: number): DayRange[] {
  if (count === 0) return [];
  if (!t) return [{ start: 0, end: count - 1 }];
  const days: DayRange[] = [];
  let start = 0;
  for (let i = 1; i < count; i++) {
    if ((t[i] as number) - (t[i - 1] as number) > DAY_GAP_S) {
      days.push({ start, end: i - 1 });
      start = i;
    }
  }
  days.push({ start, end: count - 1 });
  return days;
}
