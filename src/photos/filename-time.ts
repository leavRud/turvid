// Время съёмки из имени файла — для фото, у которых мессенджер вырезал EXIF. Чистые функции.

import { wallTimeToUnix } from './exif-time';

/**
 * Известные шаблоны имён (время «на часах», без пояса):
 * - Telegram Desktop: photo_2026-10-17_14-32-05 (это время отправки, не съёмки);
 * - камеры Android: IMG_20261017_143205, VID_20261017_143205;
 * - Samsung: 20261017_143205.
 */
const PATTERNS: RegExp[] = [
  /(?:^|[^\d])(?:photo|video)_(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})/i,
  /(?:^|[^a-z])(?:img|vid)_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/i,
  /^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})(?:\D|$)/,
];

/** Секунды Unix или null. Время из имени считается в поясе похода. */
export function timeFromFilename(name: string, timeZone: string): number | null {
  const base = name.split(/[\\/]/).pop() ?? name;
  for (const re of PATTERNS) {
    const m = re.exec(base);
    if (!m) continue;
    const [y, mo, d, h, mi, s] = m.slice(1, 7).map(Number) as [
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    if (y < 2000 || mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) continue;
    return wallTimeToUnix(y, mo, d, h, mi, s, timeZone);
  }
  return null;
}
