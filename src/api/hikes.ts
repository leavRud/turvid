import type { HikeSummary } from '../types';
import { supabase } from './client';

const SUMMARY_COLUMNS =
  'id, user_id, title, started_at, finished_at, timezone, distance_m, moving_s, elev_gain_m, elev_range_m, bbox, created_at';

/** Походы текущего пользователя, от новых к старым. */
export async function listHikes(): Promise<HikeSummary[]> {
  const { data, error } = await supabase
    .from('hikes')
    .select(SUMMARY_COLUMNS)
    .order('started_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data as HikeSummary[];
}
