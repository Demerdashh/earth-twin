import { BODY_LABEL, TARGETS, type Body } from './data/config';
import { loadRank, type OutState, type RankFile } from './data/out';
import { buildGraph, linksOf, rankedRegions, targetRegionId, type Graph, type Link, type Region } from './data/regions';
import { Space, type BodyTextures, type View } from './scene/space';
import { renderAbout } from './ui/about';
import { $, h, reducedMotion } from './ui/dom';
import { Panel } from './ui/panel';

interface TourStep {
  caption: string;
  run(app: App): Promise<void>;
}

const TOUR: TourStep[] = [
  {
    caption: 'An Egyptian helped choose where Apollo landed. We built the tool for the next landings.',
    run: (a) => a.goSystem(),
  },
  {
    caption: 'Pick a site on Mars: the wind-carved yardangs of Medusae Fossae.',
    run: (a) => a.goRegion('target_medusae_fossae'),
  },
  {
    caption: 'Follow it to Earth: Kharga, in Egypt’s Western Desert.',
    run: (a) => a.goRegion('egypt_kharga_depression'),
  },
  { caption: 'Known analog sites keep the method honest: it has to find them too.', run: (a) => a.goBody('earth') },
  { caption: 'The same question for the Moon’s south pole.', run: (a) => a.goRegion('target_shackleton_rim') },
  {
    caption: 'Every result says what matches, how well, and where it breaks.',
    run: (a) => a.goRegion('known_meteor_crater_arizona'),
  },
  { caption: 'AnalogLens. Know what a place can teach you, and where it will mislead you.', run: (a) => a.goSystem() },
];

const EMPTY: Graph = { regions: [], links: [], pendingTargets: [] };

export class App {
  private readonly space: Space;
  private readonly panel: Panel;
  private readonly base: Graph;
  private ranked: Graph = EMPTY;
  private readonly task = new Map<string, string>();
  private readonly rank = new Map<string, RankFile | null>();
  private touring = false;

  constructor(
    private readonly out: OutState,
    textures: BodyTextures,
  ) {
    this.base = buildGraph();
    this.space = new Space($('#space'), textures, {
      click: (hit) => void this.onClick(hit),
      view: (view) => this.onView(view),
      interact: () => this.onInteract(),
    });
    this.panel = new Panel($('#card'), {
      travel: (id) => void this.goRegion(id),
      task: (target, task) => void this.setTask(target, task),
      close: () => void this.back(),
    });
    this.refreshGraph();
    this.buildChrome();
    this.bindKeys();
    (window as unknown as { __analoglens: unknown }).__analoglens = {
      debug: () => this.space.debug(),
      orientation: (b: Body) => this.space.orientation(b),
      screenOf: (b: Body) => this.space.screenOf(b),
    };
  }

  /* ------------------------------------------------------------ chrome */

  private buildChrome(): void {
    for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-body]'))
      btn.addEventListener('click', () => void this.user(() => this.goBody(btn.dataset.body as Body)));
    $('#to-system').addEventListener('click', () => void this.user(() => this.goSystem()));
    $('#toggle-regions').addEventListener('click', () => {
      const on = !this.space.regionsVisible;
      this.space.setRegionsVisible(on);
      $('#toggle-regions').setAttribute('aria-pressed', String(on));
    });
    $('#tour').addEventListener('click', () => void (this.touring ? this.stopTour() : this.playTour()));
    $('#about-open').addEventListener('click', () => this.openAbout());
    renderAbout($('#about'), this.out, this.base.pendingTargets, () => this.closeAbout());
    $('#about').addEventListener('click', (e) => e.target === e.currentTarget && this.closeAbout());

    // Keyboard and screen-reader access to every region, without any visible side panel.
    $('#region-nav').replaceChildren(
      ...this.base.regions.map((r) =>
        h(
          'button',
          { type: 'button', onclick: () => void this.user(() => this.goRegion(r.id)) },
          `${r.name} (${BODY_LABEL[r.body]})`,
        ),
      ),
    );
    this.syncDock();
  }

  private bindKeys(): void {
    document.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 120 : 50;
      const pan: Record<string, [number, number]> = {
        ArrowLeft: [step, 0],
        ArrowRight: [-step, 0],
        ArrowUp: [0, step],
        ArrowDown: [0, -step],
      };
      const move = pan[e.key];
      if (e.key === 'Escape') {
        if (!$('#about').hidden) this.closeAbout();
        else void this.back();
      } else if (move && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        this.onInteract();
        this.space.pan(move[0], move[1]);
      } else if (e.key === '+' || e.key === '=' || e.key === '-') {
        this.onInteract();
        this.space.zoomAt(innerWidth / 2, innerHeight / 2, e.key === '-' ? 1.25 : 0.8);
      }
    });
  }

  private openAbout(): void {
    $('#about').hidden = false;
    $<HTMLButtonElement>('#about .close').focus();
  }

  private closeAbout(): void {
    $('#about').hidden = true;
  }

  private syncDock(): void {
    const { view, body } = this.space.debug();
    for (const btn of document.querySelectorAll<HTMLElement>('[data-body]'))
      btn.setAttribute('aria-pressed', String(view !== 'system' && btn.dataset.body === body));
    $('#to-system').setAttribute('aria-pressed', String(view === 'system'));
    document.body.dataset.view = view;
  }

  /* ------------------------------------------------------------ scene events */

  private async onClick(hit: { body: Body; region: Region | null } | null): Promise<void> {
    if (!hit) return;
    await this.user(() => {
      if (hit.region) return this.goRegion(hit.region.id);
      const { view, body } = this.space.debug();
      return view !== 'system' && body === hit.body ? Promise.resolve() : this.goBody(hit.body);
    });
  }

  /** The camera reached another level (flight, scroll or pan): keep the UI in step. */
  private onView(view: View): void {
    if (view !== 'region' && this.space.selected) {
      this.space.setSelected(null);
      this.panel.hide();
    }
    this.syncDock();
  }

  private onInteract(): void {
    this.stopTour();
    $('#hint').classList.add('is-gone');
  }

  private async user(fn: () => Promise<void>): Promise<void> {
    this.onInteract();
    await fn();
  }

  /* ------------------------------------------------------------ navigation */

  async goSystem(): Promise<void> {
    this.panel.hide();
    await this.space.toSystem();
  }

  async goBody(body: Body): Promise<void> {
    this.panel.hide();
    await this.space.toBody(body);
  }

  async goRegion(id: string): Promise<void> {
    const region = this.space.region(id);
    if (!region) return;
    const flight = this.space.toRegion(region);
    this.space.setSelected(id);
    this.renderPanel(region);
    // Keyboard users jumping from the region list land on the card (and the list closes).
    if (document.activeElement?.closest('#region-nav')) $('#card-title').focus({ preventScroll: true });
    await flight;
    if (region.kind === 'target' && region.targetKey) await this.ensureRank(region.targetKey);
  }

  async back(): Promise<void> {
    this.stopTour();
    const { view, body } = this.space.debug();
    if (view === 'region' && body) await this.goBody(body);
    else if (view === 'body') await this.goSystem();
  }

  /* ------------------------------------------------------------ ranking (real output only) */

  private async ensureRank(targetKey: string): Promise<void> {
    if (this.out.kind !== 'ready') return;
    const task = this.task.get(targetKey) ?? (await this.firstRunTask(targetKey));
    if (task) await this.setTask(targetKey, task);
  }

  private async firstRunTask(targetKey: string): Promise<string | undefined> {
    const tasks = TARGETS.find((t) => t.key === targetKey)?.tasks ?? [];
    for (const t of tasks) if (await loadRank(targetKey, t)) return t;
    return tasks[0];
  }

  private async setTask(targetKey: string, task: string): Promise<void> {
    this.task.set(targetKey, task);
    if (this.out.kind === 'ready') {
      const rank = await loadRank(targetKey, task);
      this.rank.set(`${targetKey}__${task}`, rank);
      this.ranked = rank ? rankedRegions(targetKey, task, rank.results) : EMPTY;
      const selected = this.space.selected;
      this.refreshGraph();
      this.space.setSelected(selected);
    }
    const target = this.space.region(targetRegionId(targetKey));
    if (target && this.space.selected === target.id) this.renderPanel(target);
  }

  private refreshGraph(): void {
    this.space.setGraph([...this.base.regions, ...this.ranked.regions], [...this.base.links, ...this.ranked.links]);
  }

  private renderPanel(region: Region): void {
    const linked = linksOf([...this.base.links, ...this.ranked.links], region.id)
      .map((link) => ({ link, region: this.space.region(link.from === region.id ? link.to : link.from) }))
      .filter((x): x is { link: Link; region: Region } => !!x.region);
    const task = region.targetKey ? this.task.get(region.targetKey) : undefined;
    const rank = region.targetKey && task ? this.rank.get(`${region.targetKey}__${task}`) : undefined;
    this.panel.show(region, {
      linked,
      out: this.out,
      ...(task ? { task } : {}),
      ...(rank !== undefined ? { rank } : {}),
    });
  }

  /* ------------------------------------------------------------ tour */

  async playTour(): Promise<void> {
    this.touring = true;
    $('#hint').classList.add('is-gone');
    $('#tour').setAttribute('aria-pressed', 'true');
    const caption = $('#caption');
    for (const step of TOUR) {
      if (!this.isTouring()) break;
      caption.textContent = step.caption;
      caption.classList.add('is-on');
      await step.run(this);
      if (!this.isTouring()) break;
      await new Promise((r) => setTimeout(r, reducedMotion() ? 1500 : 2600));
    }
    this.stopTour();
  }

  /** A method, not the field, so the async tour loop re-reads it after every await. */
  private isTouring(): boolean {
    return this.touring;
  }

  stopTour(): void {
    if (!this.touring) return;
    this.touring = false;
    $('#tour').setAttribute('aria-pressed', 'false');
    $('#caption').classList.remove('is-on');
  }
}
