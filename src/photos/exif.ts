// Чтение EXIF из исходного файла (до сжатия — у сжатой копии EXIF нет).

import exifr from 'exifr';
import { exifTimeToUnix } from './exif-time';

export interface PhotoMeta {
  /** Секунды Unix. */
  takenAt: number | null;
  lat: number | null;
  lon: number | null;
}

/** Время съёмки и координаты; при любой ошибке разбора — пусто, загрузка не падает. */
export async function readPhotoMeta(file: Blob, hikeTimeZone: string): Promise<PhotoMeta> {
  const meta: PhotoMeta = { takenAt: null, lat: null, lon: null };
  try {
    // Сырые строки времени: exifr иначе превратит их в Date в поясе браузера.
    const tags = (await exifr.parse(file, {
      pick: ['DateTimeOriginal', 'CreateDate', 'OffsetTimeOriginal', 'OffsetTime'],
      reviveValues: false,
    })) as Record<string, unknown> | undefined;
    const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
    meta.takenAt = exifTimeToUnix(
      str(tags?.['DateTimeOriginal']) ?? str(tags?.['CreateDate']),
      str(tags?.['OffsetTimeOriginal']) ?? str(tags?.['OffsetTime']),
      hikeTimeZone,
    );
  } catch {
    // нет EXIF — не беда
  }
  try {
    const gps = await exifr.gps(file);
    if (gps && Number.isFinite(gps.latitude) && Number.isFinite(gps.longitude)) {
      meta.lat = gps.latitude;
      meta.lon = gps.longitude;
    }
  } catch {
    // нет координат
  }
  return meta;
}
