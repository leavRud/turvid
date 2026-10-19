import { describe, expect, it } from 'vitest';
import { computeStats, yearMonth, type StatsHike } from '../src/stats/stats';

const sec = (iso: string): number => Date.parse(iso) / 1000;

/** Поход из дней: каждый день — [начало в секундах от старта, длительность, км]. */
function hike(
  id: string,
  startedAt: string | null,
  days: [number, number, number][],
  extra: Partial<StatsHike> = {},
): StatsHike {
  const t: number[] = [];
  const dist: number[] = [];
  let total = 0;
  for (const [start, dur, km] of days) {
    // Точки каждые полчаса: иначе разрыв больше 3 часов сам разрежет день.
    const steps = Math.max(1, Math.ceil(dur / 1800));
    for (let i = 0; i <= steps; i++) {
      t.push(start + (dur * i) / steps);
      dist.push(total + (km * 1000 * i) / steps);
    }
    total += km * 1000;
  }
  return {
    id,
    title: id,
    started_at: startedAt,
    timezone: 'Europe/Moscow',
    distance_m: total,
    elev_range_m: null,
    photos: 0,
    created_at: '2026-01-01T00:00:00Z',
    track: {
      lat: t.map(() => 60),
      lon: t.map(() => 30),
      ele: null,
      t: startedAt ? t : null,
      dist,
    },
    ...extra,
  };
}

describe('yearMonth', () => {
  it('в поясе похода: 31 декабря 22:30 UTC — уже январь по Москве', () => {
    expect(yearMonth(sec('2026-12-31T22:30:00Z'), 'Europe/Moscow')).toEqual([2027, 0]);
    expect(yearMonth(sec('2026-12-31T20:00:00Z'), 'Europe/Moscow')).toEqual([2026, 11]);
  });
});

describe('computeStats', () => {
  const twoDays = hike(
    'карелия',
    '2026-10-17T09:54:21Z',
    [
      [0, 6 * 3600, 12.6],
      [20 * 3600, 7 * 3600, 18.9],
    ],
    { photos: 20, elev_range_m: 120 },
  );
  const oneDay = hike('кольцо', '2026-07-05T06:00:00Z', [[0, 5 * 3600, 21]], {
    photos: 5,
    elev_range_m: 300,
  });
  const noTime = hike('без времени', null, [[0, 0, 4]]);

  it('итоги: походы, км, дни, ночёвки, фото', () => {
    const s = computeStats([twoDays, oneDay, noTime]);
    expect(s.totals).toEqual({
      hikes: 3,
      distanceM: 31_500 + 21_000 + 4_000,
      days: 4,
      nights: 1,
      photos: 25,
    });
  });

  it('км по месяцам: дни раскладываются по своим месяцам', () => {
    const crossMonth = hike('переход', '2026-08-31T15:00:00Z', [
      [0, 3600, 10],
      [24 * 3600, 3600, 15],
    ]);
    const s = computeStats([twoDays, oneDay, crossMonth, noTime]);
    expect(s.years).toEqual([2026]);
    const row = s.monthly.get(2026) as number[];
    expect(row[9]).toBeCloseTo(31_500); // октябрь
    expect(row[6]).toBeCloseTo(21_000); // июль
    expect(row[7]).toBeCloseTo(10_000); // август — первый день перехода
    expect(row[8]).toBeCloseTo(15_000); // сентябрь — второй
    expect(row[0]).toBeCloseTo(4_000); // без времени — по дате создания
  });

  it('рекорды: самый длинный поход, день и перепад', () => {
    const s = computeStats([twoDays, oneDay, noTime]);
    expect(s.records.longestHike).toEqual({ id: 'карелия', title: 'карелия', distanceM: 31_500 });
    expect(s.records.longestDay).toEqual({
      id: 'кольцо',
      title: 'кольцо',
      day: 1,
      distanceM: 21_000,
    });
    expect(s.records.biggestRange).toEqual({ id: 'кольцо', title: 'кольцо', rangeM: 300 });
  });

  it('пусто — нули и нет рекордов', () => {
    const s = computeStats([]);
    expect(s.totals.hikes).toBe(0);
    expect(s.years).toEqual([]);
    expect(s.records).toEqual({ longestHike: null, longestDay: null, biggestRange: null });
  });
});
