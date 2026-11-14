import type { Ctx } from '../app/context';
import type { Selection } from '../app/state';
import {
  COMPARABLE_FEATURES,
  EARTH_FEATURES,
  FEATURE_META,
  type ComparableFeature,
  type EarthFeature,
  type FeatureValues,
  type Target,
} from '../contract/types';
import { sampleGrid } from '../data/grid';
import { distance } from '../rank/ranking';
import { BODY_META } from '../globe/bodies';
import { h } from './dom';
import { fmtCoord, fmtScore, fmtValue, provenanceLabel } from './format';

export function statusBadge(knownAnalogId: string | null, ctx: Ctx): HTMLElement {
  if (knownAnalogId) {
    const k = ctx.data.knownAnalogs.analogs.find((a) => a.id === knownAnalogId);
    return h('span', { class: 'tag tag-known', title: k ? `${k.name} — ${k.note}` : '' }, 'Known analog');
  }
  return h('span', { class: 'tag tag-new' }, 'Our result, not NASA-validated');
}

function valuesTable(
  ctx: Ctx,
  values: FeatureValues,
  provenance: Partial<Record<EarthFeature, string>>,
  features: readonly EarthFeature[],
): HTMLElement {
  return h(
    'table',
    { class: 'values' },
    h('caption', { class: 'sr-only' }, 'Feature values'),
    h(
      'tbody',
      {},
      ...features.map((f) =>
        h(
          'tr',
          {},
          h('th', { scope: 'row' }, FEATURE_META[f].label),
          h(
            'td',
            { class: 'num', title: `Source: ${provenanceLabel(ctx.data, provenance[f])}` },
            fmtValue(f, values[f]),
          ),
        ),
      ),
    ),
  );
}

/** Bar view: per-feature difference from the target, in fixed physical scale units. */
function comparison(ctx: Ctx, target: Target, values: FeatureValues): HTMLElement {
  const { weights } = ctx.store.get();
  const scales = ctx.data.candidates.feature_scales;
  const { d } = distance(target.features, values, weights, scales);
  const rows = COMPARABLE_FEATURES.map((f: ComparableFeature) => {
    const t = target.features[f];
    const v = values[f];
    const used = weights[f] > 0 && t != null && v != null;
    const z = used ? Math.abs((v - t) / scales[f]) : null;
    const pct = z == null ? 0 : Math.min(100, (z / 3) * 100);
    return h(
      'li',
      { class: `cmp-row${used ? '' : ' cmp-off'}` },
      h('span', { class: 'cmp-label' }, FEATURE_META[f].label),
      h(
        'span',
        {
          class: 'cmp-bar',
          role: 'img',
          'aria-label': z == null ? 'not compared' : `${z.toFixed(2)} scale units apart`,
        },
        h('span', {
          class: 'cmp-fill',
          style: `width:${pct}%;` + (z != null && z > 1.5 ? 'background:var(--warn)' : ''),
        }),
      ),
      h(
        'span',
        { class: 'cmp-vals num' },
        used ? `${fmtValue(f, v)} vs ${fmtValue(f, t)}` : weights[f] > 0 ? 'no data' : 'weight 0',
      ),
    );
  });
  return h(
    'section',
    { class: 'cmp', 'aria-label': `Fingerprint compared with ${target.name}` },
    h('h4', {}, `Compared with ${target.name}`),
    h(
      'p',
      { class: 'muted small' },
      `Bars show |site − target| ÷ fixed scale (full bar = 3 scale units). Distance d = ${Number.isFinite(d) ? d.toFixed(3) : '—'}, score ${Number.isFinite(d) ? fmtScore(Math.exp(-d)) : '—'}.`,
    ),
    h('ul', { class: 'cmp-list' }, ...rows),
  );
}

const mockNote = (ctx: Ctx): HTMLElement | null =>
  ctx.data.mock ? h('p', { class: 'mock-note' }, 'Mock values — not measurements.') : null;

export function renderSelection(ctx: Ctx, sel: Selection): HTMLElement {
  const target = ctx.target(ctx.store.get().targetId);
  if (sel.kind === 'candidate') {
    const c = ctx.candidate(sel.id);
    if (!c) return h('p', {}, 'Unknown candidate.');
    const row = ctx.rank(target.id).find((r) => r.id === c.id);
    return h(
      'div',
      {},
      h('p', { class: 'kicker' }, `${c.region}${c.country ? ` · ${c.country}` : ''}`),
      h('h3', { id: 'popup-title' }, c.name),
      h(
        'p',
        { class: 'tags' },
        statusBadge(c.known_analog_id, ctx),
        row?.excludedByVegetation ? h('span', { class: 'tag tag-excluded' }, 'Excluded: vegetated') : null,
      ),
      h(
        'p',
        { class: 'muted small num' },
        fmtCoord(c.lat, c.lon),
        c.coords_verified ? '' : ' · coordinates unverified',
      ),
      row && row.rank != null
        ? h(
            'p',
            { class: 'rank-line' },
            h('strong', {}, `#${row.rank}`),
            ` for ${target.name} · score ${fmtScore(row.score)}`,
          )
        : null,
      mockNote(ctx),
      valuesTable(ctx, c.features, c.provenance, EARTH_FEATURES),
      comparison(ctx, target, c.features),
    );
  }
  if (sel.kind === 'target') {
    const t = ctx.target(sel.id);
    return h(
      'div',
      {},
      h('p', { class: 'kicker' }, `${BODY_META[t.body].label} target`),
      h('h3', { id: 'popup-title' }, t.name),
      h(
        'p',
        { class: 'muted small num' },
        fmtCoord(t.lat, t.lon),
        ` · fingerprint radius ${t.radius_km} km`,
        t.coords_verified ? '' : ' · coordinates unverified',
      ),
      h('p', {}, t.description),
      mockNote(ctx),
      h('h4', {}, 'Fingerprint (mean within radius)'),
      valuesTable(ctx, t.features, t.provenance, COMPARABLE_FEATURES),
    );
  }
  const grid = ctx.data.grids[sel.body];
  const sample = grid ? sampleGrid(grid, sel.lat, sel.lon) : null;
  return h(
    'div',
    {},
    h('p', { class: 'kicker' }, `${BODY_META[sel.body].label} · point`),
    h('h3', { id: 'popup-title', class: 'num' }, fmtCoord(sel.lat, sel.lon)),
    !sample || !grid
      ? h('p', { class: 'muted' }, 'No feature data at this location in the current data set.')
      : h(
          'div',
          {},
          h(
            'p',
            { class: 'muted small' },
            `Grid cell ${grid.step_deg}° centred at ${fmtCoord(sample.lat, sample.lon)}`,
          ),
          mockNote(ctx),
          valuesTable(ctx, sample.values, grid.provenance, grid.columns),
          sel.body === 'earth' ? comparison(ctx, target, sample.values) : null,
        ),
  );
}
