// Regions (dotted areas on a body) and the links between them, derived from the real config.
// Links are relationships the team documented, never scores:
//   - "tag":       a known analog site whose `known_for` shares a specific tag with the target's
//                  `validation_tags` (same rule the pipeline uses to validate; generic body tags
//                  like "mars"/"moon" are ignored, see DECISIONS.md)
//   - "published": an Egypt deep-dive site whose `analog_for` names the target
//   - "ranked":    a ranked tile from the real pipeline output (added at runtime)
import {
  EGYPT_SITES,
  KNOWN_SITES,
  TARGETS,
  egyptIsApproximate,
  targetNeedsVerify,
  type Body,
  type TargetConfig,
} from './config';
import type { RankResult } from './out';

export type RegionKind = 'target' | 'known' | 'egypt' | 'ranked';

export interface Region {
  id: string;
  kind: RegionKind;
  body: Body;
  name: string;
  lat: number;
  lon: number;
  /** Angular radius of the dotted area, degrees. */
  radiusDeg: number;
  note: string;
  approximate: boolean;
  targetKey?: string;
  rank?: RankResult & { task: string };
}

export interface Link {
  from: string; // target region id
  to: string; // Earth region id
  kind: 'tag' | 'published' | 'ranked';
  why: string;
}

const GENERIC_TAGS = new Set(['mars', 'moon']);
const slug = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');

export const targetRegionId = (key: string): string => `target_${key}`;

export interface Graph {
  regions: Region[];
  links: Link[];
  /** Targets the config defines but without coordinates yet (shown in About, not on a globe). */
  pendingTargets: TargetConfig[];
}

export function buildGraph(): Graph {
  const regions: Region[] = [];
  const links: Link[] = [];
  const pendingTargets: TargetConfig[] = [];

  const placed = TARGETS.filter((t) => {
    if (t.lat == null || t.lon == null) {
      pendingTargets.push(t);
      return false;
    }
    return true;
  });

  for (const t of placed) {
    regions.push({
      id: targetRegionId(t.key),
      kind: 'target',
      body: t.body,
      name: t.label,
      lat: t.lat!,
      lon: t.lon!,
      radiusDeg: t.body === 'moon' ? 7 : 6,
      note: t.coords_source,
      approximate: targetNeedsVerify(t),
      targetKey: t.key,
    });
  }

  for (const s of KNOWN_SITES) {
    const id = `known_${slug(s.name)}`;
    regions.push({
      id,
      kind: 'known',
      body: 'earth',
      name: s.name,
      lat: s.lat,
      lon: s.lon,
      radiusDeg: 2.6,
      note: `Known analog site: ${s.known_for.join(', ').replace(/_/g, ' ')}`,
      approximate: true,
    });
    for (const t of placed) {
      const shared = s.known_for.filter((tag) => !GENERIC_TAGS.has(tag) && t.validation_tags.includes(tag));
      if (shared.length)
        links.push({ from: targetRegionId(t.key), to: id, kind: 'tag', why: shared.join(', ').replace(/_/g, ' ') });
    }
  }

  for (const s of EGYPT_SITES) {
    const id = `egypt_${slug(s.name)}`;
    regions.push({
      id,
      kind: 'egypt',
      body: 'earth',
      name: s.name,
      lat: s.lat,
      lon: s.lon,
      radiusDeg: 2.2,
      note: s.note,
      approximate: egyptIsApproximate(s),
    });
    for (const key of s.analog_for) {
      if (placed.some((t) => t.key === key))
        links.push({ from: targetRegionId(key), to: id, kind: 'published', why: s.note });
    }
  }

  return { regions, links, pendingTargets };
}

/** Ranked tiles for one target x task, as Earth regions linked to the target. */
export function rankedRegions(targetKey: string, task: string, results: RankResult[], limit = 50): Graph {
  const regions: Region[] = [];
  const links: Link[] = [];
  for (const r of results.slice(0, limit)) {
    const id = `ranked_${targetKey}_${task}_${r.tile_id}`;
    regions.push({
      id,
      kind: 'ranked',
      body: 'earth',
      name: `Tile ${r.tile_id}`,
      lat: r.lat,
      lon: r.lon,
      radiusDeg: 1.1,
      note: r.novel ? 'Candidate new analog' : `Near known analog: ${r.nearest_known ?? 'unknown'}`,
      approximate: false,
      targetKey,
      rank: { ...r, task },
    });
    links.push({ from: targetRegionId(targetKey), to: id, kind: 'ranked', why: `rank ${r.rank}` });
  }
  return { regions, links, pendingTargets: [] };
}

export const linksOf = (links: Link[], id: string): Link[] => links.filter((l) => l.from === id || l.to === id);
