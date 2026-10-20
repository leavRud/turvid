// Проигрывание: стрелка едет сама и встаёт на паузу на каждой точке. Чистые шаги.

/** Скорости проигрывания. */
export const SPEEDS = [0.5, 1, 2, 4] as const;
/** Базовая скорость «×1»: 1 км за 2 секунды, м/с. */
export const BASE_SPEED_MPS = 500;
/** Ночь (сон, часы не писали) проигрывается во столько раз быстрее обычного. */
export const NIGHT_SPEEDUP = 20;

export interface PlayState {
  pos: number;
  /** Доехали до точки — проигрывание встаёт на паузу, дальше — по «Играть». */
  atPoint: boolean;
  done: boolean;
}

/** Без времени в треке: едем по расстоянию. Доехав до точки, встаём на ней. */
export function playStep(
  state: PlayState,
  dt: number,
  speed: number,
  points: number[],
  length: number,
): PlayState {
  if (state.done) return state;
  const target = state.pos + BASE_SPEED_MPS * speed * dt;
  let stop: number | null = null;
  for (const p of points) if (p > state.pos && p <= target && (stop === null || p < stop)) stop = p;
  if (stop !== null && stop < length) return { pos: stop, atPoint: true, done: false };
  if (target >= length) return { pos: length, atPoint: false, done: true };
  return { pos: target, atPoint: false, done: false };
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
  atPoint: boolean;
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
 * сколько стоял ты (в масштабе скорости); ускоряется только ночь. На точке — пауза.
 */
export function playStepTime(
  state: TimePlayState,
  dt: number,
  speed: number,
  ctx: TimePlayContext,
): TimePlayState {
  if (state.done) return state;
  const k = ctx.isNight(state.t) ? NIGHT_SPEEDUP : 1;
  const target = state.t + ctx.rate * speed * k * dt;
  let stop: number | null = null;
  for (const p of ctx.pointTimes) {
    if (p > state.t && p <= target && (stop === null || p < stop)) stop = p;
  }
  if (stop !== null && stop < ctx.endT) return { t: stop, atPoint: true, done: false };
  if (target >= ctx.endT) return { t: ctx.endT, atPoint: false, done: true };
  return { t: target, atPoint: false, done: false };
}
