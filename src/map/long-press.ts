// Долгое нажатие на карту: чистая логика без DOM и таймеров.
// Карта кормит сюда события указателей и по ответу ставит или снимает таймер.

/** Долгое нажатие на карту, мс. */
export const LONG_PRESS_MS = 600;
/** Палец сдвинулся больше — это уже не долгое нажатие и не клик, px. */
export const MOVE_TOLERANCE_PX = 8;

export type PressEvent =
  /** primary — первый палец (или мышь): других касаний сейчас нет. */
  | { type: 'down'; id: number; x: number; y: number; primary: boolean; onMap: boolean }
  | { type: 'move'; id: number; x: number; y: number }
  /** Палец отпущен или указатель отменён браузером. */
  | { type: 'up'; id: number }
  /** Карта поехала (перетаскивание, щипок, анимация). */
  | { type: 'abort' };

export interface PressState {
  /** Нажатые сейчас указатели. */
  pointers: number[];
  /** Идёт долгое нажатие: кто и где нажал. */
  press: { id: number; x: number; y: number } | null;
}

/** start — снять прежний таймер и поставить новый; cancel — снять таймер. */
export type PressAction = 'start' | 'cancel' | null;

export const idlePress = (): PressState => ({ pointers: [], press: null });

export function pressStep(
  state: PressState,
  e: PressEvent,
): { state: PressState; action: PressAction } {
  const drop = (pointers: number[]): { state: PressState; action: PressAction } => ({
    state: { pointers, press: null },
    action: state.press ? 'cancel' : null,
  });
  switch (e.type) {
    case 'down': {
      // Первый палец — других касаний нет: забываем указатели, чей «up» мог потеряться.
      const pointers = e.primary ? [e.id] : [...state.pointers.filter((p) => p !== e.id), e.id];
      // Второй палец — это щипок, а не долгое нажатие.
      if (pointers.length > 1 || !e.onMap) return drop(pointers);
      return { state: { pointers, press: { id: e.id, x: e.x, y: e.y } }, action: 'start' };
    }
    case 'move': {
      const { press } = state;
      if (!press || press.id !== e.id) return { state, action: null };
      if (Math.hypot(e.x - press.x, e.y - press.y) <= MOVE_TOLERANCE_PX) {
        return { state, action: null };
      }
      return drop(state.pointers);
    }
    case 'up':
      return drop(state.pointers.filter((p) => p !== e.id));
    case 'abort':
      return drop(state.pointers);
  }
}
