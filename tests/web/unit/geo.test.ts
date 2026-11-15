import { describe, expect, it } from 'vitest';
import { angularDistanceDeg, latLonToVec3, vec3ToLatLon, zoomForSpan } from '../../../src/scene/geo';

describe('sphere mapping (matches three SphereGeometry UVs)', () => {
  it('puts the poles on +Y/-Y and lon 0 on +X, lon 90E on -Z', () => {
    expect(latLonToVec3(90, 0).y).toBeCloseTo(1);
    expect(latLonToVec3(-90, 0).y).toBeCloseTo(-1);
    expect(latLonToVec3(0, 0).x).toBeCloseTo(1);
    expect(latLonToVec3(0, 90).z).toBeCloseTo(-1);
  });

  it('round-trips lat/lon', () => {
    for (const [lat, lon] of [
      [25.45, 30.55],
      [-89.67, 129.78],
      [11, -159],
    ] as const) {
      const back = vec3ToLatLon(latLonToVec3(lat, lon, 0.62));
      expect(back.lat).toBeCloseTo(lat, 6);
      expect(back.lon).toBeCloseTo(lon, 6);
    }
  });

  it('measures great-circle angles', () => {
    expect(angularDistanceDeg(0, 0, 0, 90)).toBeCloseTo(90);
    expect(angularDistanceDeg(10, 20, 10, 20)).toBe(0);
  });

  it('picks a tile zoom that covers a region with a few tiles', () => {
    expect(zoomForSpan(6, 'geographic', 7)).toBe(6);
    expect(zoomForSpan(6, 'webmercator', 8)).toBe(7);
    expect(zoomForSpan(0.001, 'geographic', 5)).toBe(5);
  });
});
