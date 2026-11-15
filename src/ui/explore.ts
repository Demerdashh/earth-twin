import type { Ctx, RankedRow } from '../app/context';
import type { AppState, LayerId } from '../app/state';
import { rampGradient, type RampName } from '../config/colormaps';
import { tileSourcesFor } from '../config/sources';
import { FEATURE_META, type Body, type ComparableFeature } from '../contract/types';
import { BODY_META } from '../globe/bodies';
import { $, clear, h } from './dom';
import { exportCsv, exportGeoJson } from './export';
import { fmtScore } from './format';
import { statusBadge } from './popup';

/** The three user-facing weights (ARCHITECTURE.md: slope, thermal, mineralogy). */
export const SLIDER_FEATURES: readonly ComparableFeature[] = ['slope_deg', 'temp_range_k', 'mineral_index'];
const SLIDER_LABEL: Record<string, string> = {
  slope_deg: 'Slope',
  temp_range_k: 'Thermal range',
  mineral_index: 'Mineralogy',
};

interface LayerDef {
  id: LayerId;
  label: string;
  bodies: Body[];
  ramp?: RampName;
  hint: string;
}
const LAYERS: LayerDef[] = [
  {
    id: 'base',
    label: 'Imagery',
    bodies: ['earth', 'moon', 'mars'],
    hint: 'NASA Trek / GIBS tiles, local fallback when offline',
  },
  {
    id: 'similarity',
    label: 'Similarity heatmap',
    bodies: ['earth'],
    ramp: 'similarity',
    hint: 'Pipeline output at default weights; markers follow your weights',
  },
  {
    id: 'vegetation',
    label: 'Vegetation exclusion lens',
    bodies: ['earth'],
    ramp: 'vegetation_exclusion',
    hint: 'Cells removed because NDVI is above the threshold',
  },
  {
    id: 'water_ice',
    label: 'Water / ice indicator',
    bodies: ['earth', 'moon', 'mars'],
    ramp: 'water_ice',
    hint: 'An indicator, not a measured abundance',
  },
  {
    id: 'markers',
    label: 'Sites',
    bodies: ['earth', 'moon', 'mars'],
    hint: 'Earth: candidates coloured by live score. Moon/Mars: targets',
  },
];

export interface ExploreHandlers {
  onSelectCandidate(id: string): void;
  onOpenSources(): void;
}

export class ExplorePanel {
  private showAll = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly ctx: Ctx,
    private readonly handlers: ExploreHandlers,
  ) {
    this.build();
    ctx.store.subscribe((s, prev) => {
      if (s.targetId !== prev.targetId || s.weights !== prev.weights) this.renderRanking();
      if (s.targetId !== prev.targetId) $<HTMLSelectElement>('#target-select', this.root).value = s.targetId;
      if (s.weights !== prev.weights) this.syncSliders(s);
      if (s.body !== prev.body) this.renderLayers();
      else if (s.layers !== prev.layers || s.isolate !== prev.isolate || s.baseSource !== prev.baseSource)
        this.syncLayers(s);
    });
  }

  private build(): void {
    const { data, store } = this.ctx;
    const s = store.get();
    const byBody = (b: 'moon' | 'mars') => data.targets.targets.filter((t) => t.body === b);
    const select = h(
      'select',
      { id: 'target-select', 'aria-describedby': 'target-help' },
      ...(['moon', 'mars'] as const).map((b) =>
        h('optgroup', { label: BODY_META[b].label }, ...byBody(b).map((t) => h('option', { value: t.id }, t.name))),
      ),
    );
    select.value = s.targetId;
    select.addEventListener('change', () => store.set({ targetId: select.value, selection: null }));

    const sliders = h(
      'div',
      { class: 'sliders' },
      ...SLIDER_FEATURES.map((f) => {
        const id = `w-${f}`;
        const input = h('input', {
          type: 'range',
          id,
          min: 0,
          max: 3,
          step: 0.1,
          value: s.weights[f],
          'data-feature': f,
          'aria-valuetext': `${s.weights[f]}`,
        });
        input.addEventListener('input', () => {
          const v = Number(input.value);
          store.set({ weights: { ...store.get().weights, [f]: v } });
        });
        return h(
          'div',
          { class: 'slider' },
          h(
            'label',
            { for: id },
            SLIDER_LABEL[f] ?? f,
            h('output', { id: `${id}-out`, for: id, class: 'num' }, s.weights[f].toFixed(1)),
          ),
          input,
        );
      }),
    );
    const defaults = data.candidates.default_weights;
    const fixed = (Object.keys(defaults) as ComparableFeature[]).filter((f) => !SLIDER_FEATURES.includes(f));

    clear(this.root);
    this.root.append(
      h(
        'section',
        { class: 'panel-section' },
        h('h2', {}, h('label', { for: 'target-select' }, 'Target')),
        select,
        h(
          'span',
          { id: 'target-help', class: 'sr-only' },
          'Lunar or Martian site whose fingerprint we search for on Earth.',
        ),
      ),
      h(
        'section',
        { class: 'panel-section' },
        h(
          'div',
          { class: 'section-head' },
          h('h2', {}, 'Weights'),
          h(
            'button',
            { type: 'button', class: 'btn-ghost', onclick: () => store.set({ weights: { ...defaults } }) },
            'Reset',
          ),
        ),
        sliders,
        h(
          'p',
          {
            class: 'muted small',
            title: 'Elevation is off by default because each body measures height from a different datum.',
          },
          `Fixed: ${fixed.map((f) => `${FEATURE_META[f].label} ${defaults[f]}`).join(' · ')}`,
        ),
      ),
      h(
        'section',
        { class: 'panel-section' },
        h(
          'div',
          { class: 'section-head' },
          h('h2', { id: 'ranking-title' }, 'Ranking'),
          h('span', { class: 'muted small', id: 'ranking-meta' }),
        ),
        h('ol', { class: 'ranking', id: 'ranking-list', 'aria-labelledby': 'ranking-title' }),
        h(
          'button',
          {
            type: 'button',
            class: 'btn-ghost',
            id: 'ranking-toggle',
            onclick: () => {
              this.showAll = !this.showAll;
              this.renderRanking();
            },
          },
          'Show all',
        ),
      ),
      h('section', { class: 'panel-section' }, h('h2', {}, 'Layers'), h('div', { id: 'layers' })),
      h(
        'section',
        { class: 'panel-section' },
        h('h2', {}, 'Export'),
        h(
          'div',
          { class: 'btn-row' },
          h('button', { type: 'button', class: 'btn', onclick: () => exportGeoJson(this.ctx) }, 'GeoJSON'),
          h('button', { type: 'button', class: 'btn', onclick: () => exportCsv(this.ctx) }, 'CSV'),
          h(
            'button',
            { type: 'button', class: 'btn-ghost', onclick: () => this.handlers.onOpenSources() },
            'Data sources',
          ),
        ),
      ),
      h('p', { class: 'panel-foot' }, 'Terrain, heat, minerals, aridity — not gravity, radiation or vacuum.'),
    );
    this.renderRanking();
    this.renderLayers();
  }

  private syncSliders(s: AppState): void {
    for (const f of SLIDER_FEATURES) {
      const input = $<HTMLInputElement>(`#w-${f}`, this.root);
      if (Number(input.value) !== s.weights[f]) input.value = String(s.weights[f]);
      input.setAttribute('aria-valuetext', s.weights[f].toFixed(1));
      $(`#w-${f}-out`, this.root).textContent = s.weights[f].toFixed(1);
    }
  }

  private rankingItem(r: RankedRow): HTMLElement {
    const delta = r.rank != null && r.pipelineRank != null ? r.pipelineRank - r.rank : 0;
    return h(
      'li',
      { class: `rank-item${r.rank == null ? ' is-excluded' : ''}`, 'data-candidate-id': r.id },
      h(
        'button',
        { type: 'button', class: 'rank-btn', onclick: () => this.handlers.onSelectCandidate(r.id) },
        h('span', { class: 'rank-n num' }, r.rank == null ? '—' : `${r.rank}`),
        h(
          'span',
          { class: 'rank-main' },
          h('span', { class: 'rank-name' }, r.candidate.name),
          h(
            'span',
            { class: 'rank-sub' },
            r.rank == null
              ? h('span', { class: 'tag tag-excluded' }, 'Excluded: vegetated')
              : statusBadge(r.candidate.known_analog_id, this.ctx),
          ),
        ),
        h(
          'span',
          { class: 'rank-score num' },
          h(
            'span',
            { class: 'score-bar', 'aria-hidden': 'true' },
            h('span', { style: `width:${(r.score * 100).toFixed(1)}%` }),
          ),
          fmtScore(r.score),
          delta !== 0
            ? h(
                'span',
                { class: `delta ${delta > 0 ? 'up' : 'down'}`, title: `Pipeline rank ${r.pipelineRank}` },
                delta > 0 ? `▲${delta}` : `▼${-delta}`,
              )
            : null,
        ),
      ),
    );
  }

  renderRanking(): void {
    const rows = this.ctx.rank(this.ctx.store.get().targetId);
    const list = $('#ranking-list', this.root);
    clear(list);
    const ranked = rows.filter((r) => r.rank != null);
    const shown = this.showAll ? rows : ranked.slice(0, 10);
    for (const r of shown) list.append(this.rankingItem(r));
    $('#ranking-meta', this.root).textContent = `${ranked.length} ranked · ${rows.length - ranked.length} excluded`;
    $('#ranking-toggle', this.root).textContent = this.showAll ? 'Show top 10' : `Show all ${rows.length}`;
  }

  private renderLayers(): void {
    const { store } = this.ctx;
    const s = store.get();
    const box = $('#layers', this.root);
    clear(box);
    for (const def of LAYERS.filter((l) => l.bodies.includes(s.body))) {
      const ls = s.layers[def.id];
      const vis = h('input', { type: 'checkbox', id: `layer-${def.id}`, checked: ls.visible });
      vis.addEventListener('change', () => store.setLayer(def.id, { visible: vis.checked }));
      const op = h('input', {
        type: 'range',
        id: `op-${def.id}`,
        min: 0,
        max: 1,
        step: 0.05,
        value: ls.opacity,
        'aria-label': `${def.label} opacity`,
      });
      op.addEventListener('input', () => store.setLayer(def.id, { opacity: Number(op.value) }));
      const iso = h(
        'button',
        {
          type: 'button',
          class: 'btn-ghost btn-xs',
          id: `iso-${def.id}`,
          'aria-pressed': String(s.isolate === def.id),
          title: 'Dim every other layer',
        },
        'Isolate',
      );
      iso.addEventListener('click', () => store.set({ isolate: store.get().isolate === def.id ? null : def.id }));

      let extra: HTMLElement | null = null;
      if (def.id === 'base') {
        const sources = tileSourcesFor(s.body);
        const sel = h(
          'select',
          { id: 'base-source', 'aria-label': 'Imagery source' },
          ...sources.map((src) => h('option', { value: src.id }, `${src.label} — ${src.provider}`)),
        );
        sel.value = s.baseSource[s.body] ?? sources[0]?.id ?? '';
        sel.addEventListener('change', () =>
          store.set({ baseSource: { ...store.get().baseSource, [s.body]: sel.value } }),
        );
        extra = sel;
      } else if (def.ramp) {
        extra = h(
          'div',
          { class: 'legend' },
          h('span', { class: 'legend-ramp', style: `background:${rampGradient(def.ramp)}` }),
          h(
            'span',
            { class: 'legend-labels small muted' },
            h('span', {}, def.id === 'similarity' ? 'low' : '0'),
            h('span', {}, def.id === 'similarity' ? 'high similarity' : def.id === 'vegetation' ? 'excluded' : '1'),
          ),
        );
      } else if (def.id === 'markers' && s.body === 'earth') {
        extra = h(
          'div',
          { class: 'legend-keys small' },
          h('span', {}, h('i', { class: 'dot dot-known' }), 'Known analog'),
          h('span', {}, h('i', { class: 'dot dot-new' }), 'Our result'),
          h('span', {}, h('i', { class: 'dot dot-excl' }), 'Excluded'),
        );
      }
      box.append(
        h(
          'div',
          { class: 'layer', 'data-layer': def.id },
          h(
            'div',
            { class: 'layer-head' },
            vis,
            h('label', { for: `layer-${def.id}`, title: def.hint }, def.label),
            iso,
          ),
          extra,
          h('div', { class: 'layer-op' }, op),
        ),
      );
    }
  }

  private syncLayers(s: AppState): void {
    for (const el of this.root.querySelectorAll<HTMLElement>('.layer')) {
      const id = el.dataset.layer as LayerId;
      const ls = s.layers[id];
      $<HTMLInputElement>(`#layer-${id}`, el).checked = ls.visible;
      const op = $<HTMLInputElement>(`#op-${id}`, el);
      if (Number(op.value) !== ls.opacity) op.value = String(ls.opacity);
      $(`#iso-${id}`, el).setAttribute('aria-pressed', String(s.isolate === id));
      el.classList.toggle('is-dimmed', s.isolate != null && s.isolate !== id);
    }
  }
}
