// Фото и видео похода: файлы в Storage, строки в таблице media.

import type { Media, MediaItem } from '../types';
import { currentUserId } from './auth';
import { supabase } from './client';

const BUCKET = 'media';
/** Сколько живут подписанные ссылки на файлы, с. */
const SIGNED_URL_TTL_S = 3600;

/** Подписанные ссылки на файл и превью для каждого медиа (одним запросом). */
export async function signMedia(rows: Media[]): Promise<MediaItem[]> {
  if (!rows.length) return [];
  const paths = rows.flatMap((m) => [m.path, m.thumb_path]);
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrls(paths, SIGNED_URL_TTL_S);
  if (error) throw error;
  const urls = new Map(data.map((d) => [d.path, d.signedUrl]));
  return rows
    .map((m) => ({ ...m, url: urls.get(m.path) ?? '', thumbUrl: urls.get(m.thumb_path) ?? '' }))
    .sort((a, b) => a.sort - b.sort);
}

/** Готовый к загрузке файл: сжатое фото или видео как есть, плюс превью. */
export interface PreparedMedia {
  kind: 'photo' | 'video';
  file: Blob;
  ext: string;
  thumb: Blob;
  width: number;
  height: number;
  durationS: number | null;
  /** Секунды Unix. */
  takenAt: number | null;
  lat: number | null;
  lon: number | null;
}

function extFor(blob: Blob, fallback: string): string {
  if (blob.type === 'image/webp') return 'webp';
  if (blob.type === 'image/jpeg') return 'jpg';
  return fallback;
}

/** Загружает файл и превью в Storage и добавляет строку в media. */
export async function uploadMedia(
  hikeId: string,
  pointId: string | null,
  sort: number,
  m: PreparedMedia,
): Promise<MediaItem> {
  const userId = await currentUserId();
  const id = crypto.randomUUID();
  const folder = `${userId}/${hikeId}`;
  const path = `${folder}/${id}.${m.ext}`;
  const thumbPath = `${folder}/${id}.thumb.${extFor(m.thumb, 'webp')}`;
  const storage = supabase.storage.from(BUCKET);

  const up = await storage.upload(path, m.file, {
    contentType: m.file.type || 'application/octet-stream',
    upsert: true,
  });
  if (up.error) throw up.error;
  const upThumb = await storage.upload(thumbPath, m.thumb, {
    contentType: m.thumb.type || 'image/webp',
    upsert: true,
  });
  if (upThumb.error) {
    await storage.remove([path]);
    throw upThumb.error;
  }

  const { data, error } = await supabase
    .from('media')
    .insert({
      id,
      hike_id: hikeId,
      point_id: pointId,
      kind: m.kind,
      path,
      thumb_path: thumbPath,
      duration_s: m.durationS,
      taken_at: m.takenAt === null ? null : new Date(m.takenAt * 1000).toISOString(),
      lat: m.lat,
      lon: m.lon,
      width: Math.round(m.width),
      height: Math.round(m.height),
      sort,
    })
    .select()
    .single();
  if (error) {
    await storage.remove([path, thumbPath]);
    throw error;
  }
  const [item] = await signMedia([data as Media]);
  if (!item) throw new Error('Не удалось получить ссылку на файл');
  return item;
}

/** Удаляет медиа: строку и оба файла. */
export async function deleteMedia(m: Media): Promise<void> {
  const { error } = await supabase.from('media').delete().eq('id', m.id);
  if (error) throw error;
  await supabase.storage.from(BUCKET).remove([m.path, m.thumb_path]);
}

/** Новый порядок фото в точке: sort = индекс в списке. */
export async function reorderMedia(ids: string[]): Promise<void> {
  const results = await Promise.all(
    ids.map((id, sort) => supabase.from('media').update({ sort }).eq('id', id)),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) throw failed.error;
}

export interface StorageUsage {
  hikeBytes: number;
  totalBytes: number;
}

/** Сколько места занято: этим походом и всего (на бесплатном тарифе — 1 ГБ). */
export async function storageUsage(hikeId: string): Promise<StorageUsage> {
  const { data, error } = await supabase.rpc('storage_usage', { p_hike_id: hikeId });
  if (error) throw error;
  const row = (data as { hike_bytes: number; total_bytes: number }[] | null)?.[0];
  return { hikeBytes: Number(row?.hike_bytes ?? 0), totalBytes: Number(row?.total_bytes ?? 0) };
}
