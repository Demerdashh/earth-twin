import { Vector3 } from 'three';

const D2R = Math.PI / 180;

/**
 * Body-local position for lat/lon on a sphere of radius r, matching how three's SphereGeometry
 * maps an equirectangular texture (u = 0 at lon -180, lon 0 on +X, lon +90 on -Z, north on +Y).
 */
export function latLonToVec3(lat: number, lon: number, r = 1, out = new Vector3()): Vector3 {
  const la = lat * D2R;
  const lo = lon * D2R;
  return out.set(r * Math.cos(la) * Math.cos(lo), r * Math.sin(la), -r * Math.cos(la) * Math.sin(lo));
}

export function vec3ToLatLon(v: Vector3): { lat: number; lon: number } {
  const r = v.length() || 1;
  return { lat: Math.asin(Math.max(-1, Math.min(1, v.y / r))) / D2R, lon: Math.atan2(-v.z, v.x) / D2R };
}

/** Great-circle angle between two lat/lon points, degrees. */
export function angularDistanceDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = lat1 * D2R;
  const p2 = lat2 * D2R;
  const a = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(((lon2 - lon1) * D2R) / 2) ** 2;
  return (2 * Math.asin(Math.min(1, Math.sqrt(a)))) / D2R;
}

/** Tile zoom so that roughly `tilesAcross` tiles cover a region `spanDeg` wide. */
export function zoomForSpan(
  spanDeg: number,
  scheme: 'geographic' | 'webmercator',
  maxLevel: number,
  tilesAcross = 3,
): number {
  const fullSpan = scheme === 'geographic' ? 180 : 360; // degrees of longitude per tile at zoom 0
  const z = Math.round(Math.log2((fullSpan * tilesAcross) / Math.max(spanDeg, 0.01)));
  return Math.max(1, Math.min(maxLevel, z));
}

export const easeInOutCubic = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
