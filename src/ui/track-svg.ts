// Трек как SVG без тайлов: мини-карта в списке и превью при импорте.

import { splitDays } from '../track/days';
import type { TrackData } from '../types';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Пути SVG (атрибут `d`) по дням, вписанные в прямоугольник width×height с отступом.
 * Долгота сжимается на cos(широты), чтобы трек не был растянут. Ночь не рисуется перелётом:
 * каждый день — отдельный путь. `maxPoints` прореживает каждый день для мини-карт.
 */
export function trackPaths(
  track: Pick<TrackData, 'lat' | 'lon' | 't'>,
  width: number,
  height: number,
  pad = 4,
  maxPoints = Infinity,
): string[] {
  const n = track.lat.length;
  if (!n) return [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let latSum = 0;
  for (let i = 0; i < n; i++) latSum += track.lat[i] as number;
  const kx = Math.cos(((latSum / n) * Math.PI) / 180);
  const xs = new Array<number>(n);
  const ys = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const x = (track.lon[i] as number) * kx;
    const y = -(track.lat[i] as number);
    xs[i] = x;
    ys[i] = y;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const spanX = maxX - minX || 1e-9;
  const spanY = maxY - minY || 1e-9;
  const scale = Math.min((width - 2 * pad) / spanX, (height - 2 * pad) / spanY);
  const offX = (width - spanX * scale) / 2;
  const offY = (height - spanY * scale) / 2;
  const fmt = (v: number): string => (Math.round(v * 10) / 10).toString();

  return splitDays(track.t, n).map(({ start, end }) => {
    const count = end - start + 1;
    const step = Math.max(1, Math.ceil(count / maxPoints));
    const parts: string[] = [];
    for (let i = start; i <= end; i += step) {
      const x = offX + ((xs[i] as number) - minX) * scale;
      const y = offY + ((ys[i] as number) - minY) * scale;
      parts.push(`${parts.length ? 'L' : 'M'}${fmt(x)} ${fmt(y)}`);
    }
    if ((end - start) % step) {
      const x = offX + ((xs[end] as number) - minX) * scale;
      const y = offY + ((ys[end] as number) - minY) * scale;
      parts.push(`L${fmt(x)} ${fmt(y)}`);
    }
    return parts.join('');
  });
}

/** SVG-элемент с треком; дни раскрашиваются по очереди классами `day-0`, `day-1`… */
export function trackSvg(
  track: TrackData,
  {
    width,
    height,
    maxPoints = Infinity,
    className = '',
  }: {
    width: number;
    height: number;
    maxPoints?: number;
    className?: string;
  },
): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('class', `track-svg ${className}`.trim());
  svg.setAttribute('aria-hidden', 'true');
  trackPaths(track, width, height, 6, maxPoints).forEach((d, i) => {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('class', `day-${i % 4}`);
    svg.append(path);
  });
  return svg;
}
