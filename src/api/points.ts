// Точки на треке: место, название, описание.

import type { Point } from '../types';
import { supabase } from './client';

export const POINT_TITLE_MAX = 80;
export const POINT_DESCRIPTION_MAX = 5000;

export interface PointPlace {
  pos_m: number;
  lat: number;
  lon: number;
}

export async function createPoint(
  hikeId: string,
  place: PointPlace,
  title = '',
  description = '',
): Promise<Point> {
  const { data, error } = await supabase
    .from('points')
    .insert({
      hike_id: hikeId,
      ...place,
      title: title.slice(0, POINT_TITLE_MAX),
      description: description.slice(0, POINT_DESCRIPTION_MAX),
    })
    .select()
    .single();
  if (error) throw error;
  return data as Point;
}

export async function updatePoint(
  id: string,
  fields: Partial<Pick<Point, 'title' | 'description' | 'pos_m' | 'lat' | 'lon'>>,
): Promise<Point> {
  const patch = { ...fields };
  if (patch.title !== undefined) patch.title = patch.title.slice(0, POINT_TITLE_MAX);
  if (patch.description !== undefined) {
    patch.description = patch.description.slice(0, POINT_DESCRIPTION_MAX);
  }
  const { data, error } = await supabase
    .from('points')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data as Point;
}

/** Удаляет точку; её фото становятся неразобранными (point_id → null в базе). */
export async function deletePoint(id: string): Promise<void> {
  const { error } = await supabase.from('points').delete().eq('id', id);
  if (error) throw error;
}
