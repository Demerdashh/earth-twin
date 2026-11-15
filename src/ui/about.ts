// "About" sheet: method, data status, sources and honest limits (PLAN.md sections 1, 3, 7, 8).
import { BODY_LIMITS, IMAGERY, type TargetConfig } from '../data/config';
import type { OutState } from '../data/out';
import { KIND_COLOR } from '../scene/space';
import { h } from './dom';

export function renderAbout(root: HTMLElement, out: OutState, pending: TargetConfig[], onClose: () => void): void {
  const status =
    out.kind === 'ready'
      ? `Real pipeline output, generated ${out.manifest.generated.slice(0, 10)}: ${out.manifest.earth_tiles.toLocaleString('en-US')} Earth tiles at ${out.manifest.res_m} m per pixel (${out.manifest.embedder}).`
      : out.kind === 'invalid'
        ? `Pipeline output refused: ${out.error}`
        : 'The real pipeline output is not published yet, so no scores are shown. Targets, known analog sites and Egypt sites come from the team configuration.';

  const legend = (
    [
      ['target', 'Target on the Moon or Mars'],
      ['known', 'Known analog site (shares a validation tag with the target)'],
      ['egypt', 'Egypt deep-dive site (published evidence)'],
      ['ranked', 'Ranked Earth tile (pipeline output)'],
    ] as const
  ).map(([k, label]) => h('li', {}, h('i', { class: 'dot', style: `--c:${KIND_COLOR[k]}` }), label));

  const imagery = Object.values(IMAGERY).flatMap((b) => [b.color, ...(b.shade ? [b.shade] : [])]);

  root.replaceChildren(
    h(
      'div',
      { class: 'about-card', role: 'document' },
      h('button', { type: 'button', class: 'icon-btn close', 'aria-label': 'Close', onclick: onClose }, '×'),
      h('p', { class: 'kicker' }, 'AnalogLens'),
      h('h2', { id: 'about-title' }, 'Know what a place can teach you, and where it will mislead you.'),
      h(
        'p',
        {},
        'AnalogLens ranks 30 km Earth tiles by how closely they match a Moon or Mars site for one mission task, scoring each dimension on its own: terrain shape, slope, roughness, relief, dryness and more. Every result gets a fingerprint card: what matches, how well, and where the analogy breaks.',
      ),
      h('h3', {}, 'Data status'),
      h('p', { class: out.kind === 'invalid' ? 'status is-bad' : 'status' }, status),
      pending.length
        ? h('p', { class: 'muted' }, `Targets waiting for coordinates: ${pending.map((t) => t.label).join(', ')}.`)
        : null,
      h('h3', {}, 'On the globes'),
      h('ul', { class: 'legend' }, ...legend),
      h(
        'p',
        { class: 'muted' },
        'Sizes are to scale, distances are not. Drag a planet to turn it, drag space to move, scroll to zoom. Hover a dotted area to see its name; open it to see its analogs on the other bodies.',
      ),
      h('h3', {}, 'Limits'),
      h(
        'ul',
        {},
        h('li', {}, 'The score is a similarity, not a probability.'),
        h('li', {}, 'At 463 m per pixel the terrain bar compares texture over 30 km, not single yardangs or boulders.'),
        h(
          'li',
          {},
          'Known analog sites are few, so each site is reported with its rank, not a single headline number.',
        ),
        ...(['mars', 'moon'] as const).map((b) =>
          h('li', {}, `${BODY_LIMITS[b].label}: ${BODY_LIMITS[b].limits.map((l) => l.text).join('; ')}.`),
        ),
      ),
      h('h3', {}, 'Imagery (display only, never scored)'),
      h(
        'ul',
        { class: 'sources' },
        ...imagery.map((l) =>
          h('li', {}, h('a', { href: l.capabilities, target: '_blank', rel: 'noopener' }, l.credit)),
        ),
      ),
    ),
  );
}
