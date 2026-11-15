// The one card on screen: appears when you dive into a region, shows only what is real.
import { BODY_LABEL, BODY_LIMITS, TARGETS, TASKS } from '../data/config';
import { imageUrl, loadCard, type Card, type OutState, type RankFile } from '../data/out';
import { targetRegionId, type Link, type Region } from '../data/regions';
import { KIND_COLOR } from '../scene/space';
import { clear, fmtLatLon, h, type Child } from './dom';

export interface PanelHandlers {
  travel(regionId: string): void;
  task(targetKey: string, task: string): void;
  close(): void;
}

const KIND_LABEL: Record<Region['kind'], string> = {
  target: 'Target site',
  known: 'Known analog',
  egypt: 'Egypt deep-dive site',
  ranked: 'Ranked Earth tile',
};

const pct = (x: number): string => `${Math.round(x * 100)}`;
const num = (v: number | null | undefined, unit = ''): string =>
  v == null
    ? 'n/a'
    : `${Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(Math.abs(v) >= 10 ? 1 : 2)}${unit ? ` ${unit}` : ''}`;

function chip(region: Region, why: string, onClick: () => void): HTMLElement {
  return h(
    'button',
    { type: 'button', class: 'link-chip', title: why, onclick: onClick },
    h('i', { class: 'dot', style: `--c:${KIND_COLOR[region.kind]}` }),
    h('span', {}, region.name),
    h('span', { class: 'chip-body' }, BODY_LABEL[region.body]),
  );
}

export class Panel {
  private token = 0;

  constructor(
    private readonly root: HTMLElement,
    private readonly handlers: PanelHandlers,
  ) {}

  hide(): void {
    this.token++;
    this.root.classList.remove('is-open');
    this.root.setAttribute('aria-hidden', 'true');
  }

  show(
    region: Region,
    ctx: {
      linked: { region: Region; link: Link }[];
      out: OutState;
      task?: string;
      rank?: RankFile | null;
    },
  ): void {
    const token = ++this.token;
    clear(this.root);
    const head = h(
      'header',
      { class: 'card-head' },
      h('p', { class: 'kicker' }, `${BODY_LABEL[region.body]} · ${KIND_LABEL[region.kind]}`),
      h('h2', { id: 'card-title', tabindex: '-1' }, region.name),
      h(
        'p',
        { class: 'meta' },
        fmtLatLon(region.lat, region.lon),
        region.approximate ? h('span', { class: 'flag', title: region.note }, 'coordinates to verify') : null,
      ),
      h(
        'button',
        { type: 'button', class: 'icon-btn close', 'aria-label': 'Close', onclick: () => this.handlers.close() },
        '×',
      ),
    );
    const body: Child[] = [];

    if (region.kind === 'target') body.push(...this.targetBody(region, ctx));
    else if (region.kind === 'ranked') body.push(...this.rankedHead(region));
    else body.push(h('p', { class: 'note' }, region.note));

    if (region.kind !== 'target' && ctx.linked.length)
      body.push(
        h('h3', {}, 'Analog of'),
        h(
          'div',
          { class: 'chips' },
          ...ctx.linked.map(({ region: r, link }) => chip(r, link.why, () => this.handlers.travel(r.id))),
        ),
      );

    const fingerprint = h('div', { class: 'fingerprint' });
    body.push(fingerprint);
    this.root.append(head, h('div', { class: 'card-body' }, ...body));
    this.root.classList.add('is-open');
    this.root.removeAttribute('aria-hidden');

    if (region.kind === 'ranked' && region.rank && region.targetKey)
      void loadCard(region.targetKey, region.rank.task, region.rank.tile_id).then((card) => {
        if (token === this.token && card) fingerprint.append(this.cardView(card));
      });
  }

  private targetBody(
    region: Region,
    ctx: { linked: { region: Region; link: Link }[]; out: OutState; task?: string; rank?: RankFile | null },
  ): Child[] {
    const t = TARGETS.find((x) => x.key === region.targetKey);
    if (!t) return [];
    const out: Child[] = [];
    out.push(
      h(
        'div',
        { class: 'tasks', role: 'group', 'aria-label': 'Mission task' },
        ...t.tasks.map((k) =>
          h(
            'button',
            {
              type: 'button',
              class: 'task',
              'aria-pressed': String(k === ctx.task),
              onclick: () => this.handlers.task(t.key, k),
            },
            TASKS[k]?.label ?? k,
          ),
        ),
      ),
    );

    if (ctx.out.kind === 'absent')
      out.push(h('p', { class: 'status' }, 'Earth ranking appears here once the real pipeline output is published.'));
    else if (ctx.out.kind === 'invalid')
      out.push(h('p', { class: 'status is-bad' }, `Pipeline output refused: ${ctx.out.error}`));
    else if (ctx.rank === null) out.push(h('p', { class: 'status' }, 'This task was not run for this target.'));
    else if (ctx.rank) {
      const top = ctx.rank.results.slice(0, 5);
      out.push(
        h('h3', {}, 'Best Earth tiles'),
        h(
          'ol',
          { class: 'top' },
          ...top.map((r) =>
            h(
              'li',
              {},
              h(
                'button',
                {
                  type: 'button',
                  onclick: () => this.handlers.travel(`ranked_${t.key}_${ctx.rank!.task}_${r.tile_id}`),
                },
                h('span', { class: 'n' }, String(r.rank)),
                h('span', { class: 'name' }, r.novel ? 'Candidate new analog' : (r.nearest_known ?? r.tile_id)),
                h('span', { class: 'score' }, pct(r.score)),
              ),
            ),
          ),
        ),
      );
    }

    const known = ctx.linked.filter((l) => l.link.kind !== 'ranked');
    if (known.length)
      out.push(
        h('h3', {}, 'On Earth'),
        h(
          'div',
          { class: 'chips' },
          ...known.map(({ region: r, link }) => chip(r, link.why, () => this.handlers.travel(r.id))),
        ),
      );
    const limits = BODY_LIMITS[t.body].limits.map((l) => l.name.toLowerCase());
    out.push(h('p', { class: 'limits' }, `What Earth cannot copy: ${limits.join(', ')}.`));
    return out;
  }

  private rankedHead(region: Region): Child[] {
    const r = region.rank!;
    return [
      h(
        'div',
        { class: 'score-line' },
        h('span', { class: 'big' }, pct(r.score)),
        h('span', { class: 'of' }, `similarity · rank ${r.rank} · ${TASKS[r.task]?.label ?? r.task}`),
      ),
      h('p', { class: r.novel ? 'note is-new' : 'note' }, region.note),
      h(
        'button',
        {
          type: 'button',
          class: 'link-chip back',
          onclick: () => this.handlers.travel(targetRegionId(region.targetKey!)),
        },
        `Back to ${TARGETS.find((t) => t.key === region.targetKey)?.label ?? 'target'}`,
      ),
    ];
  }

  private cardView(card: Card): HTMLElement {
    const bars = card.bars.map((b) =>
      h(
        'li',
        { class: `bar is-${b.status.replace(/\s+/g, '-')}` },
        h('span', { class: 'bar-label' }, b.label),
        h('span', { class: 'bar-track' }, h('span', { class: 'bar-fill', style: `width:${pct(b.score ?? 0)}%` })),
        h('span', { class: 'bar-val' }, b.score == null ? 'no data' : pct(b.score)),
        b.earth_value != null || b.target_value != null
          ? h(
              'span',
              { class: 'bar-sub' },
              `Earth ${num(b.earth_value, b.unit)} · target ${num(b.target_value, b.unit)}`,
            )
          : null,
      ),
    );
    const dataBreaks = card.breaks.filter((b) => b.kind !== 'fixed');
    return h(
      'section',
      { 'aria-label': 'Fingerprint' },
      card.images.earth && card.images.target
        ? h(
            'div',
            { class: 'pair' },
            h(
              'figure',
              {},
              h('img', { src: imageUrl(card.images.earth), alt: 'Earth tile relief', loading: 'lazy' }),
              h('figcaption', {}, 'Earth'),
            ),
            h(
              'figure',
              {},
              h('img', { src: imageUrl(card.images.target), alt: 'Target relief', loading: 'lazy' }),
              h('figcaption', {}, card.target_label),
            ),
          )
        : null,
      h('h3', {}, 'Fingerprint'),
      h('ul', { class: 'bars' }, ...bars),
      card.strong_for.length ? h('p', { class: 'strong' }, `Strong for: ${card.strong_for.join(', ')}`) : null,
      ...dataBreaks.map((b) => h('p', { class: 'break' }, b.text)),
      card.tests.length ? h('h3', {}, 'Tests you could run here') : null,
      card.tests.length ? h('ul', { class: 'tests' }, ...card.tests.map((t) => h('li', {}, t))) : null,
    );
  }
}
