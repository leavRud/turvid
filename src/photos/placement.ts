// Автораскладка фото по маршруту (раздел 6 ТЗ). Чистые функции: без DOM и сети.

import { posAtTime } from '../player/position';
import { nearestOnTrack } from '../track/nearest';
import type { TrackData } from '../types';

/** Дальше этого от трека — пометка «далеко от маршрута» (но фото всё равно ставится), м. */
export const FAR_FROM_TRACK_M = 200;
/** Снято раньше старта или позже финиша больше чем на столько — в неразобранные, с. */
export const OUTSIDE_HIKE_S = 30 * 60;
/** Фото ближе этого друг к другу по треку собираются в одну точку, м. */
export const GROUP_M = 150;
/** Есть точка ближе этого — фото добавляются в неё, а не в новую, м. */
export const ATTACH_M = 100;

export interface PlaceInput {
  id: string;
  /** Секунды Unix. */
  takenAt: number | null;
  lat: number | null;
  lon: number | null;
}

export interface Placement {
  id: string;
  /** Позиция на треке, м; null — в неразобранные. */
  pos: number | null;
  /** Чем поставлено: координатами или временем. */
  by: 'coords' | 'time' | null;
  /** Координаты дальше 200 м от трека. */
  far: boolean;
  /** Время есть, но снято вне похода больше чем на 30 минут. */
  outside: boolean;
}

/**
 * Координаты уточняют место по времени только в пределах столько секунд пути в обе стороны:
 * время съёмки точное, а GPS в фото бывает старым или грубым («приблизительное
 * местоположение» Android — клетка в пару километров), и тогда ближайшее к нему место трека —
 * совсем другой участок маршрута.
 */
export const COORDS_WINDOW_S = 10 * 60;

/**
 * Куда встаёт одно фото (раздел 6 ТЗ, правило изменено 2026-10-22):
 * 1) есть время и у трека есть время — где был в этот момент; если есть и координаты ближе
 *    200 м к треку в пределах ±10 минут пути — уточняем по ним;
 *    вне похода больше чем на 30 минут — по координатам, если они у самого трека, иначе
 *    в неразобранные;
 * 2) времени нет, есть координаты — ближайшее место трека (дальше 200 м — с пометкой);
 * 3) ни того ни другого — в неразобранные.
 */
export function placeOne(input: PlaceInput, track: TrackData, startedAt: number | null): Placement {
  const base = { id: input.id, far: false, outside: false };
  const hasCoords = input.lat !== null && input.lon !== null;
  const nearIn = (range?: { from: number; to: number }) =>
    hasCoords ? nearestOnTrack(track, input.lat as number, input.lon as number, range) : null;

  if (input.takenAt !== null && startedAt !== null && track.t && track.t.length) {
    const t = input.takenAt - startedAt;
    const endT = track.t[track.t.length - 1] as number;
    if (t < -OUTSIDE_HIKE_S || t > endT + OUTSIDE_HIKE_S) {
      // Снято не во время похода, но у самого трека (например, у старта до включения часов).
      const near = nearIn();
      if (near && near.offset <= FAR_FROM_TRACK_M) return { ...base, pos: near.pos, by: 'coords' };
      return { ...base, pos: null, by: null, outside: true };
    }
    const at = Math.min(Math.max(t, 0), endT);
    const near = nearIn({
      from: posAtTime(track, Math.max(at - COORDS_WINDOW_S, 0)),
      to: posAtTime(track, Math.min(at + COORDS_WINDOW_S, endT)),
    });
    if (near && near.offset <= FAR_FROM_TRACK_M) return { ...base, pos: near.pos, by: 'coords' };
    return { ...base, pos: posAtTime(track, at), by: 'time' };
  }

  const near = nearIn();
  if (near) return { ...base, pos: near.pos, by: 'coords', far: near.offset > FAR_FROM_TRACK_M };
  return { ...base, pos: null, by: null };
}

export interface ExistingPoint {
  id: string;
  pos: number;
}

export interface Group {
  /** Существующая точка, куда добавятся фото; null — новая точка. */
  pointId: string | null;
  /** Где встанет новая точка (у существующей — её позиция), м. */
  pos: number;
  ids: string[];
}

export interface Layout {
  groups: Group[];
  unsorted: string[];
}

/**
 * Собирает разложенные фото в точки: соседи ближе 150 м по треку — одна точка
 * (цепочкой, по порядку вдоль трека). Если в пределах 100 м от кучки уже есть точка —
 * фото идут в неё. Новая точка встаёт посередине кучки (медиана).
 */
export function groupPlacements(placements: Placement[], existing: ExistingPoint[]): Layout {
  const unsorted = placements.filter((p) => p.pos === null).map((p) => p.id);
  const placed = placements
    .filter((p): p is Placement & { pos: number } => p.pos !== null)
    .sort((a, b) => a.pos - b.pos);

  const clusters: (Placement & { pos: number })[][] = [];
  for (const p of placed) {
    const last = clusters[clusters.length - 1];
    const prev = last?.[last.length - 1];
    if (last && prev && p.pos - prev.pos <= GROUP_M) last.push(p);
    else clusters.push([p]);
  }

  const byPoint = new Map<string, Group>();
  const groups: Group[] = [];
  for (const cluster of clusters) {
    const first = (cluster[0] as { pos: number }).pos;
    const last = (cluster[cluster.length - 1] as { pos: number }).pos;
    const median = (cluster[Math.floor(cluster.length / 2)] as { pos: number }).pos;
    // Ближайшая существующая точка в пределах 100 м от краёв кучки.
    let attach: ExistingPoint | null = null;
    let best = Infinity;
    for (const e of existing) {
      const d = e.pos < first ? first - e.pos : e.pos > last ? e.pos - last : 0;
      if (d <= ATTACH_M && Math.abs(e.pos - median) < best) {
        attach = e;
        best = Math.abs(e.pos - median);
      }
    }
    const ids = cluster.map((p) => p.id);
    if (attach) {
      const g = byPoint.get(attach.id);
      if (g) g.ids.push(...ids);
      else {
        const ng = { pointId: attach.id, pos: attach.pos, ids };
        byPoint.set(attach.id, ng);
        groups.push(ng);
      }
    } else {
      groups.push({ pointId: null, pos: median, ids });
    }
  }
  groups.sort((a, b) => a.pos - b.pos);
  return { groups, unsorted };
}

/** Раскладка целиком: каждое фото → позиция → точки. */
export function layoutMedia(
  inputs: PlaceInput[],
  track: TrackData,
  startedAt: number | null,
  existing: ExistingPoint[],
): { placements: Placement[]; layout: Layout } {
  const placements = inputs.map((i) => placeOne(i, track, startedAt));
  return { placements, layout: groupPlacements(placements, existing) };
}
