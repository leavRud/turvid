// GeoJSON → общий вид. Этот же код разбирает результат togeojson для KML.

import { isValidLatLon, parseTime, type ParsedFile, type RawPoint } from './types';

type Props = Record<string, unknown> | null | undefined;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function toTime(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Миллисекунды или секунды Unix.
    return value > 1e11 ? value / 1000 : value;
  }
  return typeof value === 'string' ? parseTime(value) : undefined;
}

function toPoint(pos: unknown, time: unknown): RawPoint | null {
  if (!Array.isArray(pos)) return null;
  const [lon, lat, ele] = pos as unknown[];
  if (typeof lon !== 'number' || typeof lat !== 'number' || !isValidLatLon(lat, lon)) return null;
  const point: RawPoint = { lat, lon };
  if (typeof ele === 'number' && Number.isFinite(ele)) point.ele = ele;
  const t = toTime(time);
  if (t !== undefined) point.t = t;
  return point;
}

function toSegment(coords: unknown, times: unknown): RawPoint[] {
  if (!Array.isArray(coords)) return [];
  const timeArr: unknown[] = Array.isArray(times) ? times : [];
  const points: RawPoint[] = [];
  coords.forEach((pos, i) => {
    const p = toPoint(pos, timeArr[i]);
    if (p) points.push(p);
  });
  return points;
}

/** Времена точек: togeojson кладёт их в coordinateProperties.times, старые файлы — в coordTimes. */
function featureTimes(props: Props): unknown {
  if (!props) return undefined;
  const cp = props['coordinateProperties'];
  if (isObject(cp) && cp['times'] !== undefined) return cp['times'];
  return props['coordTimes'] ?? props['times'];
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function addGeometry(geom: unknown, props: Props, out: ParsedFile): void {
  if (!isObject(geom)) return;
  const times = featureTimes(props);
  const coords = geom['coordinates'];
  switch (geom['type']) {
    case 'LineString': {
      const seg = toSegment(coords, times);
      if (seg.length) out.segments.push(seg);
      break;
    }
    case 'MultiLineString': {
      if (!Array.isArray(coords)) return;
      coords.forEach((line, i) => {
        const seg = toSegment(line, Array.isArray(times) ? times[i] : undefined);
        if (seg.length) out.segments.push(seg);
      });
      break;
    }
    case 'Point': {
      const p = toPoint(coords, undefined);
      if (!p) return;
      out.waypoints.push({
        lat: p.lat,
        lon: p.lon,
        name: text(props?.['name']),
        desc: text(props?.['description'] ?? props?.['desc']),
      });
      break;
    }
    case 'GeometryCollection': {
      const geometries = geom['geometries'];
      if (Array.isArray(geometries)) geometries.forEach((g) => addGeometry(g, props, out));
      break;
    }
  }
}

function addFeature(feature: Record<string, unknown>, out: ParsedFile): void {
  const props = feature['properties'];
  addGeometry(feature['geometry'], isObject(props) ? props : null, out);
}

/** Разбирает объект GeoJSON: геометрию, Feature или FeatureCollection. */
export function geojsonToParsed(data: unknown): ParsedFile {
  const out: ParsedFile = { segments: [], waypoints: [] };
  if (!isObject(data)) return out;
  if (data['type'] === 'FeatureCollection') {
    const features = data['features'];
    if (Array.isArray(features)) {
      for (const f of features) if (isObject(f) && f['type'] === 'Feature') addFeature(f, out);
    }
  } else if (data['type'] === 'Feature') {
    addFeature(data, out);
  } else {
    addGeometry(data, null, out);
  }
  return out;
}

export function parseGeojson(source: string): ParsedFile {
  let data: unknown;
  try {
    data = JSON.parse(source);
  } catch {
    return { segments: [], waypoints: [] };
  }
  return geojsonToParsed(data);
}
