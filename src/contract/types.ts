// TypeScript view of the data contract (CLAUDE.md, schemas/). Runtime validation is in src/data/validate.ts.

export type Body = 'earth' | 'moon' | 'mars';
export type PlanetaryBody = 'moon' | 'mars';

export const COMPARABLE_FEATURES = [
  'elevation_m',
  'slope_deg',
  'roughness',
  'temp_range_k',
  'mineral_index',
  'ice_indicator',
] as const;
export type ComparableFeature = (typeof COMPARABLE_FEATURES)[number];
export type EarthFeature = ComparableFeature | 'ndvi';
export const EARTH_FEATURES: readonly EarthFeature[] = [...COMPARABLE_FEATURES, 'ndvi'];

export type FeatureValues = Partial<Record<EarthFeature, number | null>>;
export type Weights = Record<ComparableFeature, number>;
export type Scales = Record<ComparableFeature, number>;

export interface FeatureMeta {
  label: string;
  unit: string;
  digits: number;
}
export const FEATURE_META: Record<EarthFeature, FeatureMeta> = {
  elevation_m: { label: 'Elevation', unit: 'm', digits: 0 },
  slope_deg: { label: 'Slope', unit: '°', digits: 1 },
  roughness: { label: 'Roughness', unit: 'm', digits: 0 },
  temp_range_k: { label: 'Thermal range', unit: 'K', digits: 0 },
  mineral_index: { label: 'Mafic index', unit: '', digits: 2 },
  ice_indicator: { label: 'Water/ice indicator', unit: '', digits: 2 },
  ndvi: { label: 'NDVI', unit: '', digits: 2 },
};

export interface Header {
  schema_version: '1.0';
  mock: boolean;
  note?: string;
  generated_at: string;
  generator: string;
}

export interface Target {
  id: string;
  name: string;
  body: PlanetaryBody;
  lat: number;
  lon: number;
  radius_km: number;
  description: string;
  coords_verified: boolean;
  features: Record<ComparableFeature, number | null>;
  provenance: Partial<Record<EarthFeature, string>>;
}
export interface TargetsFile extends Header {
  targets: Target[];
}

export interface EarthCandidate {
  id: string;
  name: string;
  lat: number;
  lon: number;
  region: string;
  country: string | null;
  known_analog_id: string | null;
  coords_verified: boolean;
  features: Record<EarthFeature, number | null>;
  provenance: Partial<Record<EarthFeature, string>>;
}
export interface EarthCandidatesFile extends Header {
  feature_scales: Scales;
  default_weights: Weights;
  ndvi_threshold: number;
  candidates: EarthCandidate[];
  per_target: Record<string, string[]>;
}

export interface AnalogFeature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: {
    candidate_id: string;
    name: string;
    rank: number | null;
    score: number;
    distance: number;
    known_analog_id: string | null;
    excluded_by_vegetation: boolean;
  };
}
export interface AnalogsFile extends Header {
  type: 'FeatureCollection';
  target_id: string;
  weights: Weights;
  features: AnalogFeature[];
}

export interface DatasetRecord {
  id: string;
  body: Body;
  source: string;
  product: string;
  resolution: string;
  date: string;
  processing_steps: string[];
  url: string | null;
  verified: boolean;
  mock: boolean;
}
export interface ProvenanceFile extends Header {
  datasets: DatasetRecord[];
  runs: {
    run_id: string;
    mode: 'mock' | 'real';
    started_at: string;
    config_sha256: string;
    seed: number | null;
    outputs: string[];
  }[];
}

export interface KnownAnalog {
  id: string;
  name: string;
  lat: number;
  lon: number;
  analog_for: PlanetaryBody[];
  coords_verified: boolean;
  note: string;
}
export interface KnownAnalogsFile extends Header {
  analogs: KnownAnalog[];
}

export interface ValidationEntry {
  known_analog_id: string;
  name: string;
  rank: number | null;
  matched_candidate_id: string | null;
  match_distance_km: number | null;
}
export interface ValidationReportFile extends Header {
  match_radius_km: number;
  targets: Record<string, { pool_size: number; entries: ValidationEntry[] }>;
}

export interface GridFile extends Header {
  body: Body;
  step_deg: number;
  columns: EarthFeature[];
  cells: (number | null)[][];
  provenance: Partial<Record<EarthFeature, string>>;
}

export type OverlayKind = 'similarity' | 'vegetation' | 'water_ice';
export interface Overlay {
  id: string;
  kind: OverlayKind;
  body: Body;
  target_id: string | null;
  file: string;
  bounds: { west: number; south: number; east: number; north: number };
  width: number;
  height: number;
  value_min: number;
  value_max: number;
  units: string;
  label: string;
  colormap: 'similarity' | 'vegetation_exclusion' | 'water_ice';
  provenance_ids: string[];
}

export interface ManifestFile extends Header {
  files: {
    targets: string;
    earth_candidates: string;
    provenance: string;
    known_analogs: string;
    validation_report: string;
  };
  analogs: Record<string, string>;
  grids: Partial<Record<Body, string>>;
  overlays: Overlay[];
}

/** Everything the app needs, loaded and validated. */
export interface DataSet {
  baseUrl: string;
  mock: boolean;
  manifest: ManifestFile;
  targets: TargetsFile;
  candidates: EarthCandidatesFile;
  provenance: ProvenanceFile;
  knownAnalogs: KnownAnalogsFile;
  validation: ValidationReportFile;
  analogs: Record<string, AnalogsFile>;
  grids: Partial<Record<Body, GridFile>>;
}
