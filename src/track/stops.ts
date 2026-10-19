// Остановки: 5 минут и дольше в круге радиусом 30 м.

import type { DayRange } from './days';
import { haversine } from './geo';

export const STOP_RADIUS_M = 30;
export const STOP_MIN_S = 5 * 60;

/** Остановка — отрезок индексов [start, end] включительно. */
export interface Stop {
  start: number;
  end: number;
  durationS: number;
}

/**
 * Ищет остановки внутри каждого дня (ночь остановкой не считается).
 * От точки `i` берём все следующие точки в круге 30 м вокруг неё;
 * если они покрывают 5 минут и больше — это остановка, ищем дальше после неё.
 */
export function findStops(
  lat: ArrayLike<number>,
  lon: ArrayLike<number>,
  t: ArrayLike<number>,
  days: DayRange[],
): Stop[] {
  const stops: Stop[] = [];
  for (const day of days) {
    let i = day.start;
    while (i < day.end) {
      const lat0 = lat[i] as number;
      const lon0 = lon[i] as number;
      let j = i + 1;
      while (
        j <= day.end &&
        haversine(lat0, lon0, lat[j] as number, lon[j] as number) <= STOP_RADIUS_M
      ) {
        j++;
      }
      const duration = (t[j - 1] as number) - (t[i] as number);
      if (duration >= STOP_MIN_S) {
        stops.push({ start: i, end: j - 1, durationS: duration });
        i = j;
      } else {
        i++;
      }
    }
  }
  return stops;
}
