/** 地理計算。近傍駅の候補出しに使う。 */

export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_M = 6371008.8;

/** 2 点間の大円距離（メートル）。 */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface WithDistance<T> {
  item: T;
  distanceMeters: number;
}

/**
 * 近い順に並べて返す。
 * `maxDistanceMeters` を超えるものは落とす（既定 2km: 徒歩圏を大きめに取る）。
 */
export function nearest<T extends LatLng>(
  origin: LatLng,
  items: readonly T[],
  options: { limit?: number; maxDistanceMeters?: number } = {},
): WithDistance<T>[] {
  const { limit = 10, maxDistanceMeters = 2000 } = options;

  return items
    .map((item) => ({ item, distanceMeters: distanceMeters(origin, item) }))
    .filter((entry) => entry.distanceMeters <= maxDistanceMeters)
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, limit);
}

/** 「320m」「1.2km」のような短い表記。G2 の狭い画面向け。 */
export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters / 10) * 10}m`;
  return `${(meters / 1000).toFixed(1)}km`;
}
