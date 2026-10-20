// Когда и где снято: EXIF у фото, заголовок MP4 у видео, а если там пусто — имя файла.

import { readPhotoMeta } from './exif';
import { timeFromFilename } from './filename-time';
import { readVideoMeta } from './mp4-meta';

export interface MediaMeta {
  /** Секунды Unix. */
  takenAt: number | null;
  /** Время примерное: из имени файла от мессенджера (там время отправки, а не съёмки). */
  approx: boolean;
  lat: number | null;
  lon: number | null;
}

export async function readMediaMeta(
  file: File,
  kind: 'photo' | 'video',
  hikeTimeZone: string,
): Promise<MediaMeta> {
  const base =
    kind === 'video' ? await readVideoMeta(file) : await readPhotoMeta(file, hikeTimeZone);
  const meta: MediaMeta = { ...base, approx: false };
  // Времени в самом файле нет (мессенджер, облако, скриншот) — пробуем имя файла.
  if (meta.takenAt === null) {
    const fromName = timeFromFilename(file.name, hikeTimeZone);
    if (fromName !== null) {
      meta.takenAt = fromName.t;
      meta.approx = fromName.approx;
    }
  }
  return meta;
}
