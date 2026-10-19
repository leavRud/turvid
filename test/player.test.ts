import { describe, expect, it } from 'vitest';
import { distanceAxis, NIGHT_GAP, timeAxis } from '../src/player/axis';
import { keyTarget, nextPointPos, prevPointPos } from '../src/player/keys';
import { BASE_SPEED_MPS, playStep, POINT_PAUSE_S } from '../src/player/playback';
import {
  bearingAt,
  dayIndexAt,
  parsePosParam,
  pointAt,
  posAtTime,
  timeAt,
  trackLength,
} from '../src/player/position';
import {
  profilePath,
  speedBands,
  speedLevel,
  stopMarks,
  stripModes,
} from '../src/player/strip-model';
import { splitDays, summarizeDays } from '../src/track/days';
import type { TrackData } from '../src/types';

const M = 1 / 111_195;

/**
 * Два дня: день 1 — 0..1000 м на север за 1000 с, с остановкой 600 с на 500 м;
 * ночь; день 2 — 1000..2000 м на восток за 1000 с.
 */
function sample(): TrackData {
  const lat = [60, 60 + 500 * M, 60 + 500 * M, 60 + 1000 * M, 60 + 1000 * M, 60 + 1000 * M];
  const kx = M / Math.cos((60 * Math.PI) / 180);
  const lon = [30, 30, 30, 30, 30 + 500 * kx, 30 + 1000 * kx];
  return {
    lat,
    lon,
    ele: [100, 150, 150, 200, 180, 160],
    t: [0, 200, 800, 1000, 50_000, 51_000],
    dist: [0, 500, 500, 1000, 1500, 2000],
  };
}

describe('position', () => {
  const track = sample();

  it('длина и интерполяция точки', () => {
    expect(trackLength(track)).toBe(2000);
    const p = pointAt(track, 250);
    expect(p.lat).toBeCloseTo(60 + 250 * M, 9);
    expect(p.ele).toBeCloseTo(125);
    expect(p.t).toBeCloseTo(100);
    expect(p.index).toBe(0);
  });

  it('на «плато» остановки — первое прибытие', () => {
    expect(timeAt(track, 500)).toBe(200);
  });

  it('позиция по времени, включая остановку', () => {
    expect(posAtTime(track, 100)).toBeCloseTo(250);
    expect(posAtTime(track, 500)).toBeCloseTo(500);
    expect(posAtTime(track, 50_500)).toBeCloseTo(1750);
  });

  it('направление: север и восток', () => {
    expect(bearingAt(track, 250)).toBeCloseTo(0, 0);
    expect(bearingAt(track, 1750)).toBeCloseTo(90, 0);
  });

  it('день по индексу отрезка', () => {
    const days = splitDays(track.t, 6);
    expect(dayIndexAt(days, pointAt(track, 250).index)).toBe(0);
    expect(dayIndexAt(days, pointAt(track, 1750).index)).toBe(1);
  });

  it('?pos= из адреса', () => {
    expect(parsePosParam('?pos=12340', 20_000)).toBe(12340);
    expect(parsePosParam('?pos=99999', 2000)).toBe(2000);
    expect(parsePosParam('?pos=abc', 2000)).toBeNull();
    expect(parsePosParam('', 2000)).toBeNull();
  });
});

describe('axis', () => {
  it('по расстоянию — линейно', () => {
    const a = distanceAxis(2000);
    expect(a.posToX(500)).toBe(0.25);
    expect(a.xToPos(0.5)).toBe(1000);
    expect(a.posToX(5000)).toBe(1);
  });

  it('по времени: дни подряд, ночь — разрыв', () => {
    const track = sample();
    const a = timeAxis(track, summarizeDays(track));
    expect(a.days).toHaveLength(2);
    const [d1, d2] = a.days;
    // Дни по 1000 с — равной ширины.
    expect(d1!.x0).toBe(0);
    expect(d1!.x1).toBeCloseTo((1 - NIGHT_GAP) / 2);
    expect(d2!.x0).toBeCloseTo(d1!.x1 + NIGHT_GAP);
    expect(d2!.x1).toBeCloseTo(1);
    // Остановка занимает место на оси: от 200 до 800 с позиция не меняется.
    expect(a.xToPos(a.timeToX(500))).toBeCloseTo(500);
    expect(a.posToX(1000)).toBeCloseTo(d1!.x1);
    expect(a.posToX(2000)).toBeCloseTo(1);
    // Клик в разрыв — к ближайшему дню.
    expect(a.xToTime(d1!.x1 + 0.001)).toBe(1000);
    expect(a.xToTime(d2!.x0 - 0.001)).toBe(50_000);
  });
});

describe('keys', () => {
  const points = [300, 1200];
  it('стрелки, Shift, Home/End', () => {
    expect(keyTarget('ArrowRight', false, 100, 2000, points)).toBe(150);
    expect(keyTarget('ArrowLeft', true, 100, 2000, points)).toBe(0);
    expect(keyTarget('ArrowRight', true, 1800, 2000, points)).toBe(2000);
    expect(keyTarget('Home', false, 900, 2000, points)).toBe(0);
    expect(keyTarget('End', false, 900, 2000, points)).toBe(2000);
    expect(keyTarget('a', false, 900, 2000, points)).toBeNull();
  });
  it('PageUp/PageDown — к точкам', () => {
    expect(keyTarget('PageDown', false, 300, 2000, points)).toBe(1200);
    expect(keyTarget('PageUp', false, 1200, 2000, points)).toBe(300);
    expect(keyTarget('PageDown', false, 1500, 2000, points)).toBe(2000);
    expect(prevPointPos(300, points)).toBeNull();
    expect(nextPointPos(0, points)).toBe(300);
  });
});

describe('playStep', () => {
  it('едет со скоростью ×1 = 1 км за 2 с, ×4 быстрее', () => {
    const s = playStep({ pos: 0, pause: 0, done: false }, 0.1, 1, [], 10_000);
    expect(s.pos).toBeCloseTo(BASE_SPEED_MPS * 0.1);
    expect(playStep({ pos: 0, pause: 0, done: false }, 0.1, 4, [], 10_000).pos).toBeCloseTo(200);
  });
  it('останавливается на точке на 2 с', () => {
    let s = playStep({ pos: 0, pause: 0, done: false }, 1, 1, [300], 10_000);
    expect(s).toEqual({ pos: 300, pause: POINT_PAUSE_S, done: false });
    s = playStep(s, 1.5, 1, [300], 10_000);
    expect(s.pos).toBe(300);
    s = playStep(s, 0.5, 1, [300], 10_000);
    expect(s.pause).toBe(0);
    s = playStep(s, 0.1, 1, [300], 10_000);
    expect(s.pos).toBeCloseTo(350);
  });
  it('в конце — done', () => {
    expect(playStep({ pos: 1900, pause: 0, done: false }, 1, 1, [], 2000)).toEqual({
      pos: 2000,
      pause: 0,
      done: true,
    });
  });
});

describe('strip model', () => {
  const track = sample();

  it('выбор режима', () => {
    expect(stripModes(track, true, 300)).toEqual({
      auto: 'profile',
      available: ['profile', 'timeline', 'slider'],
    });
    expect(stripModes(track, true, 100).auto).toBe('timeline');
    expect(stripModes(track, false, null)).toEqual({
      auto: 'timeline',
      available: ['timeline', 'slider'],
    });
    expect(stripModes({ ...track, t: null, ele: null }, false, null)).toEqual({
      auto: 'slider',
      available: ['slider'],
    });
  });

  it('профиль высоты — замкнутый путь', () => {
    const d = profilePath(track, distanceAxis(2000), 200, 50);
    expect(d.startsWith('M0 ')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
  });

  it('уровни скорости', () => {
    expect([0.5, 2, 4, 6].map(speedLevel)).toEqual([0, 1, 2, 3]);
  });

  it('полоса скорости: остановка — уровень 0, ночь пропущена', () => {
    const a = timeAxis(track, summarizeDays(track));
    const bands = speedBands(track, a.timeToX, 1);
    // 9 км/ч, стоянка, 9 км/ч, ночь пропущена, во втором дне 1,8 км/ч.
    expect(bands.map((b) => b.level)).toEqual([3, 0, 3, 1]);
    expect(bands.some((b) => b.level === 0)).toBe(true);
  });

  it('отметки остановок: подпись от 10 минут', () => {
    const a = timeAxis(track, summarizeDays(track));
    const marks = stopMarks(track, [{ start: 1, end: 2, durationS: 600 }], a.timeToX);
    expect(marks).toHaveLength(1);
    expect(marks[0]!.labeled).toBe(true);
    expect(marks[0]!.x1).toBeGreaterThan(marks[0]!.x0);
  });
});
