// Время съёмки из имени файла — когда в самом файле его нет (мессенджер вырезал EXIF,
// архив из облака, скриншот). Чистые функции.

import { wallTimeToUnix } from './exif-time';

export interface NameTime {
  /** Секунды Unix. */
  t: number;
  /** Время примерное: у мессенджеров в имени время отправки, а не съёмки. */
  approx: boolean;
}

interface Pattern {
  re: RegExp;
  approx: boolean;
}

/**
 * Известные шаблоны имён; время «на часах», без пояса — считаем его в поясе похода.
 * Порядок важен: сначала мессенджеры (их время примерное), потом камеры.
 */
const PATTERNS: Pattern[] = [
  // Telegram Desktop: photo_2026-10-17_14-32-05, video_…
  {
    re: /(?:^|[^a-z])(?:photo|video)_(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})/i,
    approx: true,
  },
  // WhatsApp на компьютере: WhatsApp Image 2026-10-17 at 14.32.05
  { re: /whatsapp.*?(\d{4})-(\d{2})-(\d{2}) at (\d{1,2})\.(\d{2})\.(\d{2})/i, approx: true },
  // Камеры: IMG_20261017_143205, VID_…, PXL_20261017_143205123, MVIMG_…,
  // Screenshot_20261017-143205, Samsung 20261017_143205.
  { re: /(?:^|[^\d])(\d{4})(\d{2})(\d{2})[_-](\d{2})(\d{2})(\d{2})/, approx: false },
  // Выгрузки из облаков и скриншоты: 2026-10-17 14.32.05, 2026-10-17_14-32-05,
  // «Снимок экрана 2026-10-17 в 14.32.05», 2026-10-17T14:32:05.
  {
    re: /(?:^|[^\d])(\d{4})-(\d{2})-(\d{2})(?:[ _T]|\s+(?:at|в)\s+)(\d{2})[.:_-](\d{2})[.:_-](\d{2})/i,
    approx: false,
  },
];

/** Время из имени файла или null, если по имени не понять. */
export function timeFromFilename(name: string, timeZone: string): NameTime | null {
  const base = name.split(/[\\/]/).pop() ?? name;
  for (const { re, approx } of PATTERNS) {
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
    if (
      y < 2000 ||
      y > 2100 ||
      mo < 1 ||
      mo > 12 ||
      d < 1 ||
      d > 31 ||
      h > 23 ||
      mi > 59 ||
      s > 59
    ) {
      continue;
    }
    return { t: wallTimeToUnix(y, mo, d, h, mi, s, timeZone), approx };
  }
  return null;
}
