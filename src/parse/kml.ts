// KML и KMZ: togeojson поверх xmldom (в воркере нет DOMParser).

import { kml } from '@tmcw/togeojson';
import { DOMParser } from '@xmldom/xmldom';
import JSZip from 'jszip';
import { geojsonToParsed } from './geojson';
import type { ParsedFile } from './types';

export function parseKml(source: string): ParsedFile {
  const doc = new DOMParser().parseFromString(source, 'text/xml');
  // Document из xmldom совместим с тем, что читает togeojson,
  // но это не тип lib.dom Document, поэтому приведение через unknown.
  return geojsonToParsed(kml(doc as unknown as Document));
}

/** KMZ — zip, внутри основной .kml (обычно doc.kml). */
export async function parseKmz(data: ArrayBuffer): Promise<ParsedFile> {
  const zip = await JSZip.loadAsync(data);
  const names = Object.keys(zip.files).filter((n) => n.toLowerCase().endsWith('.kml'));
  const main = names.find((n) => n.toLowerCase().endsWith('doc.kml')) ?? names[0];
  const file = main ? zip.file(main) : null;
  if (!file) return { segments: [], waypoints: [] };
  return parseKml(await file.async('string'));
}
