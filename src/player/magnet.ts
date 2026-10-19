// Магнит: позиция приклеивается к точке, если ближе 12 пикселей. Чистые функции.

export const MAGNET_PX = 12;

/**
 * Индекс ближайшей цели в пределах `threshold` (те же единицы, что у x — обычно пиксели),
 * или null. Тянешь дальше порога — магнит отпускает.
 */
export function magnetTarget(x: number, targets: number[], threshold = MAGNET_PX): number | null {
  let best: number | null = null;
  let bestD = threshold;
  targets.forEach((t, i) => {
    const d = Math.abs(t - x);
    if (d <= bestD) {
      best = i;
      bestD = d;
    }
  });
  return best;
}

/** Точка «магнитная», если в ней есть фото или заметка. */
export function isMagnetic(
  point: { id: string; title: string; description: string },
  mediaCountByPoint: Map<string, number>,
): boolean {
  return (
    (mediaCountByPoint.get(point.id) ?? 0) > 0 ||
    point.title.trim() !== '' ||
    point.description.trim() !== ''
  );
}
