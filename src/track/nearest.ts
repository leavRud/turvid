// Ближайшее место на треке к произвольной точке.

import { haversine, localProjection } from './geo';

export interface TrackLine {
  lat: ArrayLike<number>;
  lon: ArrayLike<number>;
  dist: ArrayLike<number>;
}

export interface NearestResult {
  /** Позиция на треке, м от старта. */
  pos: number;
  lat: number;
  lon: number;
  /** Расстояние от точки до трека, м. */
  offset: number;
}

/** Проекция точки на каждый отрезок трека; позиция интерполируется по `dist`. */
export function nearestOnTrack(line: TrackLine, lat: number, lon: number): NearestResult | null {
  const n = line.lat.length;
  if (!n) return null;
  const project = localProjection(lat);
  const [px, py] = project(lat, lon);
  let best: NearestResult | null = null;
  let bestD2 = Infinity;

  for (let i = 0; i < Math.max(1, n - 1); i++) {
    const j = Math.min(i + 1, n - 1);
    const [ax, ay] = project(line.lat[i] as number, line.lon[i] as number);
    const [bx, by] = project(line.lat[j] as number, line.lon[j] as number);
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const k = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
    const qx = ax + k * dx;
    const qy = ay + k * dy;
    const d2 = (px - qx) ** 2 + (py - qy) ** 2;
    if (d2 < bestD2) {
      bestD2 = d2;
      const di = line.dist[i] as number;
      const qLat =
        (line.lat[i] as number) + k * ((line.lat[j] as number) - (line.lat[i] as number));
      const qLon =
        (line.lon[i] as number) + k * ((line.lon[j] as number) - (line.lon[i] as number));
      best = {
        pos: di + k * ((line.dist[j] as number) - di),
        lat: qLat,
        lon: qLon,
        offset: haversine(lat, lon, qLat, qLon),
      };
    }
  }
  return best;
}
