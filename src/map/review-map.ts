// Карта на экране проверки раскладки: трек и предложенные точки с номерами.

import { Map as MapLibreMap, Marker } from 'maplibre-gl';
import { pointAt } from '../player/position';
import { splitDays } from '../track/days';
import type { TrackData } from '../types';
import { h } from '../ui/dom';
import { followTheme, mapStyleUrl } from './style';

export interface ReviewMarker {
  pos: number;
  label: string;
  /** Уже существующая точка (иначе — новая). */
  existing: boolean;
}

export interface ReviewMap {
  setMarkers(markers: ReviewMarker[]): void;
  destroy(): void;
}

export function createReviewMap(
  container: HTMLElement,
  track: TrackData,
  bbox: [number, number, number, number],
  onMarkerClick: (index: number) => void,
): ReviewMap {
  const map = new MapLibreMap({
    container,
    style: mapStyleUrl(),
    bounds: [
      [bbox[0], bbox[1]],
      [bbox[2], bbox[3]],
    ],
    fitBoundsOptions: { padding: 30 },
    dragRotate: false,
    pitchWithRotate: false,
    attributionControl: { compact: true },
  });
  map.touchZoomRotate.disableRotation();

  const css = getComputedStyle(document.documentElement);
  const stopTheme = followTheme(map, () => {
    const lines = splitDays(track.t, track.lat.length).map(({ start, end }) => {
      const line: [number, number][] = [];
      for (let i = start; i <= end; i++)
        line.push([track.lon[i] as number, track.lat[i] as number]);
      return line;
    });
    map.addSource('track', {
      type: 'geojson',
      data: {
        type: 'Feature',
        properties: {},
        geometry: { type: 'MultiLineString', coordinates: lines },
      },
    });
    map.addLayer({
      id: 'track',
      type: 'line',
      source: 'track',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': css.getPropertyValue('--color-accent').trim(), 'line-width': 4 },
    });
  });

  let markers: Marker[] = [];
  function setMarkers(list: ReviewMarker[]): void {
    markers.forEach((m) => m.remove());
    markers = list.map((item, i) => {
      const el = h(
        'button',
        {
          type: 'button',
          class: `review-marker${item.existing ? ' existing' : ''}`,
          'aria-label': `Точка ${item.label}`,
        },
        item.label,
      );
      el.addEventListener('click', () => onMarkerClick(i));
      const p = pointAt(track, item.pos);
      return new Marker({ element: el, anchor: 'center' }).setLngLat([p.lon, p.lat]).addTo(map);
    });
  }

  return {
    setMarkers,
    destroy() {
      stopTheme();
      map.remove();
    },
  };
}
