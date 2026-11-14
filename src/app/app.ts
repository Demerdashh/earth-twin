import { tileSourcesFor } from '../config/sources';
import { rampCss } from '../config/colormaps';
import type { Body, DataSet, Overlay } from '../contract/types';
import { BODIES, BODY_META } from '../globe/bodies';
import { Globe, type MarkerSpec, type View } from '../globe/globe';
import type { ImageryStatus } from '../globe/imagery';
import type { Chapter } from '../story/chapters';
import { $, clear, h, prefersReducedMotion } from '../ui/dom';
import { ExplorePanel } from '../ui/explore';
import { renderMethods, provenanceTable } from '../ui/methods';
import { renderSelection } from '../ui/popup';
import { StoryPanel } from '../ui/story';
import { createCtx, type Ctx } from './context';
import { DEFAULT_LAYERS, LAYER_IDS, Store, type AppState, type LayerId, type Mode } from './state';

const DIM = 0.15;

const modeFromHash = (): Mode => {
  const m = location.hash.replace(/^#/, '').split('/')[0];
  return m === 'explore' || m === 'methods' ? m : 'story';
};

export class App {
  readonly store: Store;
  readonly ctx: Ctx;
  readonly globe: Globe;
  private readonly story: StoryPanel;
  private pendingView: View | null = null;
  private mounting: Promise<void> = Promise.resolve();

  constructor(private readonly data: DataSet) {
    const firstTarget = data.targets.targets[0]!.id;
    this.store = new Store({
      mode: modeFromHash(),
      body: 'earth',
      targetId: data.targets.targets.some((t) => t.id === 'shackleton_rim') ? 'shackleton_rim' : firstTarget,
      weights: { ...data.candidates.default_weights },
      layers: DEFAULT_LAYERS,
      isolate: null,
      baseSource: {},
      selection: null,
    });
    this.ctx = createCtx(data, this.store);
    this.globe = new Globe($('#globe'), {
      onImageryStatus: (s) => this.showImageryStatus(s),
      onPick: (r) => {
        if (r.kind === 'marker') {
          const isTarget = data.targets.targets.some((t) => t.id === r.id);
          this.store.set({ selection: isTarget ? { kind: 'target', id: r.id } : { kind: 'candidate', id: r.id } });
        } else {
          this.store.set({ selection: { kind: 'point', body: this.store.get().body, lat: r.lat, lon: r.lon } });
        }
      },
    });

    this.buildChrome();
    this.story = new StoryPanel($('#story-panel'), this.ctx, {
      onChapter: (ch) => this.applyChapter(ch),
      onExplore: () => (location.hash = '#explore'),
    });
    this.story.render();
    new ExplorePanel($('#explore-panel'), this.ctx, {
      onSelectCandidate: (id) => this.selectCandidate(id),
      onOpenSources: () => this.openSources(),
    });
    renderMethods($('#methods-page'), this.ctx);

    this.store.subscribe((s, prev) => this.onState(s, prev));
    window.addEventListener('hashchange', () => this.store.set({ mode: modeFromHash() }));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (!$('#sources-dialog').hidden) this.closeSources();
        else if (this.store.get().selection) this.store.set({ selection: null });
      }
    });

    this.applyMode(this.store.get().mode);
    if (this.store.get().mode === 'story') this.story.activate('hook', true);
    else void this.mountBody(this.store.get().body);
    (window as unknown as { __analogFinder: unknown }).__analogFinder = {
      store: this.store,
      ctx: this.ctx,
      globe: this.globe,
      ready: () => this.mounting,
    };
  }

  /* ------------------------------------------------------------- chrome */

  private buildChrome(): void {
    const badge = $('#data-badge');
    badge.textContent = this.data.mock ? 'Mock data' : 'Real data';
    badge.className = `data-badge ${this.data.mock ? 'is-mock' : 'is-real'}`;
    badge.title = this.data.mock
      ? (this.data.manifest.note ?? 'Mock data — not measurements')
      : `Generated ${this.data.manifest.generated_at}`;

    const bodySwitch = $('#body-switch');
    clear(bodySwitch);
    for (const b of BODIES) {
      bodySwitch.append(
        h(
          'button',
          {
            type: 'button',
            'data-body': b,
            'aria-pressed': 'false',
            onclick: () => this.store.set({ body: b, selection: null }),
          },
          BODY_META[b].label,
        ),
      );
    }
    $('#popup-close').addEventListener('click', () => this.store.set({ selection: null }));
    $('#sources-close').addEventListener('click', () => this.closeSources());
  }

  private showImageryStatus(s: ImageryStatus): void {
    const el = $('#imagery-status');
    el.className = `status-chip ${s.kind === 'remote' ? 'ok' : 'warn'}`;
    el.textContent =
      s.kind === 'remote'
        ? `Imagery: ${s.source.label} — ${s.source.provider}`
        : s.kind === 'local'
          ? `Offline fallback: low-res ${s.source.label} (${s.reason})`
          : `No imagery: ${s.reason}`;
  }

  /* --------------------------------------------------------------- state */

  private onState(s: AppState, prev: AppState): void {
    if (s.mode !== prev.mode) this.applyMode(s.mode);
    if (s.body !== prev.body) {
      void this.mountBody(s.body);
    } else if (s.baseSource !== prev.baseSource) {
      void this.globe.setBase(tileSourcesFor(s.body), s.baseSource[s.body]);
    }
    if (
      s.body === prev.body &&
      (s.targetId !== prev.targetId ||
        s.weights !== prev.weights ||
        s.layers !== prev.layers ||
        s.isolate !== prev.isolate)
    ) {
      void this.applyScene();
    }
    if (s.selection !== prev.selection || (s.selection && (s.weights !== prev.weights || s.targetId !== prev.targetId)))
      this.renderPopup();
    for (const btn of document.querySelectorAll<HTMLElement>('#body-switch button'))
      btn.setAttribute('aria-pressed', String(btn.dataset.body === s.body));
  }

  private applyMode(mode: Mode): void {
    document.body.dataset.mode = mode;
    for (const a of document.querySelectorAll<HTMLAnchorElement>('#mode-tabs a')) {
      if (a.dataset.mode === mode) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
    $('#story-panel').hidden = mode !== 'story';
    $('#explore-panel').hidden = mode !== 'explore';
    $('#methods-page').hidden = mode !== 'methods';
    if (mode === 'methods') $('#methods-title').focus();
    if (mode === 'explore') {
      // Explore shows every layer that applies, at the user's last settings.
      this.store.set({
        layers: {
          ...this.store.get().layers,
          similarity: { ...this.store.get().layers.similarity, visible: true },
          markers: { ...this.store.get().layers.markers, visible: true },
        },
      });
    }
    if (mode === 'story' && this.story.activeId) this.story.activate(this.story.activeId, true);
  }

  private applyChapter(ch: Chapter): void {
    const layers = Object.fromEntries(
      LAYER_IDS.map((id) => [id, { ...this.store.get().layers[id], visible: ch.layers.includes(id) }]),
    ) as AppState['layers'];
    this.pendingView = ch.camera;
    const sameBody = this.store.get().body === ch.body;
    this.store.set({ body: ch.body, targetId: ch.targetId, layers, isolate: null, selection: null });
    if (sameBody) this.flyPending();
  }

  private flyPending(): void {
    if (!this.pendingView) return;
    this.globe.flyTo(this.pendingView, prefersReducedMotion() ? 0 : 2.2);
    this.pendingView = null;
  }

  private async mountBody(body: Body): Promise<void> {
    const loading = $('#globe-loading');
    loading.hidden = false;
    loading.textContent = `Building ${BODY_META[body].label} globe…`;
    $('#imagery-status').className = 'status-chip';
    $('#imagery-status').textContent = 'Connecting to imagery…';
    const run = this.globe.mount(body, this.store.get().baseSource[body]).then(async () => {
      if (this.globe.currentBody !== body) return;
      await this.applyScene();
      this.flyPending();
    });
    this.mounting = run.catch(() => undefined);
    try {
      await run;
    } catch (err) {
      $('#imagery-status').className = 'status-chip warn';
      $('#imagery-status').textContent = `Globe error: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      if (this.globe.currentBody === body || this.globe.currentBody === null) loading.hidden = true;
    }
  }

  /* --------------------------------------------------------------- scene */

  private alpha(id: LayerId): number {
    const s = this.store.get();
    const base = s.layers[id].opacity;
    return s.isolate && s.isolate !== id ? base * DIM : base;
  }

  private async applyScene(): Promise<void> {
    const s = this.store.get();
    const body = this.globe.currentBody;
    if (!body) return;
    this.globe.setBaseOpacity(s.layers.base.visible ? this.alpha('base') : 0);

    const want = (o: Overlay): LayerId | null =>
      o.body !== body
        ? null
        : o.kind === 'similarity'
          ? o.target_id === s.targetId
            ? 'similarity'
            : null
          : o.kind === 'vegetation'
            ? 'vegetation'
            : 'water_ice';
    const active = new Set<string>();
    await Promise.all(
      this.data.manifest.overlays.map(async (o) => {
        const layer = want(o);
        if (!layer) return;
        active.add(o.id);
        await this.globe.setOverlay(o, this.data.baseUrl + o.file, s.layers[layer].visible, this.alpha(layer));
      }),
    );
    this.globe.hideOverlaysExcept(active);

    const show = s.layers.markers.visible;
    const a = this.alpha('markers');
    if (body === 'earth') {
      const rows = this.ctx.rank(s.targetId);
      const specs: MarkerSpec[] = rows.map((r) => ({
        id: r.id,
        lon: r.candidate.lon,
        lat: r.candidate.lat,
        color: r.rank == null ? '#5b6573' : rampCss('similarity', r.score),
        outline: r.rank == null ? '#2a323d' : r.candidate.known_analog_id ? '#ffffff' : '#ff9f43',
        size: r.rank == null ? 7 : r.rank <= 3 ? 14 : 10,
        ...(r.rank != null && r.rank <= 3 ? { label: `#${r.rank} ${r.candidate.name}` } : {}),
      }));
      this.globe.setMarkers('sites', show ? specs : [], a);
    } else {
      const specs: MarkerSpec[] = this.data.targets.targets
        .filter((t) => t.body === body)
        .map((t) => ({
          id: t.id,
          lon: t.lon,
          lat: t.lat,
          color: t.id === s.targetId ? '#5cc8ff' : '#9aa7b4',
          outline: '#05070b',
          size: t.id === s.targetId ? 14 : 10,
          label: t.name,
          radiusKm: t.radius_km,
        }));
      this.globe.setMarkers('sites', show ? specs : [], a);
    }
  }

  /* --------------------------------------------------------------- popup */

  private selectCandidate(id: string): void {
    const c = this.ctx.candidate(id);
    if (!c) return;
    this.pendingView = { lon: c.lon, lat: c.lat, height: 1_800_000 };
    if (this.store.get().body !== 'earth') this.store.set({ body: 'earth', selection: { kind: 'candidate', id } });
    else {
      this.store.set({ selection: { kind: 'candidate', id } });
      this.flyPending();
    }
  }

  private renderPopup(): void {
    const popup = $('#popup');
    const sel = this.store.get().selection;
    const content = $('#popup-content');
    clear(content);
    if (!sel) {
      popup.hidden = true;
      return;
    }
    content.append(renderSelection(this.ctx, sel));
    const wasHidden = popup.hidden;
    popup.hidden = false;
    if (wasHidden) $('#popup-close').focus({ preventScroll: true });
  }

  private openSources(): void {
    const dlg = $('#sources-dialog');
    const body = $('#sources-body');
    clear(body);
    body.append(provenanceTable(this.data));
    dlg.hidden = false;
    $('#sources-close').focus();
  }

  private closeSources(): void {
    $('#sources-dialog').hidden = true;
  }
}
