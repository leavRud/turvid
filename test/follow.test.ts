import { describe, expect, it } from 'vitest';
import { FOLLOW_MAX_OFFSET, followStep } from '../src/map/follow';

describe('плавное «следовать»', () => {
  it('за кадр сокращает отставание на долю, не прыгает сразу', () => {
    const [mx, my] = followStep(100, -40, 1 / 60, 200, 200);
    expect(mx).toBeGreaterThan(0);
    expect(mx).toBeLessThan(10);
    expect(my / mx).toBeCloseTo(-0.4);
  });

  it('не зависит от частоты кадров: два шага по 1/60 ≈ одному по 1/30', () => {
    const [a] = followStep(100, 0, 1 / 60, 200, 200);
    const [b] = followStep(100 - a, 0, 1 / 60, 200, 200);
    const [c] = followStep(100, 0, 1 / 30, 200, 200);
    expect(a + b).toBeCloseTo(c, 5);
  });

  it('стрелка далеко от центра — догоняет до допустимого отставания за один кадр', () => {
    const half = 200;
    const dx = half * FOLLOW_MAX_OFFSET * 2; // вдвое дальше допустимого
    const [mx] = followStep(dx, 0, 1 / 60, half, half);
    expect(dx - mx).toBeCloseTo(half * FOLLOW_MAX_OFFSET);
  });
});
