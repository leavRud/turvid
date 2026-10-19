// Чистка трека: дубликаты и выбросы по скорости.

import type { RawPoint } from '../parse/types';
import { haversine } from './geo';

/** Скачок быстрее этого — выброс, км/ч. */
export const MAX_SPEED_KMH = 50;
/** Если подряд отброшено столько точек, значит ошибочна сама опорная точка — принимаем. */
const MAX_REJECTED_RUN = 20;

/**
 * Со временем: выкидывает точки с тем же или более ранним временем и точки,
 * до которых от последней принятой надо двигаться быстрее 50 км/ч.
 * Без времени: выкидывает только подряд идущие точки с теми же координатами.
 */
export function cleanPoints(points: RawPoint[], hasTime: boolean): RawPoint[] {
  const first = points[0];
  if (!first) return [];
  const out: RawPoint[] = [first];
  const maxSpeed = MAX_SPEED_KMH / 3.6;
  let rejected = 0;

  for (let i = 1; i < points.length; i++) {
    const p = points[i] as RawPoint;
    const prev = out[out.length - 1] as RawPoint;
    if (p.lat === prev.lat && p.lon === prev.lon && (!hasTime || p.t === prev.t)) continue;
    if (!hasTime) {
      out.push(p);
      continue;
    }
    const dt = (p.t ?? 0) - (prev.t ?? 0);
    if (dt <= 0) continue;
    const speed = haversine(prev.lat, prev.lon, p.lat, p.lon) / dt;
    if (speed > maxSpeed && rejected < MAX_REJECTED_RUN) {
      rejected++;
      continue;
    }
    rejected = 0;
    out.push(p);
  }
  return out;
}
