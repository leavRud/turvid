// Статистика за всё время (раздел 7 ТЗ). Чистые функции: без DOM и сети.

import { summarizeDays } from '../track/days';
import type { HikeListItem } from '../types';

export type StatsHike = Pick<
  HikeListItem,
  | 'id'
  | 'title'
  | 'started_at'
  | 'timezone'
  | 'distance_m'
  | 'elev_range_m'
  | 'track'
  | 'photos'
  | 'created_at'
>;

export interface Totals {
  hikes: number;
  distanceM: number;
  days: number;
  /** Ночёвки: ночи между днями одного похода. */
  nights: number;
  photos: number;
}

export interface Records {
  longestHike: { id: string; title: string; distanceM: number } | null;
  /** Самый длинный день: поход, номер дня (с 1), расстояние за день. */
  longestDay: { id: string; title: string; day: number; distanceM: number } | null;
  biggestRange: { id: string; title: string; rangeM: number } | null;
}

export interface Stats {
  totals: Totals;
  /** Годы, за которые есть походы, — от новых к старым. */
  years: number[];
  /** Километры (в метрах) по месяцам: год → 12 чисел, январь первым. */
  monthly: Map<number, number[]>;
  records: Records;
}

/** Год и месяц (0–11) момента в поясе похода. */
export function yearMonth(sec: number, timeZone: string): [number, number] {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(new Date(sec * 1000));
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return [get('year'), get('month') - 1];
}

export function computeStats(hikes: StatsHike[]): Stats {
  const totals: Totals = { hikes: hikes.length, distanceM: 0, days: 0, nights: 0, photos: 0 };
  const monthly = new Map<number, number[]>();
  const records: Records = { longestHike: null, longestDay: null, biggestRange: null };

  const addMonth = (year: number, month: number, meters: number): void => {
    const row = monthly.get(year) ?? new Array<number>(12).fill(0);
    row[month] = (row[month] ?? 0) + meters;
    monthly.set(year, row);
  };

  for (const hike of hikes) {
    const days = summarizeDays(hike.track);
    totals.distanceM += hike.distance_m;
    totals.days += days.length;
    totals.nights += Math.max(days.length - 1, 0);
    totals.photos += hike.photos;

    // Километры — по месяцам дней (поход может перейти через границу месяца).
    const start = hike.started_at ? Date.parse(hike.started_at) / 1000 : null;
    if (start !== null) {
      for (const d of days) {
        const [y, m] = yearMonth(start + (d.startT ?? 0), hike.timezone);
        addMonth(y, m, d.distanceM);
      }
    } else {
      const [y, m] = yearMonth(Date.parse(hike.created_at) / 1000, hike.timezone);
      addMonth(y, m, hike.distance_m);
    }

    if (!records.longestHike || hike.distance_m > records.longestHike.distanceM) {
      records.longestHike = { id: hike.id, title: hike.title, distanceM: hike.distance_m };
    }
    days.forEach((d, i) => {
      if (!records.longestDay || d.distanceM > records.longestDay.distanceM) {
        records.longestDay = { id: hike.id, title: hike.title, day: i + 1, distanceM: d.distanceM };
      }
    });
    if (
      hike.elev_range_m !== null &&
      (!records.biggestRange || hike.elev_range_m > records.biggestRange.rangeM)
    ) {
      records.biggestRange = { id: hike.id, title: hike.title, rangeM: hike.elev_range_m };
    }
  }

  const years = [...monthly.keys()].sort((a, b) => b - a);
  return { totals, years, monthly, records };
}
