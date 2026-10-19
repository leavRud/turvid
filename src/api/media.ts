// Фото и видео похода: файлы в S3-хранилище — VK Cloud Object Storage (новые) — или в Supabase
// Storage (старые и запасной вариант, пока S3 не подключён), строки — в таблице media.
// С S3 браузер работает только через Edge Function media: она выдаёт одноразовые ссылки.

import type { Media, MediaItem } from '../types';
import { currentUserId } from './auth';
import { supabase } from './client';

const BUCKET = 'media';
/** Сколько живут подписанные ссылки на файлы, с. */
const SIGNED_URL_TTL_S = 3600;
/** Столько ключей S3 подписываем за один вызов функции (её предел — 200). */
const S3_BATCH = 200;

/** Ошибка от Edge Function media: статус ответа нужен, чтобы понять, что S3 не подключён. */
async function callMedia<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error, response } = await supabase.functions.invoke<T>('media', { body });
  if (error) {
    const err = new Error(`Хранилище фото: ${error.message}`) as Error & { status?: number };
    err.status = response?.status;
    throw err;
  }
  return data as T;
}

let s3Status: Promise<boolean> | null = null;

/** Подключено ли S3-хранилище (секреты заданы в Supabase). Спрашиваем один раз за сессию. */
export function s3Enabled(): Promise<boolean> {
  s3Status ??= callMedia<{ s3: boolean }>({ action: 'status' })
    .then((d) => d.s3 === true)
    .catch(() => false);
  return s3Status;
}

const chunks = <T>(arr: T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
    arr.slice(i * size, (i + 1) * size),
  );

/** Подписанные ссылки на файл и превью для каждого медиа: Supabase — одним запросом, S3 — через функцию. */
export async function signMedia(rows: Media[]): Promise<MediaItem[]> {
  if (!rows.length) return [];
  const urls = new Map<string, string>();

  const inSupabase = rows.filter((m) => m.storage !== 's3');
  if (inSupabase.length) {
    const paths = inSupabase.flatMap((m) => [m.path, m.thumb_path]);
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrls(paths, SIGNED_URL_TTL_S);
    if (error) throw error;
    for (const d of data) if (d.path && d.signedUrl) urls.set(d.path, d.signedUrl);
  }

  const inS3 = rows.filter((m) => m.storage === 's3');
  for (const batch of chunks(
    inS3.flatMap((m) => [m.path, m.thumb_path]),
    S3_BATCH,
  )) {
    const { urls: signed } = await callMedia<{ urls: Record<string, string> }>({
      action: 'sign',
      keys: batch,
    });
    for (const [key, url] of Object.entries(signed)) urls.set(key, url);
  }

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
  /** Время из имени файла — примерное. */
  takenApprox: boolean;
  lat: number | null;
  lon: number | null;
}

function extFor(blob: Blob, fallback: string): string {
  if (blob.type === 'image/webp') return 'webp';
  if (blob.type === 'image/jpeg') return 'jpg';
  return fallback;
}

/** Кладёт файл по подписанной ссылке S3. */
async function putToS3(url: string, blob: Blob): Promise<void> {
  const res = await fetch(url, {
    method: 'PUT',
    body: blob,
    headers: { 'Content-Type': blob.type || 'application/octet-stream' },
  });
  // 5xx и 429 — временное, очередь загрузки повторит; остальное — настройка бакета.
  if (!res.ok) throw new Error(`Хранилище фото ответило ${res.status} при загрузке файла`);
}

/** Файл и превью в S3; возвращает их ключи. */
async function uploadToS3(
  hikeId: string,
  id: string,
  m: PreparedMedia,
): Promise<{ path: string; thumbPath: string }> {
  const fileName = `${id}.${m.ext}`;
  const thumbName = `${id}.thumb.${extFor(m.thumb, 'webp')}`;
  const { urls } = await callMedia<{ urls: { key: string; url: string }[] }>({
    action: 'upload',
    hikeId,
    files: [{ name: fileName }, { name: thumbName }],
  });
  const [file, thumb] = urls;
  if (!file || !thumb) throw new Error('Хранилище фото не выдало ссылки на загрузку');
  try {
    await putToS3(file.url, m.file);
    await putToS3(thumb.url, m.thumb);
  } catch (err) {
    await callMedia({ action: 'delete', keys: [file.key, thumb.key] }).catch(() => undefined);
    if (err instanceof TypeError) {
      // Браузер не дошёл до хранилища: обрыв связи или у бакета не настроен CORS.
      throw new TypeError(
        'Не удалось отправить файл в хранилище фото — нет связи или у бакета не настроен CORS',
        { cause: err },
      );
    }
    throw err;
  }
  return { path: file.key, thumbPath: thumb.key };
}

/** Файл и превью в Supabase Storage — пока S3 не подключён. */
async function uploadToSupabase(
  hikeId: string,
  id: string,
  m: PreparedMedia,
): Promise<{ path: string; thumbPath: string }> {
  const folder = `${await currentUserId()}/${hikeId}`;
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
  return { path, thumbPath };
}

/** Удаляет файлы медиа там, где они лежат. */
async function removeFiles(m: Pick<Media, 'storage' | 'path' | 'thumb_path'>): Promise<void> {
  if (m.storage === 's3') {
    await callMedia({ action: 'delete', keys: [m.path, m.thumb_path] });
  } else {
    await supabase.storage.from(BUCKET).remove([m.path, m.thumb_path]);
  }
}

/** Загружает файл и превью (в S3, если подключён) и добавляет строку в media. */
export async function uploadMedia(
  hikeId: string,
  pointId: string | null,
  sort: number,
  m: PreparedMedia,
): Promise<MediaItem> {
  const id = crypto.randomUUID();
  const storage: Media['storage'] = (await s3Enabled()) ? 's3' : 'supabase';
  const { path, thumbPath } =
    storage === 's3' ? await uploadToS3(hikeId, id, m) : await uploadToSupabase(hikeId, id, m);

  const { data, error } = await supabase
    .from('media')
    .insert({
      id,
      hike_id: hikeId,
      point_id: pointId,
      kind: m.kind,
      path,
      thumb_path: thumbPath,
      storage,
      bytes: m.file.size + m.thumb.size,
      duration_s: m.durationS,
      taken_at: m.takenAt === null ? null : new Date(m.takenAt * 1000).toISOString(),
      taken_approx: m.takenApprox,
      lat: m.lat,
      lon: m.lon,
      width: Math.round(m.width),
      height: Math.round(m.height),
      sort,
    })
    .select()
    .single();
  if (error) {
    await removeFiles({ storage, path, thumb_path: thumbPath }).catch(() => undefined);
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
  await removeFiles(m);
}

/** Удаляет из S3 все файлы похода (перед удалением самого похода). */
export async function deleteHikeS3Files(hikeId: string): Promise<void> {
  const { data, error } = await supabase
    .from('media')
    .select('path, thumb_path')
    .eq('hike_id', hikeId)
    .eq('storage', 's3');
  if (error) throw error;
  const keys = (data ?? []).flatMap((m) => [m.path as string, m.thumb_path as string]);
  for (const batch of chunks(keys, S3_BATCH)) await callMedia({ action: 'delete', keys: batch });
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
  /** Этот поход, всё вместе. */
  hikeBytes: number;
  /** Фото и видео в S3 (VK Cloud Object Storage). */
  s3Bytes: number;
  /** Supabase Storage: треки и старые фото (1 ГБ бесплатно). */
  supabaseBytes: number;
  s3: boolean;
}

/** Сколько места занято: этим походом, в S3 и в Supabase. */
export async function storageUsage(hikeId: string): Promise<StorageUsage> {
  const [{ data, error }, s3] = await Promise.all([
    supabase.rpc('storage_usage', { p_hike_id: hikeId }),
    s3Enabled(),
  ]);
  if (error) throw error;
  const row = (
    data as { hike_bytes: number; s3_bytes: number; supabase_bytes: number }[] | null
  )?.[0];
  return {
    hikeBytes: Number(row?.hike_bytes ?? 0),
    s3Bytes: Number(row?.s3_bytes ?? 0),
    supabaseBytes: Number(row?.supabase_bytes ?? 0),
    s3,
  };
}

/** Переложить медиа в другую точку; null — в неразобранные. */
export async function moveMedia(id: string, pointId: string | null, sort: number): Promise<void> {
  const { error } = await supabase.from('media').update({ point_id: pointId, sort }).eq('id', id);
  if (error) throw error;
}
