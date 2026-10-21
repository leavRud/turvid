/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseGpx } from '../src/parse/gpx';
import {
  ATTACH_M,
  FAR_FROM_TRACK_M,
  groupPlacements,
  layoutMedia,
  OUTSIDE_HIKE_S,
  placeOne,
  type Placement,
} from '../src/photos/placement';
import { pointAt, posAtTime, timeAt } from '../src/player/position';
import { processTrack } from '../src/track/process';
import type { TrackData } from '../src/types';

const M = 1 / 111_195;
const START = Date.parse('2026-10-17T09:00:00Z') / 1000;

/** 10 км на север за 10 000 с (1 м/с). */
function line(): TrackData {
  const n = 101;
  return {
    lat: Array.from({ length: n }, (_, i) => 60 + i * 100 * M),
    lon: Array.from({ length: n }, () => 30),
    ele: null,
    t: Array.from({ length: n }, (_, i) => i * 100),
    dist: Array.from({ length: n }, (_, i) => i * 100),
  };
}

describe('placeOne', () => {
  const track = line();

  it('по координатам — ближайшее место трека', () => {
    const p = placeOne({ id: 'a', takenAt: null, lat: 60 + 2500 * M, lon: 30.0005 }, track, START);
    expect(p.by).toBe('coords');
    expect(p.pos).toBeCloseTo(2500, 0);
    expect(p.far).toBe(false);
  });

  it('дальше 200 м от трека — пометка, но всё равно на треке', () => {
    const lon = 30 + (FAR_FROM_TRACK_M + 50) * M * 2; // ~250 м к востоку на 60° широты
    const p = placeOne({ id: 'a', takenAt: null, lat: 60 + 1000 * M, lon }, track, START);
    expect(p.far).toBe(true);
    expect(p.pos).toBeCloseTo(1000, 0);
  });

  it('время главнее: координаты с другого участка маршрута не перетягивают фото', () => {
    // Снято на 100-й секунде, а GPS в фото — у 7-го километра (старый или чужой фикс).
    const p = placeOne(
      { id: 'a', takenAt: START + 100, lat: 60 + 7000 * M, lon: 30 },
      track,
      START,
    );
    expect(p.by).toBe('time');
    expect(p.pos).toBeCloseTo(100, 0);
  });

  it('координаты рядом по времени и у самого трека — уточняют место', () => {
    // В 4000 с был на 4000 м (1 м/с); координаты — 4300 м: это 300 с пути, меньше COORDS_WINDOW_S.
    const p = placeOne(
      { id: 'a', takenAt: START + 4000, lat: 60 + 4300 * M, lon: 30.0005 },
      track,
      START,
    );
    expect(p.by).toBe('coords');
    expect(p.pos).toBeCloseTo(4300, 0);
  });

  it('грубые координаты (клетка «приблизительного местоположения») — по времени', () => {
    // Координаты в нужном месте по треку, но в 1,5 км в стороне от него.
    const lon = 30 + 1500 * M * 2;
    const p = placeOne({ id: 'a', takenAt: START + 4000, lat: 60 + 4000 * M, lon }, track, START);
    expect(p.by).toBe('time');
    expect(p.pos).toBeCloseTo(4000, 0);
    expect(p.far).toBe(false);
  });

  it('вне похода: у самого трека — по координатам, далеко — в неразобранные', () => {
    const early = START - OUTSIDE_HIKE_S - 600;
    expect(placeOne({ id: 'a', takenAt: early, lat: 60, lon: 30 }, track, START)).toMatchObject({
      pos: 0,
      by: 'coords',
    });
    expect(placeOne({ id: 'a', takenAt: early, lat: 59.9, lon: 30 }, track, START)).toMatchObject({
      pos: null,
      outside: true,
    });
  });

  it('без координат — где был в этот момент', () => {
    const p = placeOne({ id: 'a', takenAt: START + 4321, lat: null, lon: null }, track, START);
    expect(p.by).toBe('time');
    expect(p.pos).toBeCloseTo(4321, 0);
  });

  it('до старта и после финиша — в пределах 30 минут к краям, дальше — неразобранные', () => {
    expect(
      placeOne({ id: 'a', takenAt: START - 600, lat: null, lon: null }, track, START).pos,
    ).toBe(0);
    expect(
      placeOne({ id: 'a', takenAt: START + 10_000 + 600, lat: null, lon: null }, track, START).pos,
    ).toBe(10_000);
    const late = placeOne(
      { id: 'a', takenAt: START + 10_000 + OUTSIDE_HIKE_S + 1, lat: null, lon: null },
      track,
      START,
    );
    expect(late).toMatchObject({ pos: null, outside: true });
  });

  it('ни времени, ни координат, или трек без времени — неразобранные', () => {
    expect(placeOne({ id: 'a', takenAt: null, lat: null, lon: null }, track, START).pos).toBeNull();
    expect(
      placeOne({ id: 'a', takenAt: START, lat: null, lon: null }, { ...track, t: null }, null).pos,
    ).toBeNull();
  });
});

describe('groupPlacements', () => {
  const at = (id: string, pos: number | null): Placement => ({
    id,
    pos,
    by: pos === null ? null : 'time',
    far: false,
    outside: false,
  });

  it('соседи ближе 150 м — одна новая точка посередине', () => {
    const { groups, unsorted } = groupPlacements(
      [at('a', 1000), at('b', 1100), at('c', 1240), at('d', 3000), at('e', null)],
      [],
    );
    expect(groups).toEqual([
      { pointId: null, pos: 1100, ids: ['a', 'b', 'c'] },
      { pointId: null, pos: 3000, ids: ['d'] },
    ]);
    expect(unsorted).toEqual(['e']);
  });

  it('точка ближе 100 м — фото в неё; две кучки у одной точки — в одну группу', () => {
    const { groups } = groupPlacements(
      [at('a', 1000), at('b', 1400), at('c', 5000)],
      [
        { id: 'p1', pos: 1000 + ATTACH_M },
        { id: 'p2', pos: 5000 + ATTACH_M + 1 },
      ],
    );
    expect(groups[0]).toEqual({ pointId: 'p1', pos: 1100, ids: ['a'] });
    // b (1400) дальше 100 м от p1 (1100) — новая точка; c — новая, p2 дальше 100 м.
    expect(groups.map((g) => g.pointId)).toEqual(['p1', null, null]);
  });
});

describe('раскладка на эталонном треке Zepp', () => {
  it('фото с 12 мест встают на маршрут, править руками нужно не больше каждого десятого', () => {
    const r = processTrack(parseGpx(readFileSync('test/fixtures/zepp-2days.gpx', 'utf8')));
    const track = r.track;
    const startedAt = r.startedAt as number;

    // 12 мест вдоль двух дней, на каждом 3–5 фото в пределах пары минут.
    // 70% фото с координатами (шум GPS 15 м), 25% — только время, 5% — без всего.
    let seed = 42;
    const rnd = (): number => (seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31;
    const length = track.dist.at(-1) as number;
    const sites = Array.from({ length: 12 }, (_, i) => {
      // Равномерно по расстоянию (каждые ~2,6 км), время — когда там был.
      const pos = ((i + 0.5) / 12) * length;
      return { t: timeAt(track, pos) as number, pos };
    });
    const inputs: {
      id: string;
      site: number;
      takenAt: number | null;
      lat: number | null;
      lon: number | null;
    }[] = [];
    sites.forEach((s, si) => {
      const count = 3 + Math.floor(rnd() * 3);
      for (let k = 0; k < count; k++) {
        const t = s.t + rnd() * 120;
        const p = pointAt(track, posAtTime(track, t));
        const kind = rnd();
        const id = `s${si}-${k}`;
        if (kind < 0.7) {
          inputs.push({
            id,
            site: si,
            takenAt: startedAt + t,
            lat: p.lat + (rnd() - 0.5) * 30 * M,
            lon: p.lon + (rnd() - 0.5) * 60 * M,
          });
        } else if (kind < 0.95) {
          inputs.push({ id, site: si, takenAt: startedAt + t, lat: null, lon: null });
        } else {
          inputs.push({ id, site: si, takenAt: null, lat: null, lon: null });
        }
      }
    });

    const { layout } = layoutMedia(inputs, track, startedAt, []);
    // Для каждого места — группа, где больше всего его фото. Всё остальное — ручная правка.
    const groupOf = new Map<string, number>();
    layout.groups.forEach((g, gi) => g.ids.forEach((id) => groupOf.set(id, gi)));
    let manual = 0;
    sites.forEach((_, si) => {
      const mine = inputs.filter((x) => x.site === si);
      const counts = new Map<number, number>();
      for (const x of mine) {
        const g = groupOf.get(x.id);
        if (g !== undefined) counts.set(g, (counts.get(g) ?? 0) + 1);
      }
      const best = Math.max(0, ...counts.values());
      manual += mine.length - best;
    });
    expect(layout.groups.length).toBeGreaterThanOrEqual(10);
    expect(manual / inputs.length).toBeLessThanOrEqual(0.1);
  });
});
