// Режим «следовать»: карта плавно догоняет стрелку, держа её у центра. Чистые функции.

/** За сколько секунд карта сокращает отставание в e ≈ 2,7 раза. Больше — плавнее, но дальше от центра. */
export const FOLLOW_TAU_S = 0.35;
/** Дальше этой доли половины экрана стрелка не убегает: карта догоняет сильнее. */
export const FOLLOW_MAX_OFFSET = 0.6;

/**
 * Насколько сдвинуть центр карты за кадр, px. dx, dy — где стрелка относительно центра;
 * halfW, halfH — половины размеров карты.
 */
export function followStep(
  dx: number,
  dy: number,
  dt: number,
  halfW: number,
  halfH: number,
  tau = FOLLOW_TAU_S,
): [number, number] {
  // Экспоненциальное сглаживание: не зависит от частоты кадров.
  let k = 1 - Math.exp(-Math.max(dt, 0) / tau);
  // Если стрелка всё равно уходит далеко (быстрое проигрывание), догоняем сильнее.
  const limitX = halfW * FOLLOW_MAX_OFFSET;
  const limitY = halfH * FOLLOW_MAX_OFFSET;
  const over = Math.max(Math.abs(dx) / Math.max(limitX, 1), Math.abs(dy) / Math.max(limitY, 1));
  if (over > 1) k = Math.max(k, 1 - 1 / over);
  return [dx * k, dy * k];
}
