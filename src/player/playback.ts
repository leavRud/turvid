// Проигрывание: стрелка едет сама, с паузой на каждой точке. Чистые шаги.

/** Скорости проигрывания. */
export const SPEEDS = [0.5, 1, 2, 4] as const;
/** Базовая скорость «×1»: 1 км за 2 секунды, м/с. */
export const BASE_SPEED_MPS = 500;
/** Пауза на точке, с. */
export const POINT_PAUSE_S = 2;
/** Ночь (сон, часы не писали) проигрывается во столько раз быстрее обычного. */
export const NIGHT_SPEEDUP = 20;

export interface PlayState {
  pos: number;
  /** Сколько ещё стоять на точке, с. */
  pause: number;
  done: boolean;
}

/** Без времени в треке: едем по расстоянию. Проезжая точку, стоим на ней 2 с. */
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

/**
 * Сколько секунд похода проходит за секунду проигрывания на «×1»: так, чтобы в движении
 * со средней скоростью похода выходил тот же «1 км за 2 секунды».
 */
export function timeRate(distanceM: number, movingS: number | null): number {
  if (!movingS || movingS <= 0 || distanceM <= 0) return 300;
  return BASE_SPEED_MPS / (distanceM / movingS);
}

export interface TimePlayState {
  /** Секунды от старта трека. */
  t: number;
  pause: number;
  done: boolean;
}

export interface TimePlayContext {
  /** Секунд похода за секунду проигрывания на «×1». */
  rate: number;
  endT: number;
  /** Время, когда проходили точки. */
  pointTimes: number[];
  isNight: (t: number) => boolean;
}

/**
 * С временем в треке: время идёт своим чередом — на остановке стрелка стоит столько,
 * сколько стоял ты (в масштабе скорости); ускоряется только ночь. На точках — пауза 2 с.
 */
export function playStepTime(
  state: TimePlayState,
  dt: number,
  speed: number,
  ctx: TimePlayContext,
): TimePlayState {
  if (state.done) return state;
  if (state.pause > 0) return { ...state, pause: Math.max(state.pause - dt, 0) };
  const k = ctx.isNight(state.t) ? NIGHT_SPEEDUP : 1;
  const target = state.t + ctx.rate * speed * k * dt;
  let stop: number | null = null;
  for (const p of ctx.pointTimes) {
    if (p > state.t && p <= target && (stop === null || p < stop)) stop = p;
  }
  if (stop !== null && stop < ctx.endT) return { t: stop, pause: POINT_PAUSE_S, done: false };
  if (target >= ctx.endT) return { t: ctx.endT, pause: 0, done: true };
  return { t: target, pause: 0, done: false };
}
