// Форматирование чисел, длительностей и дат для экрана. Всё по-русски.

const LOCALE = 'ru-RU';

/** «31,5 км»; меньше километра — в метрах. */
export function formatKm(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} м`;
  const km = (meters / 1000).toLocaleString(LOCALE, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  return `${km} км`;
}

/** «5 ч 12 мин», «45 мин». */
export function formatDuration(seconds: number): string {
  const total = Math.round(seconds / 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return `${m} мин`;
  return m ? `${h} ч ${m} мин` : `${h} ч`;
}

/** «4,6 км/ч». */
export function formatSpeed(kmh: number): string {
  return `${kmh.toLocaleString(LOCALE, { maximumFractionDigits: 1 })} км/ч`;
}

export function formatMeters(m: number): string {
  return `${Math.round(m).toLocaleString(LOCALE)} м`;
}

interface DateParts {
  day: string;
  month: string;
  year: string;
}

function dateParts(sec: number, timeZone: string): DateParts {
  const parts = new Intl.DateTimeFormat(LOCALE, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone,
  }).formatToParts(new Date(sec * 1000));
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return { day: get('day'), month: get('month'), year: get('year') };
}

/** «17 октября 2026», «17–18 октября 2026», «30 сентября – 2 октября 2026». */
export function formatDateRange(startSec: number, endSec: number, timeZone: string): string {
  const a = dateParts(startSec, timeZone);
  const b = dateParts(endSec, timeZone);
  if (a.year !== b.year) return `${a.day} ${a.month} ${a.year} – ${b.day} ${b.month} ${b.year}`;
  if (a.month !== b.month) return `${a.day} ${a.month} – ${b.day} ${b.month} ${b.year}`;
  if (a.day !== b.day) return `${a.day}–${b.day} ${a.month} ${a.year}`;
  return `${a.day} ${a.month} ${a.year}`;
}

/** «17 окт.» — короткая дата дня. */
export function formatShortDate(sec: number, timeZone: string): string {
  return new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short', timeZone }).format(
    new Date(sec * 1000),
  );
}

/** «12:54» в поясе похода. */
export function formatTime(sec: number, timeZone: string): string {
  return new Intl.DateTimeFormat(LOCALE, {
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(new Date(sec * 1000));
}

/** Склонение: plural(3, ['день', 'дня', 'дней']) → «дня». */
export function plural(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}
