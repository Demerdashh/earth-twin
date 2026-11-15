import type { Texture } from 'three';
import { BODY_LABEL, TARGETS, type Body } from './data/config';
import { loadRank, type OutState, type RankFile } from './data/out';
import { buildGraph, linksOf, rankedRegions, targetRegionId, type Graph, type Region } from './data/regions';
import { Space } from './scene/space';
import { renderAbout } from './ui/about';
import { $, h, reducedMotion } from './ui/dom';
import { Panel } from './ui/panel';

/** Opening side for each body: the region the camera faces first. */
const HERO_REGION: Record<Body, string> = {
  earth: 'egypt_kharga_depression',
  mars: 'target_medusae_fossae',
  moon: 'target_shackleton_rim',
};

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

export class App {
  private readonly space: Space;
  private readonly panel: Panel;
  private readonly base: Graph;
  private ranked: Graph = { regions: [], links: [], pendingTargets: [] };
  private readonly task = new Map<string, string>();
  private readonly rank = new Map<string, RankFile | null>();
  private touring = false;

  constructor(
    private readonly out: OutState,
    textures: Record<Body, Texture>,
  ) {
    this.base = buildGraph();
    this.space = new Space($('#space'), textures);
    this.panel = new Panel($('#card'), {
      travel: (id) => void this.goRegion(id),
      task: (target, task) => void this.setTask(target, task),
      close: () => void this.back(),
    });
    this.refreshGraph();
    this.buildChrome();
    this.bindPointer();
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (!$('#about').hidden) this.closeAbout();
        else void this.back();
      }
    });
    (window as unknown as { __analoglens: unknown }).__analoglens = { debug: () => this.space.debug(), app: this };
  }

  /* ------------------------------------------------------------ chrome */

  private buildChrome(): void {
    const status = $('#status');
    status.className = `status-pill is-${this.out.kind}`;
    status.textContent =
      this.out.kind === 'ready'
        ? `Pipeline output · ${this.out.manifest.generated.slice(0, 10)}`
        : this.out.kind === 'invalid'
          ? 'Pipeline output refused'
          : 'Awaiting pipeline output';
    status.addEventListener('click', () => this.openAbout());

    for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-body]'))
      btn.addEventListener('click', () => void this.userAction(() => this.goBody(btn.dataset.body as Body)));
    $('#to-system').addEventListener('click', () => void this.userAction(() => this.goSystem()));
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
    const nav = $('#region-nav');
    nav.replaceChildren(
      ...this.base.regions.map((r) =>
        h(
          'button',
          { type: 'button', onclick: () => void this.userAction(() => this.goRegion(r.id)) },
          `${r.name} (${BODY_LABEL[r.body]})`,
        ),
      ),
    );
    this.syncDock();
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

  /* ------------------------------------------------------------ pointer */

  private bindPointer(): void {
    const canvas = this.space.canvas;
    const tip = $('#tip');
    let down: { x: number; y: number } | null = null;
    canvas.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY }));
    canvas.addEventListener('pointermove', (e) => {
      const hit = this.space.pick(e.clientX, e.clientY);
      const region = hit?.region ?? null;
      this.space.setHovered(region?.id ?? null);
      canvas.style.cursor = hit ? 'pointer' : 'grab';
      if (region) {
        tip.hidden = false;
        tip.textContent = region.name;
        tip.style.transform = `translate(${e.clientX + 14}px, ${e.clientY + 14}px)`;
      } else tip.hidden = true;
    });
    canvas.addEventListener('pointerleave', () => {
      this.space.setHovered(null);
      tip.hidden = true;
    });
    canvas.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
      down = null;
      const hit = this.space.pick(e.clientX, e.clientY);
      if (!hit) return;
      void this.userAction(() =>
        hit.region
          ? this.goRegion(hit.region.id)
          : this.space.view === 'system' || this.space.focusBody !== hit.body
            ? this.goBody(hit.body)
            : Promise.resolve(),
      );
    });
  }

  /* ------------------------------------------------------------ navigation */

  private region(id: string): Region | undefined {
    return this.space.region(id);
  }

  private dismissHero(): void {
    $('#hero').classList.add('is-gone');
  }

  private async userAction(fn: () => Promise<void>): Promise<void> {
    this.stopTour();
    this.dismissHero();
    await fn();
  }

  async goSystem(): Promise<void> {
    this.space.setSelected(null);
    this.space.setEmphasis(null);
    this.panel.hide();
    const p = this.space.toSystem();
    this.syncDock();
    await p;
  }

  async goBody(body: Body): Promise<void> {
    this.space.setSelected(null);
    this.space.setEmphasis(null);
    this.panel.hide();
    const p = this.space.toBody(body, this.region(HERO_REGION[body]));
    this.syncDock();
    await p;
  }

  async goRegion(id: string): Promise<void> {
    const region = this.region(id);
    if (!region) return;
    this.dismissHero();
    const p = this.space.toRegion(region);
    this.space.setSelected(id);
    this.syncDock();
    this.renderPanel(region);
    // Keyboard users jumping from the region list land on the card (and the list closes).
    if (document.activeElement?.closest('#region-nav')) $('#card-title').focus({ preventScroll: true });
    await p;
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
    const target = this.base.regions.find((r) => r.targetKey === targetKey);
    if (!target) return;
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
      this.ranked = rank
        ? rankedRegions(targetKey, task, rank.results)
        : { regions: [], links: [], pendingTargets: [] };
      this.refreshGraph();
      this.space.setSelected(targetRegionId(targetKey));
    }
    const target = this.region(targetRegionId(targetKey));
    if (target && this.space.debug().selected === target.id) this.renderPanel(target);
  }

  private refreshGraph(): void {
    this.space.setGraph([...this.base.regions, ...this.ranked.regions], [...this.base.links, ...this.ranked.links]);
  }

  private renderPanel(region: Region): void {
    const all = [...this.base.links, ...this.ranked.links];
    const linked = linksOf(all, region.id)
      .map((link) => ({ link, region: this.region(link.from === region.id ? link.to : link.from) }))
      .filter((x): x is { link: (typeof all)[number]; region: Region } => !!x.region);
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
    this.dismissHero();
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
