// Клавиатура и переходы к точкам. Чистые функции.

export const STEP_M = 50;
export const BIG_STEP_M = 500;
/** Ближе этого позиция считается «на точке», м. */
const EPS_M = 0.5;

/** Ближайшая точка позади позиции. */
export function prevPointPos(pos: number, points: number[]): number | null {
  let best: number | null = null;
  for (const p of points) if (p < pos - EPS_M && (best === null || p > best)) best = p;
  return best;
}

/** Ближайшая точка впереди позиции. */
export function nextPointPos(pos: number, points: number[]): number | null {
  let best: number | null = null;
  for (const p of points) if (p > pos + EPS_M && (best === null || p < best)) best = p;
  return best;
}

/**
 * Новая позиция по клавише: ← → на 50 м (с Shift на 500 м), PageUp/PageDown — к точкам,
 * Home/End — старт и финиш. null — клавиша не наша.
 */
export function keyTarget(
  key: string,
  shift: boolean,
  pos: number,
  length: number,
  points: number[],
): number | null {
  const step = shift ? BIG_STEP_M : STEP_M;
  const clamp = (v: number): number => Math.min(Math.max(v, 0), length);
  switch (key) {
    case 'ArrowLeft':
      return clamp(pos - step);
    case 'ArrowRight':
      return clamp(pos + step);
    case 'Home':
      return 0;
    case 'End':
      return length;
    case 'PageUp':
      return prevPointPos(pos, points) ?? 0;
    case 'PageDown':
      return nextPointPos(pos, points) ?? length;
    default:
      return null;
  }
}
