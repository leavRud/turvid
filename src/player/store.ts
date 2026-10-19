// Единственное состояние экрана просмотра — позиция на треке в метрах.
// К ней может прилагаться подсказка времени: на остановке позиция стоит, а время идёт
// (проигрывание, ползунок шкалы времени). Без подсказки время — первое прибытие на позицию.

/** Кто поменял позицию: чтобы источник не реагировал сам на себя. */
export type PosSource = 'init' | 'slider' | 'arrow' | 'keys' | 'play' | 'list' | 'buttons';

export type PosListener = (pos: number, source: PosSource) => void;

export interface PositionStore {
  readonly length: number;
  get(): number;
  /** Время на позиции (секунды от старта трека), если его задали явно. */
  time(): number | null;
  set(pos: number, source: PosSource, time?: number | null): void;
  subscribe(listener: PosListener): () => void;
}

export function createPositionStore(length: number, initial: number): PositionStore {
  let pos = Math.min(Math.max(initial, 0), length);
  let time: number | null = null;
  const listeners = new Set<PosListener>();
  return {
    length,
    get: () => pos,
    time: () => time,
    set(next, source, nextTime = null) {
      const clamped = Math.min(Math.max(next, 0), length);
      if (clamped === pos && nextTime === time) return;
      pos = clamped;
      time = nextTime;
      listeners.forEach((l) => l(pos, source));
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
