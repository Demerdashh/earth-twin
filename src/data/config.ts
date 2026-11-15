// The team's real configuration (config/*.json), bundled at build time. This is the single
// source for targets, known analog sites, Egypt deep-dive sites, body limits and imagery.
// Nothing here is a score: scores only ever come from the pipeline output (see out.ts).
import bodiesJson from '../../config/bodies.json';
import dimensionsJson from '../../config/dimensions.json';
import egyptJson from '../../config/egypt_candidates.json';
import imageryJson from '../../config/imagery.json';
import knownJson from '../../config/known_analogs.json';
import targetsJson from '../../config/targets.json';
import tasksJson from '../../config/tasks.json';

export type Body = 'earth' | 'moon' | 'mars';
export const BODIES: readonly Body[] = ['moon', 'earth', 'mars'];

export interface TargetConfig {
  key: string;
  label: string;
  body: 'moon' | 'mars';
  lat: number | null;
  lon: number | null;
  coords_source: string;
  tasks: string[];
  validation_tags: string[];
  profile_source?: string;
}

export interface SiteConfig {
  name: string;
  lat: number;
  lon: number;
}
export interface KnownSite extends SiteConfig {
  known_for: string[];
}
export interface EgyptSite extends SiteConfig {
  analog_for: string[];
  note: string;
}
export interface TaskConfig {
  label: string;
  weights: Record<string, number>;
  tests: string[];
}
export interface ImageryLayer {
  product: string;
  provider: string;
  credit: string;
  url: string;
  capabilities: string;
  scheme: 'geographic' | 'webmercator';
  max_level: number;
}

const stripAbout = <T>(o: Record<string, unknown>): Record<string, T> =>
  Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith('_'))) as Record<string, T>;

export const TARGETS: TargetConfig[] = Object.entries(
  stripAbout<Omit<TargetConfig, 'key'>>(targetsJson as Record<string, unknown>),
).map(([key, t]) => ({ key, ...t }));

export const KNOWN_SITES: KnownSite[] = (knownJson as { sites: KnownSite[] }).sites;
export const EGYPT_SITES: EgyptSite[] = (egyptJson as { sites: EgyptSite[] }).sites;
export const TASKS: Record<string, TaskConfig> = stripAbout<TaskConfig>(tasksJson);
export const DIMENSIONS = stripAbout<{ label: string; unit: string }>(dimensionsJson);
export const BODY_LIMITS = bodiesJson as Record<
  'moon' | 'mars',
  { label: string; limits: { name: string; text: string }[] }
>;
export const IMAGERY = stripAbout<{ color: ImageryLayer; shade?: ImageryLayer }>(imageryJson) as Record<
  Body,
  { color: ImageryLayer; shade?: ImageryLayer }
>;

/** Coordinates the team flagged as approximate or to be verified before presenting. */
export const KNOWN_SITES_APPROXIMATE = true; // known_analogs.json: "Coordinates are APPROXIMATE"
export const egyptIsApproximate = (s: EgyptSite): boolean => s.name !== 'Kamil Crater'; // only Kamil is from a paper
export const targetNeedsVerify = (t: TargetConfig): boolean => /VERIFY/.test(t.coords_source);

export const BODY_LABEL: Record<Body, string> = { earth: 'Earth', moon: 'Moon', mars: 'Mars' };
