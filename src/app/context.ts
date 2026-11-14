import type { DataSet, EarthCandidate, Target, Weights } from '../contract/types';
import { rankCandidates, type Ranked } from '../rank/ranking';
import type { Store } from './state';

export interface RankedRow extends Ranked {
  candidate: EarthCandidate;
  /** Rank in the exported analogs_<target>.geojson (pipeline default weights). */
  pipelineRank: number | null;
}

export interface Ctx {
  data: DataSet;
  store: Store;
  target(id: string): Target;
  candidate(id: string): EarthCandidate | undefined;
  /** Live re-ranking of the target's pool with the given (or current) weights. */
  rank(targetId: string, weights?: Weights): RankedRow[];
  /** Best-ranked candidate that is not a known analog. */
  topNewCandidate(targetId: string, weights?: Weights): RankedRow | undefined;
}

export function createCtx(data: DataSet, store: Store): Ctx {
  const targets = new Map(data.targets.targets.map((t) => [t.id, t]));
  const candidates = new Map(data.candidates.candidates.map((c) => [c.id, c]));
  const cache = new Map<string, RankedRow[]>();

  const rank = (targetId: string, weights: Weights = store.get().weights): RankedRow[] => {
    const key = `${targetId}|${JSON.stringify(weights)}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const target = targets.get(targetId);
    if (!target) return [];
    const pool = (data.candidates.per_target[targetId] ?? [])
      .map((id) => candidates.get(id))
      .filter((c): c is EarthCandidate => !!c);
    const pipeline = new Map(
      data.analogs[targetId]?.features.map((f) => [f.properties.candidate_id, f.properties.rank]) ?? [],
    );
    const rows = rankCandidates(
      target.features,
      pool,
      weights,
      data.candidates.feature_scales,
      data.candidates.ndvi_threshold,
    ).map((r) => ({ ...r, candidate: candidates.get(r.id)!, pipelineRank: pipeline.get(r.id) ?? null }));
    if (cache.size > 64) cache.clear();
    cache.set(key, rows);
    return rows;
  };

  return {
    data,
    store,
    target: (id) => {
      const t = targets.get(id);
      if (!t) throw new Error(`unknown target ${id}`);
      return t;
    },
    candidate: (id) => candidates.get(id),
    rank,
    topNewCandidate: (targetId, weights) =>
      rank(targetId, weights).find((r) => r.rank != null && !r.candidate.known_analog_id),
  };
}
