// Высота: сглаживание, набор, проверка надёжности.

import { haversine } from './geo';

export const MEDIAN_WINDOW = 15;
export const GAIN_THRESHOLD_M = 5;
/** Ниже этого высота считается ненадёжной (уплывший барометр), м. */
export const MIN_PLAUSIBLE_ELE_M = -50;
/** Конец ушёл от начала больше чем на столько при близких координатах — ненадёжно, м. */
export const MAX_LOOP_DRIFT_M = 50;
/** «Близкие координаты» начала и конца, м. */
export const LOOP_RADIUS_M = 500;

/** Скользящая медиана по `window` точкам (у краёв окно укорачивается). */
export function medianSmooth(values: number[], window = MEDIAN_WINDOW): number[] {
  const half = Math.floor(window / 2);
  const out = new Array<number>(values.length);
  const buf: number[] = [];
  for (let i = 0; i < values.length; i++) {
    buf.length = 0;
    const from = Math.max(0, i - half);
    const to = Math.min(values.length - 1, i + half);
    for (let j = from; j <= to; j++) buf.push(values[j] as number);
    buf.sort((a, b) => a - b);
    const mid = buf.length >> 1;
    out[i] =
      buf.length % 2 ? (buf[mid] as number) : ((buf[mid - 1] as number) + (buf[mid] as number)) / 2;
  }
  return out;
}

/**
 * Набор высоты с порогом: подъём засчитывается, только когда высота выросла
 * на `threshold` от последнего минимума; спуск фиксируется так же — на `threshold` от максимума.
 */
export function elevationGain(ele: number[], threshold = GAIN_THRESHOLD_M): number {
  const first = ele[0];
  if (first === undefined) return 0;
  let gain = 0;
  let low = first;
  let high = first;
  let climbing = false;
  for (const e of ele) {
    if (climbing) {
      if (e > high) high = e;
      else if (e < high - threshold) {
        gain += high - low;
        climbing = false;
        low = e;
      }
    } else if (e < low) {
      low = e;
    } else if (e >= low + threshold) {
      climbing = true;
      high = e;
    }
  }
  if (climbing) gain += high - low;
  return gain;
}

/** Высота ненадёжна: ушла ниже −50 м или петля «вернулась» на другую высоту. */
export function isElevationUnreliable(ele: number[], lat: number[], lon: number[]): boolean {
  if (!ele.length) return false;
  if (ele.some((e) => e < MIN_PLAUSIBLE_ELE_M)) return true;
  const last = ele.length - 1;
  const loop =
    haversine(lat[0] as number, lon[0] as number, lat[last] as number, lon[last] as number) <
    LOOP_RADIUS_M;
  return loop && Math.abs((ele[last] as number) - (ele[0] as number)) > MAX_LOOP_DRIFT_M;
}
