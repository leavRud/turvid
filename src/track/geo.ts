// Геометрия на сфере: расстояние и проекция в локальные метры.

const EARTH_RADIUS_M = 6_371_008.8;
const RAD = Math.PI / 180;

/** Расстояние по формуле гаверсинуса, м. */
export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * RAD;
  const dLon = (lon2 - lon1) * RAD;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Равнопромежуточная проекция вокруг широты `lat0`: градусы → метры. Годится на десятки км. */
export function localProjection(lat0: number): (lat: number, lon: number) => [number, number] {
  const ky = EARTH_RADIUS_M * RAD;
  const kx = ky * Math.cos(lat0 * RAD);
  return (lat, lon) => [lon * kx, lat * ky];
}
