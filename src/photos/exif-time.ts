// Время съёмки из EXIF → секунды Unix. Чистые функции.

/** Смещение пояса в момент `utcMs` для IANA-зоны, минуты (Москва → +180). */
export function zoneOffsetMinutes(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(new Date(utcMs));
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return Math.round((asUtc - Math.floor(utcMs / 1000) * 1000) / 60_000);
}

/** Время «на часах» в поясе `timeZone` → секунды Unix. */
export function wallTimeToUnix(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  s: number,
  timeZone: string,
): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  // Два прохода: смещение могло поменяться при переходе на летнее время.
  let ms = guess - zoneOffsetMinutes(guess, timeZone) * 60_000;
  ms = guess - zoneOffsetMinutes(ms, timeZone) * 60_000;
  return ms / 1000;
}

const EXIF_TIME_RE = /^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/;
const OFFSET_RE = /^([+-])(\d{2}):?(\d{2})$/;

/**
 * Время из EXIF «2026:10:17 14:32:05». Если есть OffsetTimeOriginal («+03:00») — по нему,
 * иначе время считается в поясе похода. null — время не разобрать.
 */
export function exifTimeToUnix(
  raw: string | null | undefined,
  offset: string | null | undefined,
  hikeTimeZone: string,
): number | null {
  const m = raw ? EXIF_TIME_RE.exec(raw.trim()) : null;
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1, 7).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  if (y < 1990 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const off = offset ? OFFSET_RE.exec(offset.trim()) : null;
  if (off) {
    const sign = off[1] === '-' ? -1 : 1;
    const minutes = sign * (Number(off[2]) * 60 + Number(off[3]));
    return Date.UTC(y, mo - 1, d, h, mi, s) / 1000 - minutes * 60;
  }
  return wallTimeToUnix(y, mo, d, h, mi, s, hikeTimeZone);
}
