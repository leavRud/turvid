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
 * Так же остаются точки из `keep` (границы остановок): день режется на куски по ним.
 * Если точек больше `maxPoints`, допуск растёт.
 */
export function simplifyIndices(
  lat: number[],
  lon: number[],
  days: DayRange[],
  tolerance = SIMPLIFY_TOLERANCE_M,
  maxPoints = MAX_POINTS,
  keep: number[] = [],
): number[] {
  if (!lat.length) return [];
  const project = localProjection(lat[0] as number);
  const cuts = new Set(keep);
  const chunks: IndexedPoint[][] = [];
  for (const { start, end } of days) {
    let chunk: IndexedPoint[] = [];
    for (let i = start; i <= end; i++) {
      const [x, y] = project(lat[i] as number, lon[i] as number);
      chunk.push({ x, y, i });
      if (cuts.has(i) && i > start && i < end) {
        chunks.push(chunk);
        chunk = [{ x, y, i }];
      }
    }
    chunks.push(chunk);
  }

  let tol = tolerance;
  for (;;) {
    // simplify-js возвращает те же объекты, что получил, поэтому поле `i` сохраняется.
    const kept: number[] = [];
    for (const pts of chunks) {
      for (const p of simplify(pts, tol, true) as IndexedPoint[]) {
        // Точка на стыке кусков попадает в оба — берём один раз.
        if (kept[kept.length - 1] !== p.i) kept.push(p.i);
      }
    }
    if (kept.length <= maxPoints || tol > 10_000) return kept;
    tol *= 1.5;
  }
}
