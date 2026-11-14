import type { Body } from './sources';

/** Primary imagery per body (ids in sources.ts). Also the source of the local fallback tiles. */
export const PRIMARY_SOURCE: Record<Body, string> = {
  earth: 'gibs_bluemarble',
  moon: 'trek_moon_lro_wac',
  mars: 'trek_mars_viking',
};

/** Local fallback tiles live in public/basemaps/<id>/{z}/{y}/{x}.<ext> (npm run fetch:basemaps). */
export const FALLBACK_MAX_LEVEL = 2;
