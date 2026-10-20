import { describe, expect, it } from 'vitest';
import { distanceAxis, isNight, NIGHT_SCALE, timeAxis } from '../src/player/axis';
import { keyTarget, nextPointPos, prevPointPos } from '../src/player/keys';
import {
  BASE_SPEED_MPS,
  NIGHT_SPEEDUP,
  playStep,
  playStepTime,
  SPEEDS,
  timeRate,
} from '../src/player/playback';
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
  edgeScroll,
  followView,
  MIN_VIEW,
  skyStops,
  panView,
  profilePath,
  speedBands,
  speedLevel,
  stopMarks,
  stripModes,
  zoomView,
} from '../src/player/strip-model';
import { daylight, sunAltitude } from '../src/player/sun';
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

  it('по времени: без пробелов, ночь сжата', () => {
    const track = sample();
    const a = timeAxis(track, summarizeDays(track));
    expect(a.days).toHaveLength(2);
    expect(a.segments.map((s) => s.night)).toEqual([false, true, false]);
    const [d1, d2] = a.days;
    // Дни по 1000 с, ночь 49 000 с, сжатая в 4 раза: 1000 + 12 250 + 1000.
    const total = 1000 + 49_000 * NIGHT_SCALE + 1000;
    expect(d1!.x0).toBe(0);
    expect(d1!.x1).toBeCloseTo(1000 / total);
    expect(d2!.x0).toBeCloseTo(1 - 1000 / total);
    expect(d2!.x1).toBe(1);
    // Куски идут встык — пробелов нет.
    a.segments.slice(1).forEach((s, i) => expect(s.x0).toBe(a.segments[i]!.x1));
    // Остановка занимает место на оси: от 200 до 800 с позиция не меняется.
    expect(a.xToPos(a.timeToX(500))).toBeCloseTo(500);
    expect(a.posToX(2000)).toBeCloseTo(1);
    // По ночи время идёт: середина ночи — середина её куска оси.
    const night = a.segments[1]!;
    expect(a.xToTime((night.x0 + night.x1) / 2)).toBeCloseTo(25_500);
    expect(a.timeToX(25_500)).toBeCloseTo((night.x0 + night.x1) / 2);
    expect(isNight(a, 25_500)).toBe(true);
    expect(isNight(a, 500)).toBe(false);
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
    const s = playStep({ pos: 0, atPoint: false, done: false }, 0.1, 1, [], 10_000);
    expect(s.pos).toBeCloseTo(BASE_SPEED_MPS * 0.1);
    expect(playStep({ pos: 0, atPoint: false, done: false }, 0.1, 4, [], 10_000).pos).toBeCloseTo(
      200,
    );
  });
  it('встаёт на точке, а после «Играть» с неё — едет дальше', () => {
    let s = playStep({ pos: 0, atPoint: false, done: false }, 1, 1, [300], 10_000);
    expect(s).toEqual({ pos: 300, atPoint: true, done: false });
    // Снова «Играть» — с той же позиции: точку не ловим второй раз.
    s = playStep({ ...s, atPoint: false }, 0.1, 1, [300], 10_000);
    expect(s).toEqual({ pos: 350, atPoint: false, done: false });
  });
  it('в конце — done', () => {
    expect(playStep({ pos: 1900, atPoint: false, done: false }, 1, 1, [], 2000)).toEqual({
      pos: 2000,
      atPoint: false,
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

  it('отметки остановок', () => {
    const a = timeAxis(track, summarizeDays(track));
    const marks = stopMarks(track, [{ start: 1, end: 2, durationS: 600 }], a.timeToX);
    expect(marks).toHaveLength(1);
    expect(marks[0]!.x1).toBeGreaterThan(marks[0]!.x0);
  });
});

describe('sun', () => {
  // Место эталонного похода, 17 октября 2026.
  const lat = 61.11;
  const lon = 29.87;
  const at = (hhmmUtc: string): number => Date.parse('2026-10-17T' + hhmmUtc + ':00Z');

  it('днём солнце над горизонтом, ночью под ним', () => {
    expect(sunAltitude(at('09:45'), lat, lon)).toBeGreaterThan(18);
    expect(sunAltitude(at('20:00'), lat, lon)).toBeLessThan(-20);
  });

  it('закат около 17:37 по Москве (14:37 UTC)', () => {
    expect(sunAltitude(at('14:20'), lat, lon)).toBeGreaterThan(0);
    expect(sunAltitude(at('14:55'), lat, lon)).toBeLessThan(0);
  });

  it('светлота: ночь, сумерки, день', () => {
    expect(daylight(-10)).toBe(0);
    expect(daylight(0)).toBe(0.5);
    expect(daylight(10)).toBe(1);
  });

  it('небо одной лентой: светло в начале, темнеет к вечеру', () => {
    // С 15:00 до 19:00 МСК (12:00–16:00 UTC) в одной точке, ось — линейное время.
    const start = Date.parse('2026-10-17T12:00:00Z') / 1000;
    const track = { lat: [lat, lat], lon: [lon, lon], ele: null, t: [0, 4 * 3600], dist: [0, 1] };
    const stops = skyStops(track, start, (x) => x * 4 * 3600, 50);
    expect(stops).toHaveLength(50);
    expect(stops[0]!.offset).toBe(0);
    expect(stops.at(-1)!.offset).toBe(1);
    expect(stops[0]!.night).toBe(0);
    expect(stops.at(-1)!.night).toBe(1);
  });
});

describe('масштаб полосы', () => {
  const all = { a: 0, b: 1 };

  it('приближение вокруг точки оставляет её на месте', () => {
    const v = zoomView(all, 0.5, 0.5);
    expect(v.a).toBeCloseTo(0.25);
    expect(v.b).toBeCloseTo(0.75);
    const left = zoomView(all, 0.5, 0);
    expect(left).toEqual({ a: 0, b: 0.5 });
  });

  it('не дальше ×100 и не шире всей оси', () => {
    expect(zoomView(all, 0.0001, 0.3).b - zoomView(all, 0.0001, 0.3).a).toBeCloseTo(MIN_VIEW);
    expect(zoomView({ a: 0.2, b: 0.4 }, 100, 0.3)).toEqual(all);
  });

  it('сдвиг упирается в края', () => {
    expect(panView({ a: 0.5, b: 0.75 }, 0.5)).toEqual({ a: 0.75, b: 1 });
    const back = panView({ a: 0.1, b: 0.3 }, -1);
    expect(back.a).toBe(0);
    expect(back.b).toBeCloseTo(0.2);
  });

  it('окно едет за стрелкой, если та у края', () => {
    const v = { a: 0, b: 0.2 };
    expect(followView(v, 0.1)).toBe(v);
    const moved = followView(v, 0.3);
    expect(moved.b - moved.a).toBeCloseTo(0.2);
    expect(0.3).toBeLessThan(moved.b);
    expect(0.3).toBeGreaterThan(moved.a);
  });
});

describe('проигрывание по времени', () => {
  const ctx = {
    rate: 400,
    endT: 100_000,
    pointTimes: [5_000],
    isNight: (t: number) => t > 20_000 && t < 60_000,
  };
  const at = (t: number) => ({ t, atPoint: false, done: false });

  it('скорости ×0.5, ×1, ×2, ×4', () => {
    expect([...SPEEDS]).toEqual([0.5, 1, 2, 4]);
    expect(playStepTime(at(0), 1, 0.5, ctx).t).toBeCloseTo(200);
    expect(playStepTime(at(0), 1, 4, ctx).t).toBeCloseTo(1600);
  });

  it('время идёт и на стоянке — стоянки не перескакиваются', () => {
    // От 1000 до 1001 с проходит ровно rate × dt, где бы ты ни стоял.
    expect(playStepTime(at(1000), 0.5, 1, ctx).t).toBeCloseTo(1200);
  });

  it('ночь ускорена', () => {
    expect(playStepTime(at(30_000), 1, 1, ctx).t).toBeCloseTo(30_000 + 400 * NIGHT_SPEEDUP);
  });

  it('на точке — пауза, после «Играть» — дальше', () => {
    const s = playStepTime(at(4_900), 1, 1, ctx);
    expect(s).toEqual({ t: 5_000, atPoint: true, done: false });
    expect(playStepTime(at(5_000), 0.5, 1, ctx).atPoint).toBe(false);
  });

  it('в конце — done', () => {
    expect(playStepTime(at(99_900), 1, 1, ctx)).toEqual({
      t: 100_000,
      atPoint: false,
      done: true,
    });
  });

  it('×1 по времени — как «1 км за 2 с» на средней скорости похода', () => {
    // 31,4 км за 6 ч 45 мин в движении → ~1,29 м/с → ~387 с похода за секунду.
    expect(timeRate(31_438, 24_294)).toBeCloseTo(BASE_SPEED_MPS / (31_438 / 24_294));
    expect(timeRate(1000, null)).toBe(300);
  });
});

describe('прокрутка у края', () => {
  it('в середине — стоит, у краёв — едет, сильнее у самого края', () => {
    expect(edgeScroll(0.5, 0.1)).toBe(0);
    expect(edgeScroll(0.05, 0.1)).toBeCloseTo(-0.5);
    expect(edgeScroll(0, 0.1)).toBe(-1);
    expect(edgeScroll(-0.3, 0.1)).toBe(-1);
    expect(edgeScroll(0.95, 0.1)).toBeCloseTo(0.5);
    expect(edgeScroll(1.2, 0.1)).toBe(1);
  });
});
