// Подложка OpenFreeMap под текущую тему; при смене темы карта меняет стиль без перезагрузки.

import type { Map as MapLibreMap } from 'maplibre-gl';
import { isDarkTheme, onThemeChange } from '../ui/theme';

const STYLE_LIGHT = 'https://tiles.openfreemap.org/styles/liberty';
const STYLE_DARK = 'https://tiles.openfreemap.org/styles/dark';

export function mapStyleUrl(): string {
  return isDarkTheme() ? STYLE_DARK : STYLE_LIGHT;
}

/**
 * Свои слои (трек и т. п.) добавляются на каждой загрузке стиля: setStyle их стирает.
 * Возвращает отписку от смены темы.
 */
export function followTheme(map: MapLibreMap, addLayers: () => void): () => void {
  map.on('style.load', addLayers);
  let current = mapStyleUrl();
  return onThemeChange(() => {
    const next = mapStyleUrl();
    if (next === current) return;
    current = next;
    map.setStyle(next, { diff: false });
  });
}
