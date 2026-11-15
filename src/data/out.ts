// Real pipeline output (the `out/` folder from analoglens, published to public/data/ by
// `npm run data:publish`). Same JSON as the frozen API contract in README.md.
// Guards are shared with tools/scripts/publish-data.ts. Synthetic output is always refused.

export interface Manifest {
  generated: string;
  synthetic: boolean;
  embedder: string;
  res_m: number;
  tile_px: number;
  earth_tiles: number;
  targets: string[];
  novelty_km: number;
}
export interface RankResult {
  rank: number;
  tile_id: string;
  lat: number;
  lon: number;
  score: number;
  coverage: number;
  dims: Record<string, number | null>;
  novel: boolean;
  nearest_known: string | null;
  nearest_known_km: number | null;
}
export interface RankFile {
  target: string;
  task: string;
  synthetic: boolean;
  results: RankResult[];
}
export interface CardBar {
  dimension: string;
  label: string;
  weight: number;
  score: number | null;
  status: string;
  earth_value?: number | null;
  target_value?: number | null;
  unit?: string;
  note?: string;
}
export interface CardBreak {
  dimension: string;
  kind: 'data' | 'unreachable' | 'fixed';
  text: string;
}
export interface Card {
  tile_id: string;
  target: string;
  target_label: string;
  task: string;
  task_label: string;
  score: number;
  strong_for: string[];
  bars: CardBar[];
  breaks: CardBreak[];
  tests: string[];
  nearest_known: { name: string | null; km: number | null; novel: boolean };
  images: { earth?: string; target?: string };
  synthetic: boolean;
}
export interface ValidationFile {
  synthetic: boolean;
  results: Record<
    string,
    {
      auc: number | null;
      n_positive: number;
      known_sites: { site: string; best_score: number; percentile: number; top_percent: number }[];
    }
  >;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';

export class ContractError extends Error {}

function need(cond: boolean, file: string, what: string): asserts cond {
  if (!cond) throw new ContractError(`${file}: ${what}`);
}

/** Every published file must be real: `synthetic` present and false. */
function real(o: Obj, file: string): void {
  need(o.synthetic === false, file, 'refused: "synthetic" must be false (no sample_out or demo numbers)');
}

export function checkManifest(v: unknown, file = 'manifest.json'): Manifest {
  need(isObj(v), file, 'not an object');
  real(v, file);
  need(isStr(v.generated), file, '"generated" must be a timestamp string');
  need(Array.isArray(v.targets) && v.targets.every(isStr), file, '"targets" must be a list of keys');
  need(isNum(v.earth_tiles), file, '"earth_tiles" must be a number');
  return v as unknown as Manifest;
}

export function checkRank(v: unknown, file: string): RankFile {
  need(isObj(v), file, 'not an object');
  real(v, file);
  need(isStr(v.target) && isStr(v.task), file, '"target" and "task" are required');
  need(Array.isArray(v.results), file, '"results" must be a list');
  v.results.forEach((r, i) => {
    need(isObj(r), file, `results[${i}] not an object`);
    need(isStr(r.tile_id) && isNum(r.rank) && isNum(r.score), file, `results[${i}] needs tile_id, rank, score`);
    need(isNum(r.lat) && Math.abs(r.lat) <= 90 && isNum(r.lon) && Math.abs(r.lon) <= 180, file, `results[${i}] bad lat/lon`);
    need(r.score >= 0 && r.score <= 1, file, `results[${i}] score outside 0-1`);
  });
  return v as unknown as RankFile;
}

export function checkCard(v: unknown, file: string): Card {
  need(isObj(v), file, 'not an object');
  real(v, file);
  need(isStr(v.tile_id) && isNum(v.score), file, 'needs tile_id and score');
  need(Array.isArray(v.bars) && Array.isArray(v.breaks) && Array.isArray(v.tests), file, 'needs bars, breaks, tests');
  need(isObj(v.images) && isObj(v.nearest_known), file, 'needs images and nearest_known');
  return v as unknown as Card;
}

export function checkValidation(v: unknown, file = 'validation.json'): ValidationFile {
  need(isObj(v), file, 'not an object');
  real(v, file);
  need(isObj(v.results), file, '"results" must be an object');
  return v as unknown as ValidationFile;
}

/* ------------------------------------------------------------------ loading */

export type OutState =
  | { kind: 'absent' } // nothing published yet: the page says so, shows no numbers
  | { kind: 'invalid'; error: string }
  | { kind: 'ready'; manifest: Manifest; validation: ValidationFile | null };

/** Resolved on use: this module is also imported by the Node publish script, which has no Vite env. */
const base = (): string => `${import.meta.env.BASE_URL}data/`;

async function getJson(path: string): Promise<unknown> {
  const res = await fetch(base() + path);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function loadOut(): Promise<OutState> {
  let manifest: Manifest;
  try {
    const res = await fetch(`${base()}manifest.json`);
    if (res.status === 404 || !(res.headers.get('content-type') ?? '').includes('json')) return { kind: 'absent' };
    manifest = checkManifest(await res.json());
  } catch (err) {
    return err instanceof ContractError ? { kind: 'invalid', error: err.message } : { kind: 'absent' };
  }
  let validation: ValidationFile | null = null;
  try {
    validation = checkValidation(await getJson('validation.json'));
  } catch (err) {
    if (err instanceof ContractError) return { kind: 'invalid', error: err.message };
  }
  return { kind: 'ready', manifest, validation };
}

const rankCache = new Map<string, Promise<RankFile | null>>();
/** Ranked Earth tiles for one target x task; null when that combination was not run. */
export function loadRank(target: string, task: string): Promise<RankFile | null> {
  const key = `${target}__${task}`;
  let p = rankCache.get(key);
  if (!p) {
    p = getJson(`rank/${key}.json`).then(
      (v) => checkRank(v, `rank/${key}.json`),
      () => null,
    );
    rankCache.set(key, p);
  }
  return p;
}

export async function loadCard(target: string, task: string, tileId: string): Promise<Card | null> {
  const file = `cards/${target}__${task}__${tileId}.json`;
  try {
    return checkCard(await getJson(file), file);
  } catch {
    return null; // cards exist only for the top N of each list
  }
}

/** Card image paths start with "/img/"; they live under data/. */
export const imageUrl = (p: string): string => base() + p.replace(/^\//, '');
