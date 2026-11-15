import type { Ctx } from '../app/context';
import { CHAPTERS, type Chapter, type StoryWidget } from '../story/chapters';
import { COMPARABLE_FEATURES, type ComparableFeature } from '../contract/types';
import { clear, h, prefersReducedMotion } from './dom';
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

const stat = (value: string, label: string): HTMLElement =>
  h('div', { class: 'stat' }, h('span', { class: 'stat-value' }, value), h('span', { class: 'stat-label' }, label));

const mockNote = (ctx: Ctx, text: string): HTMLElement | null =>
  ctx.data.mock ? h('p', { class: 'footnote is-mock' }, text) : null;

function widget(w: StoryWidget, ch: Chapter, ctx: Ctx, onExplore: () => void): HTMLElement | null {
  switch (w) {
    case 'fingerprint': {
      const t = ctx.target(ch.targetId);
      const f = t.features;
      return h(
        'div',
        {},
        h(
          'div',
          { class: 'stats' },
          stat(fmtValue('slope_deg', f.slope_deg), 'slope'),
          stat(fmtValue('temp_range_k', f.temp_range_k), 'daily heat swing'),
          stat(fmtValue('ice_indicator', f.ice_indicator), 'ice indicator'),
        ),
        h('p', { class: 'footnote' }, `${t.name} · mean within ${t.radius_km} km`),
        mockNote(ctx, 'Mock values'),
      );
    }
    case 'validation': {
      const block = ctx.data.validation.targets[ch.targetId];
      const entries = block?.entries ?? [];
      const inTop = entries.filter((e) => e.rank != null && e.rank <= 10).length;
      return h(
        'div',
        {},
        h('div', { class: 'stats' }, stat(`${inTop}/${entries.length}`, 'known analogs in the top 10')),
        h('p', { class: 'footnote' }, `for ${ctx.target(ch.targetId).name}`),
        mockNote(ctx, 'Mock data — shows the check, not a result'),
      );
    }
    case 'discovery': {
      if (ctx.data.mock) return h('p', { class: 'footnote is-mock' }, 'Mock data — no discovery claimed');
      const top = ctx.topNewCandidate(ch.targetId, ctx.data.candidates.default_weights);
      return top
        ? h(
            'div',
            {},
            h('p', { class: 'discovery-name' }, top.candidate.name),
            h('p', { class: 'footnote' }, 'Our result, not NASA-validated'),
          )
        : null;
    }
    case 'limits':
      return h('p', { class: 'footnote' }, 'Terrain, heat, minerals, aridity — not gravity, radiation or vacuum.');
    case 'cta':
      return h('button', { type: 'button', class: 'btn btn-primary btn-lg', onclick: onExplore }, 'Explore');
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
        ch.line ? h('p', { class: 'line' }, fillTokens(ch.line, this.ctx)) : null,
        ...(ch.widgets ?? []).map((w) => widget(w, ch, this.ctx, () => this.handlers.onExplore())),
      ),
    );
    this.root.append(
      h('div', { class: 'chapters' }, ...sections, h('div', { class: 'chapter-spacer', 'aria-hidden': 'true' })),
    );
    // Dots live outside the scroller so they stay fixed on screen.
    this.root.parentElement?.querySelector('.story-dots')?.remove();
    this.root.after(nav);
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
    for (const el of document.querySelectorAll<HTMLElement>('[data-dot]')) {
      if (el.dataset.dot === id) el.setAttribute('aria-current', 'step');
      else el.removeAttribute('aria-current');
    }
    const ch = CHAPTERS.find((c) => c.id === id);
    if (ch) this.handlers.onChapter(ch);
  }

  scrollTo(id: string): void {
    this.root
      .querySelector(`#chapter-${id}`)
      ?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
    this.activate(id);
  }

  get activeId(): string | null {
    return this.active;
  }

  destroy(): void {
    this.observer?.disconnect();
  }
}
