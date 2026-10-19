import { describe, expect, it } from 'vitest';
import { summarizeDays } from '../src/track/days';
import { formatDateRange, formatDuration, formatKm, formatTime, plural } from '../src/ui/format';
import { trackPaths } from '../src/ui/track-svg';

const sec = (iso: string): number => Date.parse(iso) / 1000;
const MSK = 'Europe/Moscow';

describe('format', () => {
  it('километры и метры', () => {
    expect(formatKm(31452)).toBe('31,5 км');
    expect(formatKm(850)).toBe('850 м');
  });

  it('длительность', () => {
    expect(formatDuration(45 * 60)).toBe('45 мин');
    expect(formatDuration(5 * 3600 + 12 * 60)).toBe('5 ч 12 мин');
    expect(formatDuration(2 * 3600)).toBe('2 ч');
  });

  it('диапазон дат в поясе похода', () => {
    expect(formatDateRange(sec('2026-10-17T09:54:21Z'), sec('2026-10-18T14:11:11Z'), MSK)).toBe(
      '17–18 октября 2026',
    );
    expect(formatDateRange(sec('2026-10-17T09:00:00Z'), sec('2026-10-17T15:00:00Z'), MSK)).toBe(
      '17 октября 2026',
    );
    expect(formatDateRange(sec('2026-09-30T09:00:00Z'), sec('2026-10-02T09:00:00Z'), MSK)).toBe(
      '30 сентября – 2 октября 2026',
    );
    // 22:30 UTC 17-го — уже 18-е по Москве.
    expect(formatDateRange(sec('2026-10-17T22:30:00Z'), sec('2026-10-17T23:00:00Z'), MSK)).toBe(
      '18 октября 2026',
    );
  });

  it('время суток в поясе похода', () => {
    expect(formatTime(sec('2026-10-17T09:54:21Z'), MSK)).toBe('12:54');
  });

  it('склонение', () => {
    const days: [string, string, string] = ['день', 'дня', 'дней'];
    expect([1, 2, 5, 11, 21, 22, 112].map((n) => plural(n, days))).toEqual([
      'день',
      'дня',
      'дней',
      'дней',
      'день',
      'дня',
      'дней',
    ]);
  });
});

describe('summarizeDays', () => {
  it('расстояние и время по дням', () => {
    const days = summarizeDays({ t: [0, 100, 20_000, 20_100], dist: [0, 500, 500, 900] });
    expect(days).toEqual([
      { start: 0, end: 1, startT: 0, endT: 100, distanceM: 500 },
      { start: 2, end: 3, startT: 20_000, endT: 20_100, distanceM: 400 },
    ]);
  });
});

describe('trackPaths', () => {
  it('вписывает трек в рамку и рвёт путь на ночном разрыве', () => {
    const paths = trackPaths(
      { lat: [60, 60.01, 60.02, 60.03], lon: [30, 30, 30, 30], t: [0, 10, 20_000, 20_010] },
      100,
      100,
      0,
    );
    expect(paths).toEqual(['M50 100L50 66.7', 'M50 33.3L50 0']);
  });

  it('прореживает точки, но сохраняет последнюю', () => {
    const lat = Array.from({ length: 10 }, (_, i) => 60 + i * 0.001);
    const [d] = trackPaths({ lat, lon: lat.map(() => 30), t: null }, 100, 100, 0, 4);
    expect(d?.match(/[ML]/g)).toHaveLength(4); // точки 0, 3, 6, 9
    expect(d?.endsWith('L50 0')).toBe(true);
  });
});
