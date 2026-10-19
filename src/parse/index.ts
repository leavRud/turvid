// Точка входа разбора: определяет формат и склеивает сегменты.

import { parseGeojson } from './geojson';
import { parseGpx } from './gpx';
import { parseKml, parseKmz } from './kml';
import { ImportError, MAX_FILE_BYTES, type ParsedFile, type RawPoint } from './types';

export * from './types';

export type TrackFormat = 'gpx' | 'kml' | 'kmz' | 'geojson';

/** Формат по расширению, а если оно незнакомо — по началу файла. */
export function detectFormat(name: string, head: Uint8Array): TrackFormat | null {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (ext === 'gpx') return 'gpx';
  if (ext === 'kml') return 'kml';
  if (ext === 'kmz') return 'kmz';
  if (ext === 'geojson' || ext === 'json') return 'geojson';

  if (head[0] === 0x50 && head[1] === 0x4b) return 'kmz'; // «PK» — zip
  // TextDecoder сам отрезает BOM в начале.
  const start = new TextDecoder().decode(head.subarray(0, 2048));
  if (start.trimStart().startsWith('{')) return 'geojson';
  if (/<gpx[\s>]/.test(start)) return 'gpx';
  if (/<kml[\s>]/.test(start)) return 'kml';
  return null;
}

/** Разбирает файл трека. Бросает ImportError, если формат не тот или трека нет. */
export async function parseTrackFile(name: string, data: ArrayBuffer): Promise<ParsedFile> {
  if (data.byteLength > MAX_FILE_BYTES) throw new ImportError('too-large');
  const bytes = new Uint8Array(data);
  const format = detectFormat(name, bytes);
  if (!format) throw new ImportError('unsupported');

  let parsed: ParsedFile;
  try {
    if (format === 'kmz') {
      parsed = await parseKmz(data);
    } else {
      const text = new TextDecoder().decode(bytes);
      if (format === 'gpx') parsed = parseGpx(text);
      else if (format === 'kml') parsed = parseKml(text);
      else parsed = parseGeojson(text);
    }
  } catch {
    throw new ImportError('unsupported');
  }

  if (!parsed.segments.some((s) => s.length >= 2)) throw new ImportError('no-track');
  return parsed;
}

/**
 * Склеивает сегменты в одну последовательность точек.
 * Если у всех точек есть время — сегменты идут по времени начала,
 * иначе остаются в порядке файла.
 */
export function mergeSegments(segments: RawPoint[][]): RawPoint[] {
  const nonEmpty = segments.filter((s) => s.length > 0);
  const allTimed = nonEmpty.every((s) => s.every((p) => p.t !== undefined));
  const ordered = allTimed
    ? [...nonEmpty].sort((a, b) => (a[0]?.t ?? 0) - (b[0]?.t ?? 0))
    : nonEmpty;
  return ordered.flat();
}
