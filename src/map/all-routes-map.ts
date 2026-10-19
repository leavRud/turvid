// Карта всех маршрутов на экране статистики: клик по треку открывает поход.

import 'maplibre-gl/dist/maplibre-gl.css';
import { Map as MapLibreMap, NavigationControl, setWorkerUrl } from 'maplibre-gl';
import mapWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { splitDays } from '../track/days';
import type { TrackData } from '../types';
import { followTheme, mapStyleUrl } from './style';

setWorkerUrl(mapWorkerUrl);

export interface RouteOnMap {
  id: string;
  title: string;
  track: TrackData;
  bbox: [number, number, number, number];
}

export function createAllRoutesMap(
  container: HTMLElement,
  routes: RouteOnMap[],
  onOpen: (id: string) => void,
): () => void {
  const bbox = routes.reduce<[number, number, number, number]>(
    (b, r) => [
      Math.min(b[0], r.bbox[0]),
      Math.min(b[1], r.bbox[1]),
      Math.max(b[2], r.bbox[2]),
      Math.max(b[3], r.bbox[3]),
    ],
    [Infinity, Infinity, -Infinity, -Infinity],
  );
  const map = new MapLibreMap({
    container,
    style: mapStyleUrl(),
    bounds: [
      [bbox[0], bbox[1]],
      [bbox[2], bbox[3]],
    ],
    fitBoundsOptions: { padding: 40, maxZoom: 13 },
    dragRotate: false,
    pitchWithRotate: false,
    attributionControl: { compact: true },
  });
  map.touchZoomRotate.disableRotation();
  map.addControl(new NavigationControl({ showCompass: false }), 'top-right');

  const features = routes.map((r) => ({
    type: 'Feature' as const,
    properties: { id: r.id, title: r.title },
    geometry: {
      type: 'MultiLineString' as const,
      coordinates: splitDays(r.track.t, r.track.lat.length).map(({ start, end }) => {
        const line: [number, number][] = [];
        for (let i = start; i <= end; i++) {
          line.push([r.track.lon[i] as number, r.track.lat[i] as number]);
        }
        return line;
      }),
    },
  }));

  const css = getComputedStyle(document.documentElement);
  const stopTheme = followTheme(map, () => {
    map.addSource('routes', { type: 'geojson', data: { type: 'FeatureCollection', features } });
    map.addLayer({
      id: 'routes-casing',
      type: 'line',
      source: 'routes',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': css.getPropertyValue('--color-track-casing').trim(), 'line-width': 6 },
    });
    map.addLayer({
      id: 'routes',
      type: 'line',
      source: 'routes',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': css.getPropertyValue('--color-accent').trim(), 'line-width': 3.5 },
    });
    // Широкий прозрачный слой — по тонкой линии пальцем не попасть.
    map.addLayer({
      id: 'routes-hit',
      type: 'line',
      source: 'routes',
      paint: {
        'line-color': css.getPropertyValue('--color-accent').trim(),
        'line-opacity': 0,
        'line-width': 20,
      },
    });
  });
  map.on('click', 'routes-hit', (e) => {
    const id = e.features?.[0]?.properties?.['id'];
    if (typeof id === 'string') onOpen(id);
  });
  map.on('mouseenter', 'routes-hit', () => (map.getCanvas().style.cursor = 'pointer'));
  map.on('mouseleave', 'routes-hit', () => (map.getCanvas().style.cursor = ''));

  return () => {
    stopTheme();
    map.remove();
  };
}
