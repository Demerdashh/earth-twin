import type { Ctx } from '../app/context';
import { DATASETS, TILE_SOURCES } from '../config/sources';
import { COMPARABLE_FEATURES, FEATURE_META, type DataSet } from '../contract/types';
import { clear, h } from './dom';

export function provenanceTable(data: DataSet): HTMLElement {
  return h(
    'table',
    { class: 'data-table' },
    h('caption', {}, 'Every dataset behind the numbers on screen (provenance.json)'),
    h(
      'thead',
      {},
      h(
        'tr',
        {},
        ...['Dataset', 'Body', 'Source', 'Resolution', 'Date', 'Processing', 'Status'].map((c) =>
          h('th', { scope: 'col' }, c),
        ),
      ),
    ),
    h(
      'tbody',
      {},
      ...data.provenance.datasets.map((d) =>
        h(
          'tr',
          {},
          h('td', {}, d.url ? h('a', { href: d.url, target: '_blank', rel: 'noopener' }, d.product) : d.product),
          h('td', {}, d.body),
          h('td', {}, d.source),
          h('td', {}, d.resolution),
          h('td', { class: 'num' }, d.date),
          h('td', {}, d.processing_steps.join('; ')),
          h(
            'td',
            {},
            d.mock ? h('span', { class: 'tag tag-mock' }, 'Mock') : null,
            ' ',
            h('span', { class: `tag ${d.verified ? 'tag-known' : 'tag-new'}` }, d.verified ? 'Verified' : 'Unverified'),
          ),
        ),
      ),
    ),
  );
}

function sourcesTable(): HTMLElement {
  const rows = [
    ...TILE_SOURCES.map((s) => ({ id: s.id, what: `Imagery · ${s.label}`, product: s.product, v: s.verification })),
    ...DATASETS.map((d) => ({
      id: d.id,
      what: `Feature data · ${d.feeds.join(', ')}`,
      product: d.identifier ?? d.product,
      v: d.verification,
    })),
  ];
  return h(
    'table',
    { class: 'data-table' },
    h('caption', {}, 'Configured endpoints and dataset names (src/config/sources.ts)'),
    h('thead', {}, h('tr', {}, ...['Id', 'Role', 'Product', 'Verification'].map((c) => h('th', { scope: 'col' }, c)))),
    h(
      'tbody',
      {},
      ...rows.map((r) =>
        h(
          'tr',
          {},
          h('td', { class: 'num' }, r.id),
          h('td', {}, r.what),
          h('td', {}, r.product),
          h(
            'td',
            {},
            h('span', { class: `tag ${r.v.status === 'verified' ? 'tag-known' : 'tag-new'}` }, r.v.status),
            ' ',
            h('span', { class: 'small muted' }, r.v.checkedOn ?? r.v.method),
          ),
        ),
      ),
    ),
  );
}

export function renderMethods(root: HTMLElement, ctx: Ctx): void {
  const c = ctx.data.candidates;
  clear(root);
  root.append(
    h(
      'article',
      { class: 'methods' },
      h('p', { class: 'kicker' }, 'Methods'),
      h('h1', { id: 'methods-title', tabindex: '-1' }, 'How Analog Finder ranks places on Earth'),
      ctx.data.mock
        ? h(
            'p',
            { class: 'mock-banner' },
            'This build is showing MOCK data. The method below is real; the numbers are placeholders until the real pipeline output replaces them.',
          )
        : null,

      h('h2', {}, '1. Features, in physical units'),
      h(
        'p',
        {},
        'Each site is described by the same measurable features on every body. We compare absolute values — degrees, kelvin, metres — never per-body percentiles, so the steepest slope on the Moon is not mistaken for the steepest slope on Earth.',
      ),
      h(
        'table',
        { class: 'data-table' },
        h(
          'thead',
          {},
          h(
            'tr',
            {},
            ...['Feature', 'Unit', 'Fixed scale s', 'Default weight'].map((x) => h('th', { scope: 'col' }, x)),
          ),
        ),
        h(
          'tbody',
          {},
          ...COMPARABLE_FEATURES.map((f) =>
            h(
              'tr',
              {},
              h('td', {}, FEATURE_META[f].label),
              h('td', {}, FEATURE_META[f].unit || 'index 0–1'),
              h('td', { class: 'num' }, String(c.feature_scales[f])),
              h('td', { class: 'num' }, String(c.default_weights[f])),
            ),
          ),
        ),
      ),

      h('h2', {}, '2. Target fingerprint'),
      h(
        'p',
        {},
        'For a lunar or Martian target we average each feature within a fixed radius around the site. That vector is the fingerprint.',
      ),

      h('h2', {}, '3. Similarity'),
      h('pre', { class: 'formula' }, 'd = sqrt( Σ wᵢ · ((cᵢ − tᵢ) / sᵢ)²  /  Σ wᵢ )\nscore = exp(−d)'),
      h(
        'p',
        {},
        'c is the Earth candidate, t the target fingerprint, w the weights and s a fixed physical scale per feature, identical for every body. Features missing on either side are skipped. The browser recomputes this live over each target’s exported pool when you move the weight sliders; the heatmap image shows the pipeline result at default weights.',
      ),

      h('h2', {}, '4. Vegetation exclusion'),
      h(
        'p',
        {},
        `Vegetation is a filter, not a feature: candidates with NDVI above ${c.ndvi_threshold} are excluded from the ranking.`,
      ),

      h('h2', {}, '5. Validation'),
      h(
        'p',
        {},
        'Known analog sites (Atacama, Haughton Crater, Mauna Kea, the Iceland highlands, the San Francisco Volcanic Field, the McMurdo Dry Valleys, Rio Tinto and MDRS) are matched to candidates and their ranks reported per target (validation_report.json). Their coordinates are flagged until verified.',
      ),

      h('h2', {}, '6. Limits'),
      h(
        'ul',
        {},
        h(
          'li',
          {},
          'Similarity covers terrain, thermal range, mineralogy and aridity. It says nothing about gravity, radiation or vacuum.',
        ),
        h(
          'li',
          {},
          'No place on Earth reproduces the daily temperature swing of the Moon or Mars, so thermal distance stays large for every candidate.',
        ),
        h(
          'li',
          {},
          'Mineral and water/ice values are indicators derived from different instruments on each body; treat them as proxies.',
        ),
        h('li', {}, 'Any candidate that is not a known analog is our result, not NASA-validated.'),
      ),

      h('h2', {}, '7. Data provenance'),
      provenanceTable(ctx.data),
      sourcesTable(),
      h(
        'p',
        { class: 'small muted' },
        `Data set generated ${ctx.data.manifest.generated_at} by ${ctx.data.manifest.generator}.`,
      ),
    ),
  );
}
