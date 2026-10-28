// Приближение фото в просмотре: щипок, двойной тап, колесо. Чистые функции без DOM.
// Координаты — от центра сцены: точка картинки p (от её центра) на экране = t + s·p.

export interface Zoom {
  /** Масштаб, 1 — фото целиком. */
  s: number;
  /** Сдвиг центра картинки от центра сцены, px. */
  x: number;
  y: number;
}

export const MIN_SCALE = 1;
export const MAX_SCALE = 5;
/** Двойной тап приближает до стольких. */
export const DOUBLE_TAP_SCALE = 2.5;

export const NO_ZOOM: Zoom = { s: 1, x: 0, y: 0 };

/** Размеры: картинка без приближения и сцена, px. */
export interface Box {
  w: number;
  h: number;
  stageW: number;
  stageH: number;
}

/** Не дать увести картинку: край приближенного фото не отходит от края сцены. */
export function clampZoom(z: Zoom, box: Box): Zoom {
  const s = Math.min(Math.max(z.s, MIN_SCALE), MAX_SCALE);
  const maxX = Math.max(0, (box.w * s - box.stageW) / 2);
  const maxY = Math.max(0, (box.h * s - box.stageH) / 2);
  return {
    s,
    // + 0: без «-0», когда двигать некуда.
    x: Math.min(Math.max(z.x, -maxX), maxX) + 0,
    y: Math.min(Math.max(z.y, -maxY), maxY) + 0,
  };
}

/**
 * Масштаб `s` вокруг экранной точки (cx, cy) — от центра сцены: точка картинки под ней
 * остаётся под ней. Так работают и колесо, и двойной тап.
 */
export function zoomAt(z: Zoom, s: number, cx: number, cy: number, box: Box): Zoom {
  const k = Math.min(Math.max(s, MIN_SCALE), MAX_SCALE) / z.s;
  return clampZoom({ s: z.s * k, x: cx - (cx - z.x) * k, y: cy - (cy - z.y) * k }, box);
}

/**
 * Щипок: от состояния в начале жеста `start`, когда пальцы были на расстоянии d0 с серединой
 * (m0x, m0y), к текущим d и (mx, my). Точка картинки под серединой пальцев едет вместе с ней.
 */
export function pinch(
  start: Zoom,
  d0: number,
  m0x: number,
  m0y: number,
  d: number,
  mx: number,
  my: number,
  box: Box,
): Zoom {
  const s = Math.min(Math.max(start.s * (d / d0), MIN_SCALE), MAX_SCALE);
  const px = (m0x - start.x) / start.s;
  const py = (m0y - start.y) / start.s;
  return clampZoom({ s, x: mx - s * px, y: my - s * py }, box);
}

/** Двойной тап: приближено — вернуть целиком, иначе приблизить в эту точку. */
export function doubleTap(z: Zoom, cx: number, cy: number, box: Box): Zoom {
  return z.s > MIN_SCALE ? NO_ZOOM : zoomAt(z, DOUBLE_TAP_SCALE, cx, cy, box);
}
