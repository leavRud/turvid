// Проигрывание: стрелка едет сама, с паузой на каждой точке. Чистый шаг.

/** Базовая скорость «×1»: 1 км за 2 секунды, м/с. */
export const BASE_SPEED_MPS = 500;
/** Пауза на точке, с. */
export const POINT_PAUSE_S = 2;

export interface PlayState {
  pos: number;
  /** Сколько ещё стоять на точке, с. */
  pause: number;
  done: boolean;
}

/** Сдвигает позицию на `dt` секунд. Проезжая точку, останавливается на ней на 2 с. */
export function playStep(
  state: PlayState,
  dt: number,
  speed: number,
  points: number[],
  length: number,
): PlayState {
  if (state.done) return state;
  if (state.pause > 0) return { ...state, pause: Math.max(state.pause - dt, 0) };
  const target = state.pos + BASE_SPEED_MPS * speed * dt;
  let stop: number | null = null;
  for (const p of points) if (p > state.pos && p <= target && (stop === null || p < stop)) stop = p;
  if (stop !== null && stop < length) return { pos: stop, pause: POINT_PAUSE_S, done: false };
  if (target >= length) return { pos: length, pause: 0, done: true };
  return { pos: target, pause: 0, done: false };
}
