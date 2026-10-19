// Высота солнца над горизонтом — для фона шкалы времени (день, сумерки, ночь). Чистые функции.

const RAD = Math.PI / 180;
/** Полдень 1 января 2000 UTC (эпоха J2000) в миллисекундах Unix. */
const J2000_MS = Date.UTC(2000, 0, 1, 12);
const DAY_MS = 86_400_000;

/**
 * Высота солнца в градусах для момента `ms` (Unix, мс) в точке lat/lon.
 * Упрощённые формулы Астрономического альманаха: точность ~0,5°, для фона хватает.
 */
export function sunAltitude(ms: number, lat: number, lon: number): number {
  const d = (ms - J2000_MS) / DAY_MS;
  const g = (357.529 + 0.98560028 * d) * RAD; // средняя аномалия
  const q = 280.459 + 0.98564736 * d; // средняя долгота, °
  const l = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD; // эклиптическая долгота
  const e = (23.439 - 0.00000036 * d) * RAD; // наклон эклиптики
  const ra = Math.atan2(Math.cos(e) * Math.sin(l), Math.cos(l));
  const dec = Math.asin(Math.sin(e) * Math.sin(l));
  const gmstHours = (((18.697374558 + 24.06570982441908 * d) % 24) + 24) % 24;
  const hourAngle = (gmstHours * 15 + lon) * RAD - ra;
  const sinAlt =
    Math.sin(lat * RAD) * Math.sin(dec) + Math.cos(lat * RAD) * Math.cos(dec) * Math.cos(hourAngle);
  return Math.asin(Math.min(1, Math.max(-1, sinAlt))) / RAD;
}

/** Солнце ниже этого — ночь (гражданские сумерки кончились), °. */
export const NIGHT_ALT = -6;
/** Солнце выше этого — полный день, °. */
export const DAY_ALT = 6;

/** Насколько светло: 0 — ночь, 1 — день, между ними — сумерки. */
export function daylight(altitude: number): number {
  return Math.min(1, Math.max(0, (altitude - NIGHT_ALT) / (DAY_ALT - NIGHT_ALT)));
}
