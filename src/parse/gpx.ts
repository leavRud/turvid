// Разбор GPX без DOM: регулярные выражения по тексту.
// togeojson + xmldom разбирают эталонные 13,7 МБ около 4 с, этот разбор — доли секунды.

import { isValidLatLon, parseTime, type ParsedFile, type RawPoint, type Waypoint } from './types';

const SEGMENT_RE = /<(?:\w+:)?trkseg\b[^>]*>([\s\S]*?)<\/(?:\w+:)?trkseg>/g;
const ROUTE_RE = /<(?:\w+:)?rte\b[^>]*>([\s\S]*?)<\/(?:\w+:)?rte>/g;
const LAT_RE = /\blat\s*=\s*["']([^"']*)["']/;
const LON_RE = /\blon\s*=\s*["']([^"']*)["']/;

/** `<tag lat=".." lon=".."/>` или `<tag ...>содержимое</tag>`. */
function pointRe(tag: string): RegExp {
  return new RegExp(`<(?:\\w+:)?${tag}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</(?:\\w+:)?${tag}>)`, 'g');
}

const TRKPT_RE = pointRe('trkpt');
const RTEPT_RE = pointRe('rtept');
const WPT_RE = pointRe('wpt');

/** Текст дочернего элемента `name`, если он есть. */
function childText(content: string | undefined, name: string): string | undefined {
  if (!content) return undefined;
  const open = content.indexOf(`<${name}>`);
  if (open < 0) return undefined;
  const start = open + name.length + 2;
  const end = content.indexOf(`</${name}>`, start);
  if (end < 0) return undefined;
  return content.slice(start, end);
}

export function decodeXml(text: string): string {
  const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(text);
  if (cdata) return (cdata[1] ?? '').trim();
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

function readLatLon(attrs: string): { lat: number; lon: number } | null {
  const lat = Number(LAT_RE.exec(attrs)?.[1] ?? NaN);
  const lon = Number(LON_RE.exec(attrs)?.[1] ?? NaN);
  return isValidLatLon(lat, lon) ? { lat, lon } : null;
}

function readPoints(block: string, re: RegExp): RawPoint[] {
  const points: RawPoint[] = [];
  re.lastIndex = 0;
  for (let m = re.exec(block); m; m = re.exec(block)) {
    const pos = readLatLon(m[1] ?? '');
    if (!pos) continue;
    const point: RawPoint = pos;
    const eleText = childText(m[2], 'ele');
    if (eleText !== undefined) {
      const ele = Number(eleText);
      if (eleText.trim() !== '' && Number.isFinite(ele)) point.ele = ele;
    }
    const t = parseTime(childText(m[2], 'time'));
    if (t !== undefined) point.t = t;
    points.push(point);
  }
  return points;
}

export function parseGpx(text: string): ParsedFile {
  const segments: RawPoint[][] = [];

  SEGMENT_RE.lastIndex = 0;
  for (let m = SEGMENT_RE.exec(text); m; m = SEGMENT_RE.exec(text)) {
    const points = readPoints(m[1] ?? '', TRKPT_RE);
    if (points.length) segments.push(points);
  }
  // Маршруты (<rte>) берём, только если треков нет.
  if (!segments.length) {
    ROUTE_RE.lastIndex = 0;
    for (let m = ROUTE_RE.exec(text); m; m = ROUTE_RE.exec(text)) {
      const points = readPoints(m[1] ?? '', RTEPT_RE);
      if (points.length) segments.push(points);
    }
  }

  const waypoints: Waypoint[] = [];
  WPT_RE.lastIndex = 0;
  for (let m = WPT_RE.exec(text); m; m = WPT_RE.exec(text)) {
    const pos = readLatLon(m[1] ?? '');
    if (!pos) continue;
    const name = childText(m[2], 'name');
    const desc = childText(m[2], 'desc') ?? childText(m[2], 'cmt');
    waypoints.push({
      ...pos,
      name: name ? decodeXml(name) : '',
      desc: desc ? decodeXml(desc) : '',
    });
  }

  return { segments, waypoints };
}
