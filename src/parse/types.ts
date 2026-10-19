// Общий вид разобранного файла: сегменты точек и метки.

/** Точка трека. `t` — секунды Unix (дробные), `ele` — метры. */
export interface RawPoint {
  lat: number;
  lon: number;
  ele?: number;
  t?: number;
}

/** Метка из файла (`<wpt>` в GPX, точка в KML/GeoJSON). */
export interface Waypoint {
  lat: number;
  lon: number;
  name: string;
  desc: string;
}

export interface ParsedFile {
  /** Сегменты в порядке файла. Склейка — в `mergeSegments`. */
  segments: RawPoint[][];
  waypoints: Waypoint[];
}

/** Самый большой файл трека, который берём. */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

export type ImportErrorCode = 'no-track' | 'unsupported' | 'too-large' | 'too-short';

export const IMPORT_ERROR_MESSAGES: Record<ImportErrorCode, string> = {
  'no-track': 'В файле нет трека',
  unsupported: 'Формат не поддерживается',
  'too-large': 'Файл больше 50 МБ',
  'too-short': 'Трек короче 100 м',
};

/** Ошибка импорта, которую показываем человеку. */
export class ImportError extends Error {
  readonly code: ImportErrorCode;
  constructor(code: ImportErrorCode) {
    super(IMPORT_ERROR_MESSAGES[code]);
    this.name = 'ImportError';
    this.code = code;
  }
}

/** Разбирает время ISO 8601 в секунды Unix; `undefined`, если не вышло. */
export function parseTime(value: string | undefined | null): number | undefined {
  if (!value) return undefined;
  const ms = Date.parse(value.trim());
  return Number.isFinite(ms) ? ms / 1000 : undefined;
}

export function isValidLatLon(lat: number, lon: number): boolean {
  return (
    Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
  );
}
