// One Cesium Viewer per body: switching destroys the old Viewer and builds a new one with the
// body's ellipsoid. Every coordinate conversion below passes that ellipsoid explicitly.
import {
  Cartesian2,
  Cartesian3,
  Color,
  ColorMaterialProperty,
  ConstantPositionProperty,
  Ellipsoid,
  EllipsoidTerrainProvider,
  type Entity,
  HeightReference,
  ImageryLayer,
  LabelStyle,
  Math as CesiumMath,
  NearFarScalar,
  Rectangle,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  SingleTileImageryProvider,
  SkyAtmosphere,
  VerticalOrigin,
  ColorGeometryInstanceAttribute,
  CylinderGeometry,
  DirectionalLight,
  EasingFunction,
  GeometryInstance,
  Matrix4,
  PerInstanceColorAppearance,
  Primitive,
  Viewer,
  defined,
} from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { tileSourcesFor, type TileSource } from '../config/sources';
import type { Body, Overlay } from '../contract/types';
import { BODY_META, ELLIPSOIDS } from './bodies';
import { fallbackSource, localProvider, resolveImagery, type ImageryStatus } from './imagery';

export interface View {
  lon: number;
  lat: number;
  height: number;
}

export interface MarkerSpec {
  id: string;
  lon: number;
  lat: number;
  color: string;
  outline: string;
  size: number;
  label?: string;
  /** Draw a ground circle with this radius (target fingerprint radius). */
  radiusKm?: number;
}

export type PickResult = { kind: 'marker'; id: string } | { kind: 'point'; lon: number; lat: number };

const MAX_TILE_ERRORS = 6;
const LIGHT_TMP = new Cartesian3();
const SCAN_PERIOD_S = 7;
const MARKER_HEIGHT_M = 2000;
/** Markers closer than this to the camera are never hidden by the globe (avoids z-fighting up close). */
const NEAR_NO_DEPTH_TEST_M = 1_500_000;

export class Globe {
  private viewer: Viewer | null = null;
  private body: Body | null = null;
  private baseLayer: ImageryLayer | null = null;
  private overlays = new Map<string, ImageryLayer>();
  private markers = new Map<string, Entity[]>();
  private handler: ScreenSpaceEventHandler | null = null;
  private mountToken = 0;
  private scan: { primitive: Primitive; stop: () => void } | null = null;

  constructor(
    private readonly container: HTMLElement,
    private readonly events: {
      onImageryStatus: (s: ImageryStatus) => void;
      onPick: (r: PickResult) => void;
    },
  ) {}

  get currentBody(): Body | null {
    return this.body;
  }

  get ellipsoid(): Ellipsoid {
    return ELLIPSOIDS[this.body ?? 'earth'];
  }

  /** Destroy the current Viewer (if any) and build a new one for `body`. */
  async mount(body: Body, preferredBaseId?: string): Promise<void> {
    const token = ++this.mountToken;
    this.destroy();
    const ellipsoid = ELLIPSOIDS[body];
    // Cesium uses Ellipsoid.default for internal defaults; set it before constructing anything.
    Ellipsoid.default = ellipsoid;
    const isEarth = body === 'earth';
    const viewer = new Viewer(this.container, {
      ellipsoid,
      baseLayer: false,
      terrainProvider: new EllipsoidTerrainProvider({ ellipsoid }),
      skyAtmosphere: isEarth ? new SkyAtmosphere(ellipsoid) : false,
      // Transparent canvas: the CSS space gradient behind it is the sky (reference video 01).
      skyBox: false,
      contextOptions: { webgl: { alpha: true } },
      orderIndependentTranslucency: false,
      animation: false,
      timeline: false,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
      requestRenderMode: true,
      maximumRenderTimeChange: Infinity,
    });
    const scene = viewer.scene;
    scene.backgroundColor = Color.TRANSPARENT;
    scene.globe.baseColor = Color.fromCssColorString('#0b1424');
    scene.globe.showGroundAtmosphere = isEarth;
    if (scene.sun) scene.sun.show = false;
    if (scene.moon) scene.moon.show = false;
    // Soft key light that follows the camera from the upper left: every view gets the same
    // sculpted, sunlit look regardless of the real sun position.
    const light = new DirectionalLight({ direction: new Cartesian3(1, 0, 0), intensity: 2.6 });
    scene.light = light;
    scene.globe.enableLighting = true;
    scene.globe.dynamicAtmosphereLighting = true;
    scene.globe.dynamicAtmosphereLightingFromSun = false;
    scene.preRender.addEventListener(() => {
      const c = scene.camera;
      const d = light.direction;
      Cartesian3.multiplyByScalar(c.directionWC, 1, d);
      Cartesian3.add(d, Cartesian3.multiplyByScalar(c.rightWC, 0.55, LIGHT_TMP), d);
      Cartesian3.subtract(d, Cartesian3.multiplyByScalar(c.upWC, 0.45, LIGHT_TMP), d);
      Cartesian3.normalize(d, d);
    });
    (viewer.cesiumWidget.creditContainer as HTMLElement).classList.add('cesium-credits');
    this.viewer = viewer;
    this.body = body;
    this.flyTo(BODY_META[body].home, 0);
    this.installPicking(viewer, ellipsoid);
    await this.setBase(tileSourcesFor(body), preferredBaseId, token);
  }

  /** Resolve and install base imagery; falls back to local tiles after repeated tile errors. */
  async setBase(sources: readonly TileSource[], preferredId?: string, token = this.mountToken): Promise<void> {
    const viewer = this.viewer;
    if (!viewer) return;
    const ellipsoid = this.ellipsoid;
    const { provider, status } = await resolveImagery(sources, ellipsoid, preferredId);
    if (token !== this.mountToken || viewer.isDestroyed()) return; // body switched meanwhile
    if (this.baseLayer) viewer.imageryLayers.remove(this.baseLayer, true);
    const layer = new ImageryLayer(provider);
    viewer.imageryLayers.add(layer, 0);
    this.baseLayer = layer;
    this.events.onImageryStatus(status);
    if (status.kind === 'remote') {
      let errors = 0;
      const remove = provider.errorEvent.addEventListener(() => {
        errors += 1;
        if (errors < MAX_TILE_ERRORS || token !== this.mountToken || viewer.isDestroyed()) return;
        remove();
        const local = fallbackSource(sources) ?? status.source;
        const fallback = new ImageryLayer(localProvider(local, ellipsoid));
        if (this.baseLayer) viewer.imageryLayers.remove(this.baseLayer, true);
        viewer.imageryLayers.add(fallback, 0);
        this.baseLayer = fallback;
        this.events.onImageryStatus({
          kind: 'local',
          source: local,
          reason: 'too many tile errors from the remote server',
        });
      });
    }
    viewer.scene.requestRender();
  }

  setBaseOpacity(alpha: number): void {
    if (this.baseLayer) this.baseLayer.alpha = alpha;
    this.viewer?.scene.requestRender();
  }

  /** Add or update a PNG overlay from the manifest (equirectangular, bounds in degrees). */
  async setOverlay(overlay: Overlay, url: string, visible: boolean, alpha: number): Promise<void> {
    const viewer = this.viewer;
    if (!viewer) return;
    let layer = this.overlays.get(overlay.id);
    if (!layer) {
      const token = this.mountToken;
      const b = overlay.bounds;
      const provider = await SingleTileImageryProvider.fromUrl(url, {
        rectangle: Rectangle.fromDegrees(b.west, b.south, b.east, b.north),
        ellipsoid: this.ellipsoid,
      });
      if (token !== this.mountToken || viewer.isDestroyed()) return;
      layer = this.overlays.get(overlay.id);
      if (!layer) {
        layer = new ImageryLayer(provider);
        viewer.imageryLayers.add(layer);
        this.overlays.set(overlay.id, layer);
      }
    }
    layer.show = visible;
    layer.alpha = alpha;
    viewer.scene.requestRender();
  }

  hideOverlaysExcept(ids: ReadonlySet<string>): void {
    for (const [id, layer] of this.overlays) if (!ids.has(id)) layer.show = false;
    this.viewer?.scene.requestRender();
  }

  /** Replace a named marker group. */
  setMarkers(group: string, specs: readonly MarkerSpec[], alpha = 1): void {
    const viewer = this.viewer;
    if (!viewer) return;
    for (const e of this.markers.get(group) ?? []) viewer.entities.remove(e);
    const ellipsoid = this.ellipsoid;
    const entities: Entity[] = [];
    for (const m of specs) {
      // Slightly above the ellipsoid so the globe's depth test hides markers on the far side.
      const position = new ConstantPositionProperty(Cartesian3.fromDegrees(m.lon, m.lat, MARKER_HEIGHT_M, ellipsoid));
      const color = Color.fromCssColorString(m.color).withAlpha(alpha);
      entities.push(
        viewer.entities.add({
          id: `${group}:${m.id}`,
          position,
          point: {
            pixelSize: m.size,
            color,
            outlineColor: Color.fromCssColorString(m.outline).withAlpha(alpha),
            outlineWidth: 2,
            heightReference: HeightReference.NONE,
            disableDepthTestDistance: NEAR_NO_DEPTH_TEST_M,
          },
          ...(m.label
            ? {
                label: {
                  text: m.label,
                  font: '600 13px Inter, system-ui, sans-serif',
                  fillColor: Color.fromCssColorString('#e6edf3').withAlpha(alpha),
                  outlineColor: Color.fromCssColorString('#05070b'),
                  outlineWidth: 3,
                  style: LabelStyle.FILL_AND_OUTLINE,
                  verticalOrigin: VerticalOrigin.BOTTOM,
                  pixelOffset: new Cartesian2(0, -12),
                  disableDepthTestDistance: NEAR_NO_DEPTH_TEST_M,
                  translucencyByDistance: new NearFarScalar(1e6, 1, 4e7, 0.85),
                },
              }
            : {}),
          ...(m.radiusKm
            ? {
                ellipse: {
                  semiMajorAxis: m.radiusKm * 1000,
                  semiMinorAxis: m.radiusKm * 1000,
                  material: new ColorMaterialProperty(color.withAlpha(0.18 * alpha)),
                  outline: true,
                  outlineColor: color,
                  height: 0,
                },
              }
            : {}),
        }),
      );
    }
    this.markers.set(group, entities);
    viewer.scene.requestRender();
  }

  /**
   * A thin translucent glass ring (a short cylinder slightly wider than the planet) gliding
   * pole to pole — the "scan" from reference video 01. Purely decorative; it never changes data.
   * Only its modelMatrix changes per frame, so no geometry is rebuilt while it moves.
   */
  setScan(active: boolean, animate: boolean): void {
    const viewer = this.viewer;
    if (!viewer) return;
    if (active && this.scan) return; // already sweeping
    if (this.scan) {
      this.scan.stop();
      viewer.scene.primitives.remove(this.scan.primitive);
      this.scan = null;
    }
    viewer.scene.requestRenderMode = true;
    if (!active) {
      viewer.scene.requestRender();
      return;
    }
    const r = this.ellipsoid.radii;
    const primitive = new Primitive({
      geometryInstances: new GeometryInstance({
        geometry: new CylinderGeometry({
          length: r.z * 0.2,
          topRadius: r.x * 1.045,
          bottomRadius: r.x * 1.045,
          slices: 180,
          vertexFormat: PerInstanceColorAppearance.FLAT_VERTEX_FORMAT,
        }),
        attributes: {
          color: ColorGeometryInstanceAttribute.fromColor(Color.fromCssColorString('#a8dcff').withAlpha(0.17)),
        },
      }),
      appearance: new PerInstanceColorAppearance({ flat: true, translucent: true, closed: false }),
      asynchronous: false,
      modelMatrix: Matrix4.fromTranslation(new Cartesian3(0, 0, r.z * 0.25)),
    });
    viewer.scene.primitives.add(primitive);
    const t0 = performance.now();
    const offset = new Cartesian3();
    const stop = animate
      ? viewer.scene.preRender.addEventListener(() => {
          const phase = ((performance.now() - t0) / 1000 / SCAN_PERIOD_S) % 2;
          const k = phase < 1 ? phase : 2 - phase; // ping-pong 0..1
          const eased = k * k * (3 - 2 * k);
          offset.z = r.z * (0.7 - 1.4 * eased);
          Matrix4.fromTranslation(offset, primitive.modelMatrix);
        })
      : () => undefined;
    this.scan = { primitive, stop };
    viewer.scene.requestRenderMode = !animate;
    viewer.scene.requestRender();
  }

  flyTo(view: View, durationSec = 2.2): void {
    const viewer = this.viewer;
    if (!viewer) return;
    const destination = Cartesian3.fromDegrees(view.lon, view.lat, view.height, this.ellipsoid);
    const orientation = { heading: 0, pitch: CesiumMath.toRadians(-90), roll: 0 };
    if (durationSec <= 0) viewer.camera.setView({ destination, orientation });
    else
      viewer.camera.flyTo({
        destination,
        orientation,
        duration: durationSec,
        easingFunction: EasingFunction.QUINTIC_IN_OUT,
      });
  }

  private installPicking(viewer: Viewer, ellipsoid: Ellipsoid): void {
    this.handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
    this.handler.setInputAction((ev: ScreenSpaceEventHandler.PositionedEvent) => {
      const picked: unknown = viewer.scene.pick(ev.position);
      const entity = (picked as { id?: unknown } | undefined)?.id;
      if (defined(entity) && typeof (entity as Entity).id === 'string') {
        const [, id] = (entity as Entity).id.split(':');
        if (id) {
          this.events.onPick({ kind: 'marker', id });
          return;
        }
      }
      const cartesian = viewer.camera.pickEllipsoid(ev.position, ellipsoid);
      if (!cartesian) return;
      const carto = ellipsoid.cartesianToCartographic(cartesian);
      this.events.onPick({
        kind: 'point',
        lon: CesiumMath.toDegrees(carto.longitude),
        lat: CesiumMath.toDegrees(carto.latitude),
      });
    }, ScreenSpaceEventType.LEFT_CLICK);
  }

  destroy(): void {
    this.handler?.destroy();
    this.handler = null;
    this.overlays.clear();
    this.markers.clear();
    this.scan?.stop();
    this.scan = null;
    this.baseLayer = null;
    if (this.viewer && !this.viewer.isDestroyed()) this.viewer.destroy();
    this.viewer = null;
    this.body = null;
  }

  /** Exposed for tests (window.__analogFinder). */
  debugInfo(): { body: Body | null; ellipsoidRadii: number[]; layers: number } {
    const r = this.viewer?.scene.globe.ellipsoid.radii;
    return {
      body: this.body,
      ellipsoidRadii: r ? [r.x, r.y, r.z] : [],
      layers: this.viewer?.imageryLayers.length ?? 0,
    };
  }
}
