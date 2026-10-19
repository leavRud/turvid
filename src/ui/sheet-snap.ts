// Куда «доезжает» шторка после жеста. Чистые функции.

export type SheetState = 'peek' | 'half' | 'full';

export interface SheetHeights {
  peek: number;
  half: number;
  full: number;
}

/** Скорость, после которой жест считается «смахиванием», px/мс. */
export const FLING_PX_PER_MS = 0.5;

const ORDER: SheetState[] = ['peek', 'half', 'full'];

/**
 * height — где отпустили, velocity — скорость вверх (+) или вниз (−), px/мс.
 * Быстрое смахивание — на следующее положение в его сторону, иначе — к ближайшему.
 */
export function snapSheet(height: number, velocity: number, h: SheetHeights): SheetState {
  if (Math.abs(velocity) >= FLING_PX_PER_MS) {
    if (velocity > 0) return ORDER.find((s) => h[s] > height + 1) ?? 'full';
    return [...ORDER].reverse().find((s) => h[s] < height - 1) ?? 'peek';
  }
  let best: SheetState = 'peek';
  for (const s of ORDER) if (Math.abs(h[s] - height) < Math.abs(h[best] - height)) best = s;
  return best;
}

/** Щелчок по краю шторки: свёрнута — до половины, иначе — свернуть. */
export function toggleSheet(state: SheetState): SheetState {
  return state === 'peek' ? 'half' : 'peek';
}
