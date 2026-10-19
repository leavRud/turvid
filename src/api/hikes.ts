import type { ProcessedTrack } from '../track/process';
import type { Hike, HikeBundle, HikeListItem, Media, Point, TrackData } from '../types';
import { supabase } from './client';
import { currentUserId } from './auth';
import { signMedia } from './media';

const BUCKET = 'media';

const LIST_COLUMNS =
  'id, user_id, title, started_at, finished_at, timezone, distance_m, moving_s, elev_gain_m, elev_range_m, bbox, created_at, track, media(count)';

interface ListRow extends Omit<HikeListItem, 'photos'> {
  media: { count: number }[] | null;
}

/** Походы текущего пользователя, от новых к старым, с упрощённым треком для мини-карты. */
export async function listHikes(): Promise<HikeListItem[]> {
  const { data, error } = await supabase
    .from('hikes')
    .select(LIST_COLUMNS)
    .order('started_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data as unknown as ListRow[]).map(({ media, ...row }) => ({
    ...row,
    track: row.track as TrackData,
    photos: media?.[0]?.count ?? 0,
  }));
}

export interface NewHike {
  processed: ProcessedTrack;
  title: string;
  file: File;
  /** Добавить метки из файла как точки. */
  withWaypoints: boolean;
}

function extension(name: string): string {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  return /^[a-z0-9]{1,8}$/.test(ext) && ext !== name.toLowerCase() ? ext : 'bin';
}

const iso = (sec: number | null): string | null =>
  sec === null ? null : new Date(sec * 1000).toISOString();

const int = (v: number | null): number | null => (v === null ? null : Math.round(v));

/** Сохраняет поход: исходный файл в Storage, строку в hikes, метки — в points. Возвращает id. */
export async function createHike({
  processed,
  title,
  file,
  withWaypoints,
}: NewHike): Promise<string> {
  const userId = await currentUserId();
  const hikeId = crypto.randomUUID();
  const sourcePath = `${userId}/${hikeId}/${crypto.randomUUID()}.${extension(file.name)}`;

  const upload = await supabase.storage.from(BUCKET).upload(sourcePath, file, {
    contentType: file.type || 'application/octet-stream',
    upsert: false,
  });
  if (upload.error) throw upload.error;

  const { stats } = processed;
  const insert = await supabase.from('hikes').insert({
    id: hikeId,
    user_id: userId,
    title,
    started_at: iso(processed.startedAt),
    finished_at: iso(processed.finishedAt),
    timezone: processed.timezone,
    distance_m: Math.round(stats.distanceM),
    moving_s: int(stats.movingS),
    elev_gain_m: int(stats.elevGainM),
    elev_range_m: int(stats.elevRangeM),
    track: processed.track,
    bbox: processed.bbox,
    source_path: sourcePath,
  });
  if (insert.error) {
    await supabase.storage.from(BUCKET).remove([sourcePath]);
    throw insert.error;
  }

  if (withWaypoints && processed.waypoints.length) {
    const points = processed.waypoints.map((w) => ({
      hike_id: hikeId,
      pos_m: w.pos,
      lat: w.lat,
      lon: w.lon,
      title: w.name.slice(0, 80),
      description: w.desc.slice(0, 5000),
    }));
    const res = await supabase.from('points').insert(points);
    if (res.error) {
      await deleteHike(hikeId);
      throw res.error;
    }
  }
  return hikeId;
}

/** Удаляет поход: все файлы из его папки в Storage, затем строку (точки и медиа — каскадом). */
export async function deleteHike(hikeId: string): Promise<void> {
  const userId = await currentUserId();
  const folder = `${userId}/${hikeId}`;
  const storage = supabase.storage.from(BUCKET);
  for (;;) {
    const { data, error } = await storage.list(folder, { limit: 1000 });
    if (error) throw error;
    if (!data.length) break;
    const removed = await storage.remove(data.map((f) => `${folder}/${f.name}`));
    if (removed.error) throw removed.error;
    if (data.length < 1000) break;
  }
  const { error } = await supabase.from('hikes').delete().eq('id', hikeId);
  if (error) throw error;
}

/** Поход с точками и числом фото для экрана просмотра. null — нет такого (или чужой). */
export async function getHike(hikeId: string): Promise<HikeBundle | null> {
  const { data, error } = await supabase
    .from('hikes')
    .select('*, points(*), media(*)')
    .eq('id', hikeId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const { points, media, ...hike } = data as unknown as Hike & {
    points: Point[] | null;
    media: Media[] | null;
  };
  return {
    hike,
    points: [...(points ?? [])].sort((a, b) => a.pos_m - b.pos_m),
    media: await signMedia(media ?? []),
  };
}

export async function renameHike(hikeId: string, title: string): Promise<void> {
  const { error } = await supabase.from('hikes').update({ title }).eq('id', hikeId);
  if (error) throw error;
}

/** Включить (token) или выключить (null) публичную ссылку. */
export async function setShareToken(hikeId: string, token: string | null): Promise<void> {
  const { error } = await supabase.from('hikes').update({ share_token: token }).eq('id', hikeId);
  if (error) throw error;
}

/** Ссылка на скачивание исходного файла трека (живёт минуту). */
export async function sourceDownloadUrl(path: string, fileName: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, 60, { download: fileName });
  if (error) throw error;
  return data.signedUrl;
}
