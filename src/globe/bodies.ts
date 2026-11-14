import { Ellipsoid } from 'cesium';
import type { Body } from '../contract/types';

/**
 * Mars: IAU 2015 reference radii (equatorial 3396.19 km, polar 3376.20 km) — identical to
 * Cesium.Ellipsoid.MARS, built explicitly so the values are visible and reviewable here.
 */
export const MARS_ELLIPSOID = new Ellipsoid(3_396_190.0, 3_396_190.0, 3_376_200.0);

export const ELLIPSOIDS: Record<Body, Ellipsoid> = {
  earth: Ellipsoid.WGS84,
  moon: Ellipsoid.MOON,
  mars: MARS_ELLIPSOID,
};

export interface BodyMeta {
  label: string;
  /** Default camera: lon/lat in degrees, height in metres above the ellipsoid. */
  home: { lon: number; lat: number; height: number };
}

export const BODY_META: Record<Body, BodyMeta> = {
  earth: { label: 'Earth', home: { lon: 10, lat: 20, height: 22_000_000 } },
  moon: { label: 'Moon', home: { lon: 20, lat: -10, height: 6_500_000 } },
  mars: { label: 'Mars', home: { lon: 80, lat: 10, height: 12_000_000 } },
};

export const BODIES: readonly Body[] = ['earth', 'moon', 'mars'];
