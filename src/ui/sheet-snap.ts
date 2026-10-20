// Куда «доезжает» шторка после жеста. Чистые функции.

/** Два положения: краешек с заголовком и почти весь экран, без остановки на полпути. */
export type SheetState = 'peek' | 'full';

export interface SheetHeights {
  peek: number;
  full: number;
}

/** Скорость, после которой жест считается «смахиванием», px/мс. */
export const FLING_PX_PER_MS = 0.5;

/**
 * height — где отпустили, velocity — скорость вверх (+) или вниз (−), px/мс.
 * Быстрое смахивание — в его сторону, иначе — к ближайшему положению.
 */
export function snapSheet(height: number, velocity: number, h: SheetHeights): SheetState {
  if (Math.abs(velocity) >= FLING_PX_PER_MS) return velocity > 0 ? 'full' : 'peek';
  return height - h.peek < h.full - height ? 'peek' : 'full';
}

/** Щелчок по краю шторки: свёрнута — открыть, открыта — свернуть. */
export function toggleSheet(state: SheetState): SheetState {
  return state === 'peek' ? 'full' : 'peek';
}
