// Полная обработка трека (раздел 4 ТЗ): от разобранного файла до упрощённого трека и статистики.

import tzlookup from 'tz-lookup';
import { mergeSegments } from '../parse';
import { ImportError, type ParsedFile, type RawPoint } from '../parse/types';
import type { TrackData } from '../types';
import { cleanPoints } from './clean';
import { splitDays, type DayRange } from './days';
import { cumulativeDistance } from './distance';
import { elevationGain, isElevationUnreliable, medianSmooth } from './elevation';
import { nearestOnTrack } from './nearest';
import { simplifyIndices } from './simplify';
import { findStops } from './stops';

export const MIN_TRACK_M = 100;

export const WARNINGS = {
  noTime: 'Нет времени — часть функций отключена',
  badElevation: 'Высота ненадёжна',
} as const;

export type ElevationState = 'none' | 'reliable' | 'unreliable';

export interface TrackStats {
  distanceM: number;
  /** От первой до последней точки, с. */
  durationS: number | null;
  /** Время в движении: дни без остановок, с. */
  movingS: number | null;
  /** Средняя скорость в движении, км/ч. */
  movingSpeedKmh: number | null;
  days: number;
  stops: number;
  elevGainM: number | null;
  elevRangeM: number | null;
}

export interface PlacedWaypoint {
  name: string;
  desc: string;
  /** Место на треке, куда притянута метка. */
  lat: number;
  lon: number;
  pos: number;
  /** Насколько метка была от трека, м. */
  offset: number;
}

export interface ProcessedTrack {
  track: TrackData;
  /** Секунды Unix; null — трек без времени. */
  startedAt: number | null;
  finishedAt: number | null;
  timezone: string;
  bbox: [number, number, number, number];
  stats: TrackStats;
  elevation: ElevationState;
  warnings: string[];
  waypoints: PlacedWaypoint[];
  rawPoints: number;
}

const round = (v: number, digits: number): number => {
  const k = 10 ** digits;
  return Math.round(v * k) / k;
};

function timezoneAt(lat: number, lon: number): string {
  try {
    return tzlookup(lat, lon);
  } catch {
    return 'UTC';
  }
}

function sumDays(days: DayRange[], t: number[]): number {
  return days.reduce((s, d) => s + ((t[d.end] as number) - (t[d.start] as number)), 0);
}

export function processTrack(parsed: ParsedFile): ProcessedTrack {
  const merged = mergeSegments(parsed.segments);
  const hasTime = merged.length > 0 && merged.every((p) => p.t !== undefined);
  const points: RawPoint[] = cleanPoints(merged, hasTime);
  const n = points.length;
  if (n < 2) throw new ImportError('too-short');

  const lat = points.map((p) => p.lat);
  const lon = points.map((p) => p.lon);
  const t = hasTime ? points.map((p) => p.t as number) : null;
  const rawEle = points.every((p) => p.ele !== undefined)
    ? points.map((p) => p.ele as number)
    : null;

  const days = splitDays(t, n);
  const dist = cumulativeDistance(lat, lon, days);
  const distanceM = dist[n - 1] as number;
  if (distanceM < MIN_TRACK_M) throw new ImportError('too-short');

  // Высота
  const ele = rawEle ? medianSmooth(rawEle) : null;
  let elevation: ElevationState = 'none';
  let elevGainM: number | null = null;
  let elevRangeM: number | null = null;
  if (ele) {
    if (isElevationUnreliable(ele, lat, lon)) {
      elevation = 'unreliable';
    } else {
      elevation = 'reliable';
      elevGainM = elevationGain(ele);
      let min = Infinity;
      let max = -Infinity;
      for (const e of ele) {
        if (e < min) min = e;
        if (e > max) max = e;
      }
      elevRangeM = max - min;
    }
  }

  // Время, остановки
  const stops = t ? findStops(lat, lon, t, days) : [];
  const durationS = t ? (t[n - 1] as number) - (t[0] as number) : null;
  const movingS = t ? sumDays(days, t) - stops.reduce((s, x) => s + x.durationS, 0) : null;
  const movingSpeedKmh = movingS ? distanceM / 1000 / (movingS / 3600) : null;

  // Упрощение
  // Границы остановок сохраняются, чтобы по упрощённому треку остановки находились так же.
  const stopEdges = stops.flatMap((s) => [s.start, s.end]);
  const keep = simplifyIndices(lat, lon, days, undefined, undefined, stopEdges);
  const t0 = t ? (t[0] as number) : 0;
  const track: TrackData = {
    lon: keep.map((i) => round(lon[i] as number, 6)),
    lat: keep.map((i) => round(lat[i] as number, 6)),
    ele: ele ? keep.map((i) => round(ele[i] as number, 1)) : null,
    t: t ? keep.map((i) => Math.round((t[i] as number) - t0)) : null,
    dist: keep.map((i) => round(dist[i] as number, 1)),
  };

  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (let i = 0; i < n; i++) {
    const la = lat[i] as number;
    const lo = lon[i] as number;
    if (lo < minLon) minLon = lo;
    if (lo > maxLon) maxLon = lo;
    if (la < minLat) minLat = la;
    if (la > maxLat) maxLat = la;
  }

  const waypoints: PlacedWaypoint[] = [];
  for (const w of parsed.waypoints) {
    const near = nearestOnTrack(track, w.lat, w.lon);
    if (near) {
      waypoints.push({
        name: w.name,
        desc: w.desc,
        lat: near.lat,
        lon: near.lon,
        pos: near.pos,
        offset: near.offset,
      });
    }
  }
  waypoints.sort((a, b) => a.pos - b.pos);

  const warnings: string[] = [];
  if (!hasTime) warnings.push(WARNINGS.noTime);
  if (elevation === 'unreliable') warnings.push(WARNINGS.badElevation);

  return {
    track,
    startedAt: t ? t0 : null,
    finishedAt: t ? (t[n - 1] as number) : null,
    timezone: timezoneAt(lat[0] as number, lon[0] as number),
    bbox: [minLon, minLat, maxLon, maxLat],
    stats: {
      distanceM,
      durationS,
      movingS,
      movingSpeedKmh,
      days: days.length,
      stops: stops.length,
      elevGainM,
      elevRangeM,
    },
    elevation,
    warnings,
    waypoints,
    rawPoints: merged.length,
  };
}
