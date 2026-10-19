// Какие файлы берём и до какого размера. Чистые функции.

export const MAX_PHOTO_BYTES = 25 * 1024 * 1024;
/** Лимит Supabase на один файл на бесплатном тарифе. */
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

const PHOTO_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif']);
const VIDEO_EXT = new Set(['mp4', 'mov', 'webm', 'm4v']);

export interface FileKind {
  kind: 'photo' | 'video' | null;
  /** Расширение для пути в Storage (у видео — как есть). */
  ext: string;
  heic: boolean;
  /** Почему файл не берём; null — берём. */
  error: string | null;
}

/** Что за файл: по типу, а если тип пустой (бывает на Android) — по расширению. */
export function classifyFile(file: { name: string; type: string; size: number }): FileKind {
  const ext = (file.name.toLowerCase().split('.').pop() ?? '').replace('jpeg', 'jpg');
  const type = file.type.toLowerCase();
  const heic = type === 'image/heic' || type === 'image/heif' || ext === 'heic' || ext === 'heif';
  const isPhoto =
    heic || ['image/jpeg', 'image/png', 'image/webp'].includes(type) || PHOTO_EXT.has(ext);
  const isVideo = type.startsWith('video/') || VIDEO_EXT.has(ext);

  if (isVideo) {
    const videoExt = ext === 'm4v' ? 'mp4' : VIDEO_EXT.has(ext) ? ext : 'mp4';
    if (file.size > MAX_VIDEO_BYTES) {
      return {
        kind: 'video',
        ext: videoExt,
        heic: false,
        error: `${file.name}: видео больше 50 МБ — бесплатный Supabase такие не принимает`,
      };
    }
    return { kind: 'video', ext: videoExt, heic: false, error: null };
  }
  if (isPhoto) {
    if (file.size > MAX_PHOTO_BYTES) {
      return { kind: 'photo', ext, heic, error: `${file.name}: фото больше 25 МБ` };
    }
    return { kind: 'photo', ext, heic, error: null };
  }
  return {
    kind: null,
    ext,
    heic: false,
    error: `${file.name}: формат не поддерживается (нужны JPEG, PNG, WebP, HEIC, MP4, MOV, WebM)`,
  };
}
