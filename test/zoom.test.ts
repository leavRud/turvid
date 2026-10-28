import { describe, expect, it } from 'vitest';
import {
  clampZoom,
  DOUBLE_TAP_SCALE,
  doubleTap,
  MAX_SCALE,
  NO_ZOOM,
  pinch,
  zoomAt,
  type Zoom,
} from '../src/ui/zoom';

/** Фото 400×300 на сцене 400×800 (телефон, фото во всю ширину). */
const box = { w: 400, h: 300, stageW: 400, stageH: 800 };

/** Где на экране (от центра сцены) окажется точка картинки p. */
const screen = (z: Zoom, px: number, py: number): [number, number] => [
  z.x + z.s * px,
  z.y + z.s * py,
];

describe('приближение фото', () => {
  it('без приближения картинку не сдвинуть', () => {
    expect(clampZoom({ s: 1, x: 50, y: -40 }, box)).toEqual(NO_ZOOM);
  });

  it('приближенную можно двигать, но край не отходит от края сцены', () => {
    // ×2: ширина 800 на сцене 400 — по x запас 200; высота 600 < 800 — по y не двигается.
    expect(clampZoom({ s: 2, x: 500, y: 100 }, box)).toEqual({ s: 2, x: 200, y: 0 });
    expect(clampZoom({ s: 2, x: -500, y: 0 }, box)).toEqual({ s: 2, x: -200, y: 0 });
  });

  it('масштаб не меньше 1 и не больше предела', () => {
    expect(clampZoom({ s: 0.3, x: 0, y: 0 }, box).s).toBe(1);
    expect(clampZoom({ s: 50, x: 0, y: 0 }, box).s).toBe(MAX_SCALE);
  });

  it('колесо и двойной тап: точка под пальцем остаётся под пальцем', () => {
    // ×4: фото 1600×1200 больше сцены по обеим осям — ограничитель не мешает.
    const z = zoomAt(NO_ZOOM, 4, 100, 50, box);
    expect(z.s).toBe(4);
    // Точка картинки (100, 50) была под (100, 50) — там и осталась.
    expect(screen(z, 100, 50)).toEqual([100, 50]);
  });

  it('щипок: пальцы раздвинули вчетверо — ×4, точка под серединой пальцев на месте', () => {
    const z = pinch(NO_ZOOM, 100, 60, 20, 400, 60, 20, box);
    expect(z.s).toBe(4);
    expect(screen(z, 60, 20)).toEqual([60, 20]);
  });

  it('щипок со сдвигом: картинка едет за серединой пальцев', () => {
    const start = { s: 2, x: 0, y: 0 };
    const z = pinch(start, 100, 0, 0, 100, -50, 0, box);
    expect(z).toEqual({ s: 2, x: -50, y: 0 });
  });

  it('двойной тап: целиком → приблизить в точку, приближено → целиком', () => {
    const z = doubleTap(NO_ZOOM, -80, 30, box);
    expect(z.s).toBe(DOUBLE_TAP_SCALE);
    expect(screen(z, -80, 30)[0]).toBeCloseTo(-80);
    expect(doubleTap(z, 0, 0, box)).toEqual(NO_ZOOM);
  });
});
