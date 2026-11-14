import type { Ctx } from '../app/context';
import { CHAPTERS, type Chapter, type StoryWidget } from '../story/chapters';
import { COMPARABLE_FEATURES, FEATURE_META, type ComparableFeature } from '../contract/types';
import { clear, h } from './dom';
import { fmtValue } from './format';

/** Replace {{...}} tokens with values from the data set. Unknown tokens render as "—". */
export function fillTokens(text: string, ctx: Ctx): string {
  return text.replace(/\{\{([^}]+)\}\}/g, (_, raw: string) => {
    const [kind, a, b] = raw.split(':');
    try {
      if (kind === 'target' && a) {
        const t = ctx.target(a);
        if (b === 'name') return t.name;
        if (b === 'radius_km') return `${t.radius_km} km`;
        if (b && (COMPARABLE_FEATURES as readonly string[]).includes(b))
          return fmtValue(b as ComparableFeature, t.features[b as ComparableFeature]);
      }
      if (kind === 'count' && a === 'candidates') return String(ctx.data.candidates.candidates.length);
      if (kind === 'top' && a)
        return ctx.topNewCandidate(a, ctx.data.candidates.default_weights)?.candidate.name ?? '—';
    } catch {
      /* fall through */
    }
    return '—';
  });
}

function widget(w: StoryWidget, ch: Chapter, ctx: Ctx, onExplore: () => void): HTMLElement {
  const mock = ctx.data.mock;
  switch (w) {
    case 'fingerprint': {
      const t = ctx.target(ch.targetId);
      return h(
        'dl',
        { class: 'fp-grid' },
        ...COMPARABLE_FEATURES.flatMap((f) => [
          h('dt', {}, FEATURE_META[f].label),
          h('dd', { class: 'num' }, fmtValue(f, t.features[f])),
        ]),
      );
    }
    case 'validation': {
      const block = ctx.data.validation.targets[ch.targetId];
      const rows = [...(block?.entries ?? [])].sort((x, y) => (x.rank ?? 1e9) - (y.rank ?? 1e9));
      return h(
        'div',
        {},
        h(
          'table',
          { class: 'val-table' },
          h(
            'caption',
            {},
            `Rank of known analogs for ${ctx.target(ch.targetId).name} (pool of ${block?.pool_size ?? 0})`,
          ),
          h(
            'thead',
            {},
            h('tr', {}, h('th', { scope: 'col' }, 'Known analog'), h('th', { scope: 'col', class: 'num' }, 'Rank')),
          ),
          h(
            'tbody',
            {},
            ...rows.map((e) =>
              h(
                'tr',
                {},
                h('td', {}, e.name.split(',')[0]),
                h('td', { class: 'num' }, e.rank == null ? '—' : `#${e.rank}`),
              ),
            ),
          ),
        ),
        mock
          ? h(
              'p',
              { class: 'mock-note' },
              'Mock data: these ranks demonstrate the check, they do not validate the method.',
            )
          : null,
      );
    }
    case 'discovery': {
      const top = ctx.topNewCandidate(ch.targetId, ctx.data.candidates.default_weights);
      if (mock)
        return h(
          'p',
          { class: 'mock-note' },
          'Mock data: no discovery is claimed. With real data this candidate would be shown as "our result, not NASA-validated".',
        );
      return h(
        'p',
        { class: 'callout' },
        top
          ? `${top.candidate.name}: our result, not NASA-validated.`
          : 'No new candidate stands out in the current data.',
      );
    }
    case 'limits':
      return h(
        'p',
        { class: 'callout' },
        'Analogs here cover terrain, thermal range, mineralogy and aridity — not gravity, radiation or vacuum. No place on Earth reproduces the daily temperature swing of the Moon or Mars.',
      );
    case 'cta':
      return h('button', { type: 'button', class: 'btn btn-primary', onclick: onExplore }, 'Open Explore mode');
  }
}

export class StoryPanel {
  private observer: IntersectionObserver | null = null;
  private active: string | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly ctx: Ctx,
    private readonly handlers: { onChapter(ch: Chapter): void; onExplore(): void },
  ) {}

  render(): void {
    clear(this.root);
    const nav = h(
      'nav',
      { class: 'story-dots', 'aria-label': 'Chapters' },
      ...CHAPTERS.map((ch, i) =>
        h('a', {
          href: `#story/${ch.id}`,
          'data-dot': ch.id,
          'aria-label': `Chapter ${i + 1}: ${ch.title}`,
          onclick: (e: Event) => {
            e.preventDefault();
            this.scrollTo(ch.id);
          },
        }),
      ),
    );
    const sections = CHAPTERS.map((ch) =>
      h(
        'section',
        { class: 'chapter', id: `chapter-${ch.id}`, 'data-chapter': ch.id, 'aria-labelledby': `ch-title-${ch.id}` },
        h('p', { class: 'kicker' }, ch.kicker),
        h('h2', { id: `ch-title-${ch.id}` }, ch.title),
        ...ch.paragraphs.map((p) => h('p', {}, fillTokens(p, this.ctx))),
        ...(ch.widgets ?? []).map((w) => widget(w, ch, this.ctx, () => this.handlers.onExplore())),
      ),
    );
    this.root.append(
      nav,
      h('div', { class: 'chapters' }, ...sections, h('div', { class: 'chapter-spacer', 'aria-hidden': 'true' })),
    );
    this.observer?.disconnect();
    this.observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        const id = (visible?.target as HTMLElement | undefined)?.dataset.chapter;
        if (id) this.activate(id);
      },
      { root: this.root, threshold: [0.35, 0.6, 0.85] },
    );
    for (const s of sections) this.observer.observe(s);
  }

  activate(id: string, force = false): void {
    if (id === this.active && !force) return;
    this.active = id;
    for (const el of this.root.querySelectorAll<HTMLElement>('[data-chapter]'))
      el.classList.toggle('is-active', el.dataset.chapter === id);
    for (const el of this.root.querySelectorAll<HTMLElement>('[data-dot]')) {
      if (el.dataset.dot === id) el.setAttribute('aria-current', 'step');
      else el.removeAttribute('aria-current');
    }
    const ch = CHAPTERS.find((c) => c.id === id);
    if (ch) this.handlers.onChapter(ch);
  }

  scrollTo(id: string): void {
    this.root.querySelector(`#chapter-${id}`)?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'start',
    });
    this.activate(id);
  }

  get activeId(): string | null {
    return this.active;
  }

  destroy(): void {
    this.observer?.disconnect();
  }
}
