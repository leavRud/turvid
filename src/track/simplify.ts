// Упрощение трека: Дуглас–Пекер (simplify-js) по дням, с потолком числа точек.

import simplify from 'simplify-js';
import type { DayRange } from './days';
import { localProjection } from './geo';

export const SIMPLIFY_TOLERANCE_M = 3;
export const MAX_POINTS = 5000;

interface IndexedPoint {
  x: number;
  y: number;
  i: number;
}

/**
 * Индексы точек, которые остаются после упрощения (по возрастанию).
 * Каждый день упрощается отдельно, поэтому его первая и последняя точки всегда остаются.
 * Если точек больше `maxPoints`, допуск растёт.
 */
export function simplifyIndices(
  lat: number[],
  lon: number[],
  days: DayRange[],
  tolerance = SIMPLIFY_TOLERANCE_M,
  maxPoints = MAX_POINTS,
): number[] {
  if (!lat.length) return [];
  const project = localProjection(lat[0] as number);
  const dayPoints: IndexedPoint[][] = days.map(({ start, end }) => {
    const pts: IndexedPoint[] = [];
    for (let i = start; i <= end; i++) {
      const [x, y] = project(lat[i] as number, lon[i] as number);
      pts.push({ x, y, i });
    }
    return pts;
  });

  let tol = tolerance;
  for (;;) {
    // simplify-js возвращает те же объекты, что получил, поэтому поле `i` сохраняется.
    const kept = dayPoints.flatMap((pts) => simplify(pts, tol, true) as IndexedPoint[]);
    if (kept.length <= maxPoints || tol > 10_000) return kept.map((p) => p.i);
    tol *= 1.5;
  }
}
