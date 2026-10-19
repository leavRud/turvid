// Накопленное расстояние с прореживанием от GPS-дрожания.

import type { DayRange } from './days';
import { haversine } from './geo';

/**
 * Шаг прореживания, м: ближе к опорной точке — дрожание, не движение.
 * В ТЗ было 5 м, но на эталоне это 30,75 км вместо ожидаемых 31–33; решили 2 м (31,45 км).
 */
export const MIN_STEP_M = 2;

/**
 * Расстояние от старта для каждой точки, м.
 * Считается между опорными точками, отстоящими не меньше чем на MIN_STEP_M.
 * Точки между опорными получают расстояние до своей опорной (меньше шага),
 * но не меньше, чем у предыдущей, — так массив не убывает.
 * Через ночной разрыв расстояние не добавляется.
 */
export function cumulativeDistance(lat: number[], lon: number[], days: DayRange[]): number[] {
  const dist = new Array<number>(lat.length).fill(0);
  let total = 0;
  for (const day of days) {
    let anchor = day.start;
    let anchorDist = total;
    dist[day.start] = total;
    for (let i = day.start + 1; i <= day.end; i++) {
      const d = haversine(
        lat[anchor] as number,
        lon[anchor] as number,
        lat[i] as number,
        lon[i] as number,
      );
      if (d >= MIN_STEP_M) {
        anchorDist += d;
        anchor = i;
        dist[i] = anchorDist;
      } else {
        dist[i] = Math.max(dist[i - 1] as number, anchorDist + d);
      }
    }
    total = dist[day.end] as number;
  }
  return dist;
}
