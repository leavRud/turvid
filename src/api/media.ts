// Фото и видео похода: файлы в Cloudflare R2 (новые) или в Supabase Storage (старые и запасной
// вариант, пока R2 не подключён), строки — в таблице media.
// С R2 браузер работает только через Edge Function media: она выдаёт одноразовые ссылки.

import type { Media, MediaItem } from '../types';
import { currentUserId } from './auth';
import { supabase } from './client';

const BUCKET = 'media';
/** Сколько живут подписанные ссылки на файлы, с. */
const SIGNED_URL_TTL_S = 3600;
/** Столько ключей R2 подписываем за один вызов функции (её предел — 200). */
const R2_BATCH = 200;

/** Ошибка от Edge Function media: статус ответа нужен, чтобы понять, что R2 не подключён. */
async function callMedia<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error, response } = await supabase.functions.invoke<T>('media', { body });
  if (error) {
    const err = new Error(`Хранилище фото: ${error.message}`) as Error & { status?: number };
    err.status = response?.status;
    throw err;
  }
  return data as T;
}

let r2Status: Promise<boolean> | null = null;

/** Подключён ли R2 (секреты заданы в Supabase). Спрашиваем один раз за сессию. */
export function r2Enabled(): Promise<boolean> {
  r2Status ??= callMedia<{ r2: boolean }>({ action: 'status' })
    .then((d) => d.r2 === true)
    .catch(() => false);
  return r2Status;
}

const chunks = <T>(arr: T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
    arr.slice(i * size, (i + 1) * size),
  );

/** Подписанные ссылки на файл и превью для каждого медиа: Supabase — одним запросом, R2 — через функцию. */
export async function signMedia(rows: Media[]): Promise<MediaItem[]> {
  if (!rows.length) return [];
  const urls = new Map<string, string>();

  const inSupabase = rows.filter((m) => m.storage !== 'r2');
  if (inSupabase.length) {
    const paths = inSupabase.flatMap((m) => [m.path, m.thumb_path]);
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrls(paths, SIGNED_URL_TTL_S);
    if (error) throw error;
    for (const d of data) if (d.path && d.signedUrl) urls.set(d.path, d.signedUrl);
  }

  const inR2 = rows.filter((m) => m.storage === 'r2');
  for (const batch of chunks(
    inR2.flatMap((m) => [m.path, m.thumb_path]),
    R2_BATCH,
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

/** Кладёт файл по подписанной ссылке R2. */
async function putToR2(url: string, blob: Blob): Promise<void> {
  const res = await fetch(url, {
    method: 'PUT',
    body: blob,
    headers: { 'Content-Type': blob.type || 'application/octet-stream' },
  });
  // 5xx и 429 — временное, очередь загрузки повторит; остальное — настройка бакета.
  if (!res.ok) throw new Error(`R2 ответил ${res.status} при загрузке файла`);
}

/** Файл и превью в R2; возвращает их ключи. */
async function uploadToR2(
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
    await putToR2(file.url, m.file);
    await putToR2(thumb.url, m.thumb);
  } catch (err) {
    await callMedia({ action: 'delete', keys: [file.key, thumb.key] }).catch(() => undefined);
    if (err instanceof TypeError) {
      // Браузер не дошёл до R2: обрыв связи или у бакета не настроен CORS.
      throw new TypeError(
        'Не удалось отправить файл в Cloudflare R2 — нет связи или у бакета не настроен CORS',
        { cause: err },
      );
    }
    throw err;
  }
  return { path: file.key, thumbPath: thumb.key };
}

/** Файл и превью в Supabase Storage — пока R2 не подключён. */
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
  if (m.storage === 'r2') {
    await callMedia({ action: 'delete', keys: [m.path, m.thumb_path] });
  } else {
    await supabase.storage.from(BUCKET).remove([m.path, m.thumb_path]);
  }
}

/** Загружает файл и превью (в R2, если подключён) и добавляет строку в media. */
export async function uploadMedia(
  hikeId: string,
  pointId: string | null,
  sort: number,
  m: PreparedMedia,
): Promise<MediaItem> {
  const id = crypto.randomUUID();
  const storage: Media['storage'] = (await r2Enabled()) ? 'r2' : 'supabase';
  const { path, thumbPath } =
    storage === 'r2' ? await uploadToR2(hikeId, id, m) : await uploadToSupabase(hikeId, id, m);

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

/** Удаляет из R2 все файлы похода (перед удалением самого похода). */
export async function deleteHikeR2Files(hikeId: string): Promise<void> {
  const { data, error } = await supabase
    .from('media')
    .select('path, thumb_path')
    .eq('hike_id', hikeId)
    .eq('storage', 'r2');
  if (error) throw error;
  const keys = (data ?? []).flatMap((m) => [m.path as string, m.thumb_path as string]);
  for (const batch of chunks(keys, R2_BATCH)) await callMedia({ action: 'delete', keys: batch });
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
  /** Фото и видео в R2 (10 ГБ бесплатно). */
  r2Bytes: number;
  /** Supabase Storage: треки и старые фото (1 ГБ бесплатно). */
  supabaseBytes: number;
  r2: boolean;
}

/** Сколько места занято: этим походом, в R2 и в Supabase. */
export async function storageUsage(hikeId: string): Promise<StorageUsage> {
  const [{ data, error }, r2] = await Promise.all([
    supabase.rpc('storage_usage', { p_hike_id: hikeId }),
    r2Enabled(),
  ]);
  if (error) throw error;
  const row = (
    data as { hike_bytes: number; r2_bytes: number; supabase_bytes: number }[] | null
  )?.[0];
  return {
    hikeBytes: Number(row?.hike_bytes ?? 0),
    r2Bytes: Number(row?.r2_bytes ?? 0),
    supabaseBytes: Number(row?.supabase_bytes ?? 0),
    r2,
  };
}

/** Переложить медиа в другую точку; null — в неразобранные. */
export async function moveMedia(id: string, pointId: string | null, sort: number): Promise<void> {
  const { error } = await supabase.from('media').update({ point_id: pointId, sort }).eq('id', id);
  if (error) throw error;
}
