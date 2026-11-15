// One three.js scene holding the Moon, Earth and Mars together (not to scale), the dotted regions
// on each body, and glowing arcs that link every Mars/Moon target to its Earth analogs.
// Views: "system" (all three), "body" (one globe), "region" (dived into one dotted area).
import {
  ACESFilmicToneMapping,
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  CubicBezierCurve3,
  DirectionalLight,
  Group,
  Line,
  LineBasicMaterial,
  LineLoop,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  Points,
  Raycaster,
  SRGBColorSpace,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Texture,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { IMAGERY, type Body } from '../data/config';
import type { Link, Region, RegionKind } from '../data/regions';
import { angularDistanceDeg, easeInOutCubic, latLonToVec3, vec3ToLatLon } from './geo';
import { arcMaterial, atmosphereMaterial, num, regionMaterial, starMaterial } from './materials';
import { RegionPatch } from './patch';

export type View = 'system' | 'body' | 'region';

/** Not to scale: sizes chosen for legibility, ordered like the real bodies. */
export const BODY_RADIUS: Record<Body, number> = { earth: 1, mars: 0.62, moon: 0.42 };
const BODY_CENTER: Record<Body, Vector3> = {
  moon: new Vector3(-3.15, 0.35, -0.6),
  earth: new Vector3(0, 0, 0),
  mars: new Vector3(3.45, -0.2, -1.1),
};
const BODY_TINT: Record<Body, string> = { earth: '#7fd0ff', moon: '#d9e1ec', mars: '#ff9d6e' };
const SPIN: Record<Body, number> = { earth: 0.045, moon: 0.02, mars: 0.035 };
export const KIND_COLOR: Record<RegionKind, string> = {
  target: '#ffffff',
  known: '#5fe0a6',
  egypt: '#f6c766',
  ranked: '#8fe7ff',
};

interface BodyNode {
  pivot: Group; // spins; regions, arcs endpoints and patches live in its frame
  mesh: Mesh<SphereGeometry, MeshStandardMaterial>;
  radius: number;
}
interface RegionNode {
  region: Region;
  points: Points<BufferGeometry, ShaderMaterial>;
  local: Vector3; // centre in body-local coordinates (surface)
}
interface ArcNode {
  link: Link;
  line: Line<BufferGeometry, ShaderMaterial>;
  from: RegionNode;
  to: RegionNode;
}
interface Pose {
  position: Vector3;
  target: Vector3;
}

const ARC_SEGMENTS = 72;
/** Side of each body facing away from the others: close-ups are framed from there. */
const AWAY_SIDE: Record<Body, Vector3> = {
  earth: new Vector3(0, 0, 1),
  moon: new Vector3(-1, 0, 0.45).normalize(),
  mars: new Vector3(1, 0, 0.5).normalize(),
};
const Y_AXIS = new Vector3(0, 1, 0);
/** Camera height above the surface when diving into a region, in body radii. */
const REGION_ALTITUDE: Record<Body | 'ranked', number> = { earth: 0.24, mars: 0.3, moon: 0.32, ranked: 0.1 };
const SYSTEM_POSE: Pose = { position: new Vector3(0.35, 1.5, 10.4), target: new Vector3(0.15, 0, -0.45) };
const tmpA = new Vector3();
const tmpB = new Vector3();
const tmpC = new Vector3();
const tmpD = new Vector3();

export class Space {
  readonly renderer: WebGLRenderer;
  readonly camera = new PerspectiveCamera(32, 1, 0.005, 2000);
  private readonly scene = new Scene();
  private readonly controls: OrbitControls;
  private readonly key = new DirectionalLight('#fff6ea', 2.7);
  private readonly bodies = {} as Record<Body, BodyNode>;
  private regions = new Map<string, RegionNode>();
  private arcs: ArcNode[] = [];
  private stars: Points<BufferGeometry, ShaderMaterial>;
  private orbit: LineLoop<BufferGeometry, LineBasicMaterial>;
  private readonly patch = new RegionPatch();
  private readonly raycaster = new Raycaster();
  private time = 0;
  private last = performance.now();
  private frame = 0;
  private flight: { from: Pose; to: Pose; t: number; dur: number; path?: CubicBezierCurve3; done: () => void } | null =
    null;

  view: View = 'system';
  focusBody: Body | null = null;
  selected: string | null = null;
  hovered: string | null = null;
  regionsVisible = true;
  /** Close-up orientation per body (radians about Y); cleared in the system view so they spin. */
  private turnTo: Partial<Record<Body, number>> = {};
  /** Arcs in focus (selected/hovered region, or a target set); null = default per view. */
  private emphasis: Set<string> | null = null;

  constructor(
    private readonly host: HTMLElement,
    textures: Record<Body, Texture>,
  ) {
    const pr = Math.min(window.devicePixelRatio || 1, 1.75);
    this.renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(pr);
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    host.append(this.renderer.domElement);

    this.scene.add(this.key, this.key.target, new AmbientLight('#8fa6c8', 0.16));
    this.stars = this.makeStars(pr);
    this.scene.add(this.stars);
    for (const body of ['moon', 'earth', 'mars'] as const) this.bodies[body] = this.makeBody(body, textures[body]);
    this.orbit = this.makeMoonOrbit();
    this.scene.add(this.orbit);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.rotateSpeed = 0.55;
    this.controls.zoomSpeed = 0.7;
    this.setPose(SYSTEM_POSE);
    this.applyLimits();

    this.resize();
    window.addEventListener('resize', this.resize);
    this.renderer.setAnimationLoop(this.tick);
  }

  /* ------------------------------------------------------------ building */

  private makeStars(pr: number): Points<BufferGeometry, ShaderMaterial> {
    const n = 3200;
    const pos = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const phase = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1;
      const t = Math.random() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      pos.set([s * Math.cos(t) * 600, u * 600, s * Math.sin(t) * 600], i * 3);
      size[i] = 0.6 + Math.random() ** 3 * 2.4;
      phase[i] = Math.random() * 6.28;
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setAttribute('aSize', new BufferAttribute(size, 1));
    g.setAttribute('aPhase', new BufferAttribute(phase, 1));
    return new Points(g, starMaterial(pr));
  }

  private makeBody(body: Body, texture: Texture): BodyNode {
    const radius = BODY_RADIUS[body];
    const pivot = new Group();
    pivot.position.copy(BODY_CENTER[body]);
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    const mesh = new Mesh(
      new SphereGeometry(radius, 128, 96),
      new MeshStandardMaterial({ map: texture, roughness: body === 'earth' ? 0.78 : 0.95, metalness: 0 }),
    );
    mesh.userData.body = body;
    pivot.add(mesh);
    if (body !== 'moon') {
      const atmo = new Mesh(
        new SphereGeometry(radius * (body === 'earth' ? 1.035 : 1.02), 96, 64),
        body === 'earth' ? atmosphereMaterial('#5fb6ff', 1.25, 3.2) : atmosphereMaterial('#ff9a6a', 0.55, 4.0),
      );
      pivot.add(atmo);
    }
    // Present the side with the sites that matter first.
    pivot.rotation.y = body === 'earth' ? -0.45 : body === 'mars' ? -2.6 : 0.2;
    this.scene.add(pivot);
    return { pivot, mesh, radius };
  }

  /** A faint orbit line around Earth through the Moon (as in the reference: Earth, Moon, orbit). */
  private makeMoonOrbit(): LineLoop<BufferGeometry, LineBasicMaterial> {
    // A circle around Earth that passes through the Moon, tilted towards the viewer so it opens
    // into a thin ellipse wrapping the planet.
    const m = BODY_CENTER.moon;
    const r = m.length();
    const u = m.clone().normalize();
    const w = new Vector3(0.15, -0.32, 1);
    const v = w.sub(u.clone().multiplyScalar(w.dot(u))).normalize();
    const pts: Vector3[] = [];
    for (let i = 0; i < 256; i++) {
      const a = (i / 256) * Math.PI * 2;
      pts.push(
        u
          .clone()
          .multiplyScalar(Math.cos(a) * r)
          .addScaledVector(v, Math.sin(a) * r),
      );
    }
    const g = new BufferGeometry().setFromPoints(pts);
    return new LineLoop(
      g,
      new LineBasicMaterial({ color: '#cfdcf0', transparent: true, opacity: 0.12, depthWrite: false }),
    );
  }

  /** Replace all regions and links. */
  setGraph(regions: Region[], links: Link[]): void {
    for (const n of this.regions.values()) {
      n.points.removeFromParent();
      n.points.geometry.dispose();
      n.points.material.dispose();
    }
    for (const a of this.arcs) {
      a.line.removeFromParent();
      a.line.geometry.dispose();
      a.line.material.dispose();
    }
    this.regions.clear();
    this.arcs = [];
    const pr = this.renderer.getPixelRatio();
    regions.forEach((region, i) => {
      const node = this.bodies[region.body];
      const points = new Points(
        this.dotGeometry(region, node.radius),
        regionMaterial(KIND_COLOR[region.kind], pr, i * 1.7),
      );
      points.renderOrder = 2;
      node.pivot.add(points);
      this.regions.set(region.id, { region, points, local: latLonToVec3(region.lat, region.lon, node.radius) });
    });
    links.forEach((link, i) => {
      const from = this.regions.get(link.from);
      const to = this.regions.get(link.to);
      if (!from || !to) return;
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(new Float32Array((ARC_SEGMENTS + 1) * 3), 3));
      const u = new Float32Array(ARC_SEGMENTS + 1).map((_, k) => k / ARC_SEGMENTS);
      g.setAttribute('aU', new BufferAttribute(u, 1));
      const line = new Line(g, arcMaterial(BODY_TINT[from.region.body], KIND_COLOR[to.region.kind], i * 0.37));
      line.frustumCulled = false;
      line.renderOrder = 3;
      this.scene.add(line);
      this.arcs.push({ link, line, from, to });
    });
    this.refreshStates();
  }

  /** Hex-packed dots inside a spherical cap around the region centre. */
  private dotGeometry(region: Region, radius: number): BufferGeometry {
    const center = latLonToVec3(region.lat, region.lon, 1);
    const east = new Vector3(0, 1, 0).cross(center);
    if (east.lengthSq() < 1e-6) east.set(1, 0, 0);
    east.normalize();
    const north = center.clone().cross(east).normalize();
    const capRad = (region.radiusDeg * Math.PI) / 180;
    const step = capRad / (region.kind === 'ranked' ? 3.2 : 6.5);
    const pos: number[] = [];
    const dist: number[] = [];
    const rings = Math.ceil(capRad / step);
    for (let j = -rings; j <= rings; j++)
      for (let i = -rings; i <= rings; i++) {
        const x = (i + (j % 2 ? 0.5 : 0)) * step;
        const y = j * step * 0.866;
        const d = Math.hypot(x, y);
        if (d > capRad) continue;
        const p = center
          .clone()
          .addScaledVector(east, x)
          .addScaledVector(north, y)
          .normalize()
          .multiplyScalar(radius * 1.006);
        pos.push(p.x, p.y, p.z);
        dist.push(d / capRad);
      }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute('aD', new BufferAttribute(new Float32Array(dist), 1));
    return g;
  }

  /* ------------------------------------------------------------ state */

  setRegionsVisible(v: boolean): void {
    this.regionsVisible = v;
    this.refreshStates();
  }

  setHovered(id: string | null): void {
    if (id === this.hovered) return;
    this.hovered = id;
    this.refreshStates();
  }

  setSelected(id: string | null): void {
    this.selected = id;
    this.refreshStates();
  }

  /** Emphasise the arcs touching these region ids (null = default for the view). */
  setEmphasis(ids: string[] | null): void {
    this.emphasis = ids ? new Set(ids) : null;
  }

  private refreshStates(): void {
    for (const [id, n] of this.regions) {
      n.points.visible = this.regionsVisible;
      num(n.points.material, 'uState').value = id === this.selected ? 2 : id === this.hovered ? 1 : 0;
      // Inside a region, the others step back so the chosen one reads clearly.
      num(n.points.material, 'uOpacity').value =
        this.view === 'region' && id !== this.selected && id !== this.hovered ? 0.3 : 1;
    }
  }

  region(id: string): Region | undefined {
    return this.regions.get(id)?.region;
  }

  /* ------------------------------------------------------------ picking */

  /** Region (or body) under a client point. */
  pick(clientX: number, clientY: number): { body: Body; region: Region | null } | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObjects(
      Object.values(this.bodies).map((b) => b.mesh),
      false,
    )[0];
    if (!hit) return null;
    const body = hit.object.userData.body as Body;
    if (!this.regionsVisible) return { body, region: null };
    const local = this.bodies[body].pivot.worldToLocal(hit.point.clone());
    const { lat, lon } = vec3ToLatLon(local);
    let best: Region | null = null;
    let bestD = Infinity;
    for (const { region } of this.regions.values()) {
      if (region.body !== body) continue;
      const d = angularDistanceDeg(lat, lon, region.lat, region.lon);
      const reach = Math.max(region.radiusDeg * 1.25, 1.6);
      if (d <= reach && d / reach < bestD) {
        best = region;
        bestD = d / reach;
      }
    }
    return { body, region: best };
  }

  /* ------------------------------------------------------------ camera */

  private worldOf(n: RegionNode, out: Vector3): Vector3 {
    return this.bodies[n.region.body].pivot.localToWorld(out.copy(n.local));
  }

  private bodyCenter(body: Body): Vector3 {
    return this.bodies[body].pivot.getWorldPosition(new Vector3());
  }

  /**
   * Turn a body (smoothly, in tick) so that lat/lon faces its open side, away from the other
   * bodies; returns that point's world direction once the turn is complete.
   */
  private face(body: Body, lat: number, lon: number): Vector3 {
    const local = latLonToVec3(lat, lon, 1);
    const away = AWAY_SIDE[body];
    const wanted = Math.atan2(away.x, away.z) - Math.atan2(local.x, local.z);
    const cur = this.bodies[body].pivot.rotation.y;
    const target = cur + Math.atan2(Math.sin(wanted - cur), Math.cos(wanted - cur)); // the short way round
    this.turnTo[body] = target;
    return local.applyAxisAngle(Y_AXIS, target);
  }

  private poseForBody(body: Body, facing?: Region): Pose {
    const c = this.bodyCenter(body);
    const r = BODY_RADIUS[body];
    const dir = facing ? this.face(body, facing.lat, facing.lon) : this.camera.position.clone().sub(c).normalize();
    // A little above the facing point so the globe sits slightly low: cinematic framing.
    dir.add(new Vector3(0, 0.18, 0)).normalize();
    return { position: c.clone().addScaledVector(dir, r * 5.2), target: c };
  }

  private poseForRegion(region: Region): Pose {
    const c = this.bodyCenter(region.body);
    const r = BODY_RADIUS[region.body];
    const n = this.face(region.body, region.lat, region.lon);
    const altitude = REGION_ALTITUDE[region.kind === 'ranked' ? 'ranked' : region.body];
    return { position: c.clone().addScaledVector(n, r * (1 + altitude)), target: c };
  }

  private setPose(p: Pose): void {
    this.camera.position.copy(p.position);
    this.controls.target.copy(p.target);
    this.camera.lookAt(p.target);
  }

  private applyLimits(): void {
    if (this.view === 'system') {
      this.controls.minDistance = 4;
      this.controls.maxDistance = 22;
      this.controls.target.copy(SYSTEM_POSE.target);
    } else if (this.focusBody) {
      const r = BODY_RADIUS[this.focusBody];
      this.controls.minDistance = r * 1.12;
      this.controls.maxDistance = r * 7;
    }
  }

  private fly(to: Pose, dur: number, path?: CubicBezierCurve3): Promise<void> {
    this.flight?.done();
    this.controls.enabled = false;
    const from: Pose = { position: this.camera.position.clone(), target: this.controls.target.clone() };
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    return new Promise((resolve) => {
      this.flight = {
        from,
        to,
        t: 0,
        dur: reduce ? 0.001 : dur,
        ...(path ? { path } : {}),
        done: () => {
          this.flight = null;
          this.controls.enabled = true;
          resolve();
        },
      };
    });
  }

  async toSystem(): Promise<void> {
    this.view = 'system';
    this.turnTo = {};
    this.refreshStates();
    this.focusBody = null;
    this.patch.clear();
    this.applyLimits();
    await this.fly(SYSTEM_POSE, 2.2);
  }

  async toBody(body: Body, facing?: Region): Promise<void> {
    this.view = 'body';
    this.refreshStates();
    this.focusBody = body;
    this.patch.clear();
    const pose = this.poseForBody(body, facing);
    this.applyLimits();
    await this.fly(pose, 2.2);
  }

  async toRegion(region: Region): Promise<void> {
    const travel = this.focusBody !== null && this.focusBody !== region.body;
    const fromNode = this.selected ? this.regions.get(this.selected) : undefined;
    this.view = 'region';
    this.refreshStates();
    this.focusBody = region.body;
    this.applyLimits();
    this.patch.clear();
    const pose = this.poseForRegion(region);
    let path: CubicBezierCurve3 | undefined;
    if (travel) {
      // Fly across space along a sweeping curve, like following the arc between the bodies.
      const p0 = this.camera.position.clone();
      const out0 = p0.clone().sub(this.controls.target).normalize().multiplyScalar(3.2);
      const out1 = pose.position.clone().sub(pose.target).normalize().multiplyScalar(3.2);
      path = new CubicBezierCurve3(p0, p0.clone().add(out0), pose.position.clone().add(out1), pose.position.clone());
    }
    this.setEmphasis(fromNode ? [fromNode.region.id, region.id] : [region.id]);
    await this.fly(pose, travel ? 3.6 : 2.0, path);
    const layer = IMAGERY[region.body].color;
    // Cover the whole close-up view (ground half-width is about altitude x 45 degrees) with margin.
    const half = REGION_ALTITUDE[region.kind === 'ranked' ? 'ranked' : region.body] * 62;
    void this.patch.show(this.bodies[region.body].pivot, BODY_RADIUS[region.body], layer, region.lat, region.lon, half);
  }

  /* ------------------------------------------------------------ frame */

  private readonly resize = (): void => {
    const w = this.host.clientWidth || window.innerWidth;
    const h = this.host.clientHeight || window.innerHeight;
    this.camera.aspect = w / Math.max(h, 1);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  };

  private readonly tick = (): void => {
    if (document.hidden) return;
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.time += dt;
    this.frame++;

    if (this.view === 'system' && !this.flight)
      for (const b of ['moon', 'earth', 'mars'] as const) this.bodies[b].pivot.rotation.y += SPIN[b] * dt;
    // Close-ups: bodies glide to the orientation chosen by face().
    for (const b of ['moon', 'earth', 'mars'] as const) {
      const target = this.turnTo[b];
      if (target === undefined) continue;
      const pivot = this.bodies[b].pivot;
      pivot.rotation.y += (target - pivot.rotation.y) * (1 - Math.exp(-dt * 3.2));
    }

    if (this.flight) {
      const f = this.flight;
      f.t = Math.min(1, f.t + dt / f.dur);
      const k = easeInOutCubic(f.t);
      if (f.path) f.path.getPoint(k, this.camera.position);
      else this.camera.position.lerpVectors(f.from.position, f.to.position, k);
      this.controls.target.lerpVectors(f.from.target, f.to.target, k);
      this.camera.lookAt(this.controls.target);
      if (f.t >= 1) f.done();
    } else {
      this.controls.update();
    }

    // Key light rides with the camera, from its upper left: every view reads as sunlit relief.
    tmpA.set(-4.5, 3.2, 2).applyQuaternion(this.camera.quaternion);
    this.key.position.copy(this.camera.position).add(tmpA);
    this.key.target.position.copy(this.controls.target);

    num(this.stars.material, 'uTime').value = this.time;
    for (const n of this.regions.values()) num(n.points.material, 'uTime').value = this.time;
    this.orbit.material.opacity += ((this.view === 'system' ? 0.12 : 0) - this.orbit.material.opacity) * 0.08;
    this.scene.updateMatrixWorld();
    this.updateArcs();
    this.patch.update(dt);
    this.renderer.render(this.scene, this.camera);
  };

  private arcAlpha(a: ArcNode): number {
    if (!this.regionsVisible) return 0;
    const touches = (ids: Set<string> | null): boolean => !!ids && (ids.has(a.link.from) || ids.has(a.link.to));
    const live = new Set([this.hovered, this.selected].filter((x): x is string => !!x));
    if (live.size && touches(live)) return 1;
    if (this.emphasis && touches(this.emphasis)) return 0.85;
    if (a.link.kind === 'ranked') return this.selected === a.link.from ? 0.6 : 0;
    if (this.view === 'system') return live.size ? 0.15 : 0.75;
    if (this.view === 'body')
      return a.from.region.body === this.focusBody || a.to.region.body === this.focusBody ? 0.55 : 0;
    return 0;
  }

  private updateArcs(): void {
    for (const a of this.arcs) {
      const mat = a.line.material;
      const want = this.arcAlpha(a);
      num(mat, 'uAlpha').value += (want - num(mat, 'uAlpha').value) * 0.1;
      num(mat, 'uTime').value = this.time;
      a.line.visible = num(mat, 'uAlpha').value > 0.005;
      if (!a.line.visible) continue;
      const p0 = this.worldOf(a.from, tmpA);
      const p3 = this.worldOf(a.to, tmpB);
      const c0 = this.bodyCenter(a.from.region.body);
      const c3 = this.bodyCenter(a.to.region.body);
      const span = p0.distanceTo(p3);
      const p1 = tmpC
        .copy(p0)
        .sub(c0)
        .normalize()
        .multiplyScalar(span * 0.38)
        .add(p0);
      const p2 = tmpD
        .copy(p3)
        .sub(c3)
        .normalize()
        .multiplyScalar(span * 0.38)
        .add(p3);
      const curve = new CubicBezierCurve3(p0.clone(), p1.clone(), p2.clone(), p3.clone());
      const attr = a.line.geometry.getAttribute('position') as BufferAttribute;
      for (let k = 0; k <= ARC_SEGMENTS; k++) {
        curve.getPoint(k / ARC_SEGMENTS, tmpA);
        attr.setXYZ(k, tmpA.x, tmpA.y, tmpA.z);
      }
      attr.needsUpdate = true;
    }
  }

  /** Debug/test hook. */
  debug(): {
    view: View;
    body: Body | null;
    selected: string | null;
    regions: number;
    visible: boolean;
    patch: string;
    tiles: number;
  } {
    return {
      view: this.view,
      body: this.focusBody,
      selected: this.selected,
      regions: this.regions.size,
      visible: this.regionsVisible,
      patch: this.patch.state,
      tiles: this.patch.tiles,
    };
  }

  dispose(): void {
    this.renderer.setAnimationLoop(null);
    window.removeEventListener('resize', this.resize);
    this.controls.dispose();
    this.renderer.dispose();
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  get frames(): number {
    return this.frame;
  }

  /** Bodies' parent objects (for tests / extensions). */
  pivot(body: Body): Object3D {
    return this.bodies[body].pivot;
  }
}
