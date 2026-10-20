import { describe, expect, it } from 'vitest';
import {
  MOVE_TOLERANCE_PX,
  idlePress,
  pressStep,
  type PressAction,
  type PressEvent,
  type PressState,
} from '../src/map/long-press';

const down = (id: number, x = 100, y = 100, primary = true, onMap = true): PressEvent => ({
  type: 'down',
  id,
  x,
  y,
  primary,
  onMap,
});

/** Прогнать события, вернуть итоговое состояние и все ответы. */
function run(events: PressEvent[]): { state: PressState; actions: PressAction[] } {
  let state = idlePress();
  const actions: PressAction[] = [];
  for (const e of events) {
    const step = pressStep(state, e);
    state = step.state;
    actions.push(step.action);
  }
  return { state, actions };
}

describe('долгое нажатие на карту', () => {
  it('один палец на карте — ставим таймер', () => {
    const { state, actions } = run([down(1)]);
    expect(actions).toEqual(['start']);
    expect(state.press).toEqual({ id: 1, x: 100, y: 100 });
  });

  it('щипок: второй палец снимает таймер первого и нового не ставит', () => {
    const { state, actions } = run([down(1), down(2, 200, 200, false)]);
    expect(actions).toEqual(['start', 'cancel']);
    expect(state.press).toBeNull();
    expect(state.pointers).toEqual([1, 2]);
  });

  it('после щипка, пока второй палец на экране, долгого нажатия нет', () => {
    const { state, actions } = run([
      down(1),
      down(2, 200, 200, false),
      { type: 'up', id: 1 },
      down(3, 150, 150, false),
    ]);
    expect(actions.at(-1)).toBeNull();
    expect(state.press).toBeNull();
  });

  it('второй палец на маркере тоже считается', () => {
    const { actions } = run([down(1), down(2, 200, 200, false, false)]);
    expect(actions).toEqual(['start', 'cancel']);
  });

  it('потерянный «up» не мешает: новое первое касание начинает заново', () => {
    const { state, actions } = run([down(1), down(2, 200, 200, false), down(5)]);
    expect(actions.at(-1)).toBe('start');
    expect(state.pointers).toEqual([5]);
  });

  it('нажатие не на карту (маркер, правая кнопка) — без таймера', () => {
    expect(run([down(1, 100, 100, true, false)]).actions).toEqual([null]);
  });

  it('палец сдвинулся больше допуска — отмена, в пределах допуска — ждём', () => {
    const near = MOVE_TOLERANCE_PX - 1;
    const far = MOVE_TOLERANCE_PX + 1;
    expect(run([down(1), { type: 'move', id: 1, x: 100 + near, y: 100 }]).actions).toEqual([
      'start',
      null,
    ]);
    expect(run([down(1), { type: 'move', id: 1, x: 100 + far, y: 100 }]).actions).toEqual([
      'start',
      'cancel',
    ]);
  });

  it('отпустили палец или карта поехала — отмена', () => {
    expect(run([down(1), { type: 'up', id: 1 }]).actions).toEqual(['start', 'cancel']);
    expect(run([down(1), { type: 'abort' }]).actions).toEqual(['start', 'cancel']);
  });

  it('повторное нажатие тем же указателем (мышь) — снова один таймер', () => {
    const { state, actions } = run([down(1), { type: 'up', id: 1 }, down(1, 50, 60)]);
    expect(actions).toEqual(['start', 'cancel', 'start']);
    expect(state.pointers).toEqual([1]);
    expect(state.press).toEqual({ id: 1, x: 50, y: 60 });
  });
});
