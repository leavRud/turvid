// Единственное состояние экрана просмотра — позиция на треке в метрах.

/** Кто поменял позицию: чтобы источник не реагировал сам на себя. */
export type PosSource = 'init' | 'slider' | 'arrow' | 'keys' | 'play' | 'list' | 'buttons';

export type PosListener = (pos: number, source: PosSource) => void;

export interface PositionStore {
  readonly length: number;
  get(): number;
  set(pos: number, source: PosSource): void;
  subscribe(listener: PosListener): () => void;
}

export function createPositionStore(length: number, initial: number): PositionStore {
  let pos = Math.min(Math.max(initial, 0), length);
  const listeners = new Set<PosListener>();
  return {
    length,
    get: () => pos,
    set(next, source) {
      const clamped = Math.min(Math.max(next, 0), length);
      if (clamped === pos) return;
      pos = clamped;
      listeners.forEach((l) => l(pos, source));
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
