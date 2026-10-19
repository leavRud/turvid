/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseGpx } from '../src/parse/gpx';
import { ImportError, type RawPoint } from '../src/parse/types';
import { cleanPoints } from '../src/track/clean';
import { splitDays } from '../src/track/days';
import { cumulativeDistance } from '../src/track/distance';
import { elevationGain, isElevationUnreliable, medianSmooth } from '../src/track/elevation';
import { haversine } from '../src/track/geo';
import { nearestOnTrack } from '../src/track/nearest';
import { processTrack, WARNINGS } from '../src/track/process';
import { simplifyIndices } from '../src/track/simplify';
import { findStops } from '../src/track/stops';

/** Метров в градусе широты (для синтетических треков). */
const M = 1 / 111_195;
const T0 = Date.parse('2026-10-17T07:00:00Z') / 1000;

/** Точки на север от (60, 30), шаг `step` м раз в `dt` с. */
function line(
  count: number,
  step = 1,
  dt = 1,
  from = 0,
  t0 = T0,
): { lat: number; lon: number; t: number }[] {
  return Array.from({ length: count }, (_, i) => ({
    lat: 60 + (from + i * step) * M,
    lon: 30,
    t: t0 + i * dt,
  }));
}

describe('haversine', () => {
  it('градус широты ≈ 111,2 км', () => {
    expect(haversine(60, 30, 61, 30)).toBeCloseTo(111_195, -1);
  });
});

describe('cleanPoints', () => {
  it('дубликаты и время назад выкидываются', () => {
    const pts = line(3);
    const dup = { ...(pts[1] as RawPoint) };
    const back = { ...(pts[2] as RawPoint), t: T0 - 5 };
    expect(cleanPoints([pts[0]!, pts[1]!, dup, back, pts[2]!], true)).toEqual(pts);
  });

  it('одиночный скачок быстрее 50 км/ч — выброс', () => {
    const pts = line(5);
    const spike = { lat: 60 + 500 * M, lon: 30, t: T0 + 1.5 }; // 500 м за полсекунды
    const out = cleanPoints([pts[0]!, pts[1]!, spike, pts[2]!, pts[3]!, pts[4]!], true);
    expect(out).toEqual(pts);
  });

  it('если отброшено подряд много точек — принимаем (ошибочна опора)', () => {
    const bad = { lat: 61, lon: 30, t: T0 - 1 };
    const out = cleanPoints([bad, ...line(30)], true);
    expect(out.length).toBeGreaterThan(5);
  });

  it('без времени — только одинаковые соседние координаты', () => {
    const a = { lat: 1, lon: 1 };
    const b = { lat: 2, lon: 2 };
    expect(cleanPoints([a, { ...a }, b, a], false)).toEqual([a, b, a]);
  });
});

describe('splitDays', () => {
  it('разрыв больше 3 ч — новый день', () => {
    expect(splitDays([0, 10, 10 + 3 * 3600, 20 + 6 * 3600 + 11], 4)).toEqual([
      { start: 0, end: 2 },
      { start: 3, end: 3 },
    ]);
  });
  it('без времени — один день', () => {
    expect(splitDays(null, 5)).toEqual([{ start: 0, end: 4 }]);
  });
});

describe('cumulativeDistance', () => {
  it('прямая: каждый метр считается', () => {
    const pts = line(101, 1);
    const days = [{ start: 0, end: 100 }];
    const dist = cumulativeDistance(
      pts.map((p) => p.lat),
      pts.map((p) => p.lon),
      days,
    );
    expect(dist[100]).toBeCloseTo(100, 0);
  });

  it('дрожание на месте не накручивает расстояние, массив не убывает', () => {
    // 600 точек, прыгающих на ±0,8 м вокруг одного места (меньше шага 2 м).
    const lat = Array.from({ length: 600 }, (_, i) => 60 + (i % 2 ? 0.8 : -0.8) * M);
    const lon = lat.map(() => 30);
    const dist = cumulativeDistance(lat, lon, [{ start: 0, end: 599 }]);
    expect(dist[599]).toBeLessThan(5);
    for (let i = 1; i < dist.length; i++) expect(dist[i]).toBeGreaterThanOrEqual(dist[i - 1]!);
  });

  it('через ночной разрыв расстояние не добавляется', () => {
    const lat = [60, 60 + 100 * M, 60 + 1000 * M, 60 + 1100 * M];
    const lon = [30, 30, 30, 30];
    const dist = cumulativeDistance(lat, lon, [
      { start: 0, end: 1 },
      { start: 2, end: 3 },
    ]);
    expect(dist[2]).toBeCloseTo(100, 0);
    expect(dist[3]).toBeCloseTo(200, 0);
  });
});

describe('высота', () => {
  it('медиана убирает одиночный выброс', () => {
    const ele = [10, 10, 10, 10, 10, 10, 10, 500, 10, 10, 10, 10, 10, 10, 10];
    expect(medianSmooth(ele)).toEqual(ele.map(() => 10));
  });

  it('набор с порогом 5 м: шум не считается, подъём считается от минимума', () => {
    expect(elevationGain([0, 3, 0, 4, 0, 3])).toBe(0);
    expect(elevationGain([0, 10, 5, 20])).toBe(20);
    expect(elevationGain([0, 10, 2, 12])).toBe(20);
    expect(elevationGain([100, 90, 95, 110])).toBe(20);
  });

  it('ненадёжна ниже −50 м', () => {
    expect(isElevationUnreliable([10, -60], [60, 61], [30, 30])).toBe(true);
    expect(isElevationUnreliable([10, 300], [60, 61], [30, 30])).toBe(false);
  });

  it('ненадёжна, если петля вернулась на другую высоту', () => {
    expect(isElevationUnreliable([10, 70], [60, 60 + 100 * M], [30, 30])).toBe(true);
    expect(isElevationUnreliable([10, 40], [60, 60 + 100 * M], [30, 30])).toBe(false);
  });
});

describe('findStops', () => {
  it('5 минут в круге 30 м — остановка, 4 минуты — нет', () => {
    const walk1 = line(100, 1.2, 1, 0);
    const stop = Array.from({ length: 360 }, (_, i) => ({
      lat: 60 + (120 + (i % 3) * 5) * M,
      lon: 30,
      t: T0 + 100 + i,
    }));
    const walk2 = line(100, 1.2, 1, 200, T0 + 460);
    const shortStop = Array.from({ length: 240 }, (_, i) => ({
      lat: 60 + 330 * M,
      lon: 30,
      t: T0 + 560 + i,
    }));
    const pts = [...walk1, ...stop, ...walk2, ...shortStop];
    const t = pts.map((p) => p.t);
    const stops = findStops(
      pts.map((p) => p.lat),
      pts.map((p) => p.lon),
      t,
      splitDays(t, t.length),
    );
    expect(stops).toHaveLength(1);
    expect(stops[0]!.durationS).toBeGreaterThanOrEqual(359);
  });

  it('ночь остановкой не считается', () => {
    const t = [0, 60, 50_000, 50_060];
    const stops = findStops([60, 60, 60, 60], [30, 30, 30, 30], t, splitDays(t, 4));
    expect(stops).toEqual([]);
  });
});

describe('simplifyIndices', () => {
  it('прямая сжимается до концов, дни сохраняют границы', () => {
    const pts = line(1000);
    const lat = pts.map((p) => p.lat);
    const lon = pts.map((p) => p.lon);
    expect(simplifyIndices(lat, lon, [{ start: 0, end: 999 }])).toEqual([0, 999]);
    expect(
      simplifyIndices(lat, lon, [
        { start: 0, end: 499 },
        { start: 500, end: 999 },
      ]),
    ).toEqual([0, 499, 500, 999]);
  });

  it('потолок числа точек: допуск растёт', () => {
    // Зигзаг ±10 м: при допуске 3 м остались бы все точки.
    const lat = Array.from({ length: 2000 }, (_, i) => 60 + i * 5 * M);
    const lon = lat.map((_, i) => 30 + (i % 2 ? 10 : -10) * M * 2);
    const kept = simplifyIndices(lat, lon, [{ start: 0, end: 1999 }], 3, 500);
    expect(kept.length).toBeLessThanOrEqual(500);
    expect(kept[0]).toBe(0);
    expect(kept.at(-1)).toBe(1999);
  });
});

describe('nearestOnTrack', () => {
  it('проекция на отрезок и позиция по расстоянию', () => {
    const track = { lat: [60, 60 + 100 * M], lon: [30, 30], dist: [0, 100] };
    const near = nearestOnTrack(track, 60 + 40 * M, 30.0005);
    expect(near?.pos).toBeCloseTo(40, 0);
    expect(near?.offset).toBeCloseTo(27.8, 0);
  });
});

describe('processTrack', () => {
  it('короче 100 м — ошибка', () => {
    const err = (() => {
      try {
        processTrack({ segments: [line(50)], waypoints: [] });
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(ImportError);
    expect((err as ImportError).code).toBe('too-short');
  });

  it('без времени — предупреждение, нет остановок и времени', () => {
    const pts = line(300).map(({ lat, lon }) => ({ lat, lon }));
    const r = processTrack({ segments: [pts], waypoints: [] });
    expect(r.warnings).toEqual([WARNINGS.noTime]);
    expect(r.startedAt).toBeNull();
    expect(r.track.t).toBeNull();
    expect(r.stats.movingS).toBeNull();
    expect(r.elevation).toBe('none');
  });

  it('метки притягиваются к треку', () => {
    const r = processTrack({
      segments: [line(300)],
      waypoints: [{ lat: 60 + 150 * M, lon: 30.001, name: 'Родник', desc: '' }],
    });
    expect(r.waypoints).toHaveLength(1);
    expect(r.waypoints[0]!.pos).toBeCloseTo(150, 0);
    expect(r.timezone).toBe('Europe/Moscow');
  });

  it('вырезка из эталона: начало дня 1, конец дня 1 и начало дня 2 — три куска по времени', () => {
    const parsed = parseGpx(readFileSync('test/fixtures/zepp-slice.gpx', 'utf8'));
    const r = processTrack(parsed);
    expect(r.stats.days).toBe(3);
    expect(r.timezone).toBe('Europe/Moscow');
    expect(r.startedAt).toBe(Date.parse('2026-10-17T09:54:21Z') / 1000);
    const { track } = r;
    const len = track.lat.length;
    for (const arr of [track.lon, track.ele, track.t, track.dist]) expect(arr).toHaveLength(len);
    expect(track.t?.[0]).toBe(0);
    expect(splitDays(track.t, len)).toHaveLength(3);
  });
});
