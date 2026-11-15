// One three.js scene with the Moon, Earth and Mars side by side (not to scale).
//
// Interaction (no orbiting camera, so nothing moves unless you move it):
//   drag a planet       turn that planet only
//   drag empty space    pan left / right / up / down
//   wheel / pinch       zoom toward the cursor, freely in and out
//   click               a planet to frame it, a dotted region to dive into it
// The view level (system / body / region) is derived from where the camera actually is, so zooming
// out of a region or a planet simply takes you back up, and the UI follows.
import {
  ACESFilmicToneMapping,
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  CubicBezierCurve3,
  DirectionalLight,
  Group,
  Line,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Plane,
  Points,
  Quaternion,
  Raycaster,
  SRGBColorSpace,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Texture,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Material,
} from 'three';
import { IMAGERY, type Body } from '../data/config';
import type { Link, Region, RegionKind } from '../data/regions';
import { angularDistanceDeg, easeInOutCubic, latLonToVec3, vec3ToLatLon } from './geo';
import { arcMaterial, atmosphereMaterial, earthMaterial, num, regionMaterial, starMaterial } from './materials';
import { RegionPatch } from './patch';

export type View = 'system' | 'body' | 'region';
export interface BodyTextures {
  moon: Texture;
  mars: Texture;
  earth: Texture;
  earthNight: Texture;
  earthWater: Texture;
}

/** Not to scale: sizes chosen for legibility, ordered like the real bodies. */
export const BODY_RADIUS: Record<Body, number> = { earth: 1, mars: 0.66, moon: 0.46 };
const BODY_CENTER: Record<Body, Vector3> = {
  moon: new Vector3(-3.05, 0, 0),
  earth: new Vector3(0, 0, 0),
  mars: new Vector3(3.2, 0, 0),
};
const BODY_TINT: Record<Body, string> = { earth: '#cfe3ff', moon: '#e6e8f2', mars: '#ffc4a8' };
export const KIND_COLOR: Record<RegionKind, string> = {
  target: '#ffffff',
  known: '#9fe3d0',
  egypt: '#ecd29a',
  ranked: '#b9bcff',
};
/** Sunlight comes from the upper left, slightly in front: every body shows a terminator. */
const LIGHT_DIR = new Vector3(-0.72, 0.42, 0.9).normalize();
const SYSTEM_CAM = new Vector3(0.08, 0, 8.6);
const MAX_Z = 13;
const PAN_LIMIT = new Vector2(5.2, 3.2);
/** Camera height above the surface when diving into a region, in body radii. */
const REGION_ALTITUDE: Record<Body | 'ranked', number> = { earth: 0.26, mars: 0.32, moon: 0.34, ranked: 0.12 };
const BODY_FRAME = 4.3; // camera distance when framing a body, in radii
const ARC_SEGMENTS = 72;
const IDLE_SPIN = 0.035; // rad/s, system view only, until the user touches that body
const Y = new Vector3(0, 1, 0);
const X = new Vector3(1, 0, 0);
const tmp = new Vector3();
const tmp2 = new Vector3();

interface BodyNode {
  pivot: Group;
  mesh: Mesh;
  radius: number;
}
interface RegionNode {
  region: Region;
  points: Points<BufferGeometry, ShaderMaterial>;
  local: Vector3; // surface point in body-local coordinates
}
interface ArcNode {
  link: Link;
  line: Line<BufferGeometry, ShaderMaterial>;
  from: RegionNode;
  to: RegionNode;
}
interface Flight {
  path: CubicBezierCurve3;
  t: number;
  dur: number;
  done: () => void;
}
export interface SpaceEvents {
  click(hit: { body: Body; region: Region | null } | null): void;
  /** The camera moved into another view level (by flight, scroll or pan). */
  view(view: View, body: Body | null): void;
  /** Any direct manipulation (drag, wheel, pinch). */
  interact(): void;
}

export class Space {
  readonly renderer: WebGLRenderer;
  readonly camera = new PerspectiveCamera(36, 1, 0.01, 2000);
  private readonly scene = new Scene();
  private readonly bodies = {} as Record<Body, BodyNode>;
  private regions = new Map<string, RegionNode>();
  private arcs: ArcNode[] = [];
  private readonly stars: Points<BufferGeometry, ShaderMaterial>;
  private readonly patch = new RegionPatch();
  private readonly raycaster = new Raycaster();
  private readonly camGoal = SYSTEM_CAM.clone();
  private readonly turnTo = new Map<Body, Quaternion>();
  private flight: Flight | null = null;
  private time = 0;
  private last = performance.now();

  view: View = 'system';
  focusBody: Body | null = null;
  selected: string | null = null;
  hovered: string | null = null;
  regionsVisible = true;
  /** Gentle spin until the first interaction; after that nothing moves unless you move it. */
  private idle = true;

  constructor(
    private readonly host: HTMLElement,
    textures: BodyTextures,
    private readonly events: SpaceEvents,
  ) {
    const pr = Math.min(window.devicePixelRatio || 1, 1.75);
    this.renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(pr);
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    host.append(this.renderer.domElement);

    const sun = new DirectionalLight('#fff4e6', 2.9);
    sun.position.copy(LIGHT_DIR).multiplyScalar(50);
    this.scene.add(sun, new AmbientLight('#8c8fd0', 0.1));
    this.stars = this.makeStars(pr);
    this.scene.add(this.stars);

    const aniso = this.renderer.capabilities.getMaxAnisotropy();
    const all = [textures.moon, textures.mars, textures.earth, textures.earthNight, textures.earthWater];
    for (const t of all) {
      t.anisotropy = aniso;
      t.needsUpdate = true;
    }
    for (const t of [textures.moon, textures.mars, textures.earth, textures.earthNight]) t.colorSpace = SRGBColorSpace;
    this.makeBody('earth', earthMaterial(textures.earth, textures.earthNight, textures.earthWater, LIGHT_DIR));
    this.makeBody('moon', new MeshStandardMaterial({ map: textures.moon, roughness: 1, metalness: 0 }));
    this.makeBody('mars', new MeshStandardMaterial({ map: textures.mars, roughness: 0.95, metalness: 0 }));
    this.addAtmosphere('earth', '#6fa8ff', 0.95, 4.4, 1.022);
    this.addAtmosphere('mars', '#e8a07a', 0.45, 4.2, 1.02);

    this.camera.position.copy(SYSTEM_CAM);
    this.camera.lookAt(SYSTEM_CAM.x, SYSTEM_CAM.y, 0);
    this.resize();
    window.addEventListener('resize', this.resize);
    this.bindInput();
    this.renderer.setAnimationLoop(this.tick);
  }

  /* ------------------------------------------------------------ building */

  private makeStars(pr: number): Points<BufferGeometry, ShaderMaterial> {
    const n = 2600;
    const pos = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const phase = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1;
      const t = Math.random() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      pos.set([s * Math.cos(t) * 600, u * 600, -Math.abs(s * Math.sin(t)) * 600 - 50], i * 3);
      size[i] = 0.5 + Math.random() ** 4 * 2.2;
      phase[i] = Math.random() * 6.28;
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setAttribute('aSize', new BufferAttribute(size, 1));
    g.setAttribute('aPhase', new BufferAttribute(phase, 1));
    return new Points(g, starMaterial(pr));
  }

  private makeBody(body: Body, material: Material): void {
    const radius = BODY_RADIUS[body];
    const pivot = new Group();
    pivot.position.copy(BODY_CENTER[body]);
    const mesh = new Mesh(new SphereGeometry(radius, 128, 96), material);
    mesh.userData.body = body;
    pivot.add(mesh);
    // Present a meaningful side first (Africa and Egypt, Tharsis and Medusae, the near side).
    pivot.quaternion.setFromAxisAngle(Y, body === 'earth' ? -0.52 : body === 'mars' ? 2.2 : 0.15);
    this.scene.add(pivot);
    this.bodies[body] = { pivot, mesh, radius };
  }

  private addAtmosphere(body: Body, color: string, strength: number, power: number, scale: number): void {
    const node = this.bodies[body];
    node.pivot.add(
      new Mesh(new SphereGeometry(node.radius * scale, 96, 64), atmosphereMaterial(color, strength, power, LIGHT_DIR)),
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
      g.setAttribute(
        'aU',
        new BufferAttribute(
          new Float32Array(ARC_SEGMENTS + 1).map((_, k) => k / ARC_SEGMENTS),
          1,
        ),
      );
      const line = new Line(g, arcMaterial(BODY_TINT[from.region.body], KIND_COLOR[to.region.kind], i * 0.37));
      line.frustumCulled = false;
      line.renderOrder = 3;
      line.visible = false;
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
    if (!id) this.patch.clear();
    this.refreshStates();
  }

  private refreshStates(): void {
    for (const [id, n] of this.regions) {
      n.points.visible = this.regionsVisible;
      num(n.points.material, 'uState').value = id === this.selected ? 2 : id === this.hovered ? 1 : 0;
      // Inside a region the imagery leads: the open region's dots soften, the others step back.
      const inside = this.view === 'region';
      num(n.points.material, 'uOpacity').value =
        id === this.selected ? (inside ? 0.45 : 1) : this.selected && id !== this.hovered ? 0.3 : 1;
    }
  }

  region(id: string): Region | undefined {
    return this.regions.get(id)?.region;
  }

  /* ------------------------------------------------------------ picking */

  private ndc(clientX: number, clientY: number): Vector2 {
    const rect = this.renderer.domElement.getBoundingClientRect();
    return new Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  }

  private hitBody(clientX: number, clientY: number): { body: Body; point: Vector3 } | null {
    this.raycaster.setFromCamera(this.ndc(clientX, clientY), this.camera);
    const hit = this.raycaster.intersectObjects(
      Object.values(this.bodies).map((b) => b.mesh),
      false,
    )[0];
    return hit ? { body: hit.object.userData.body as Body, point: hit.point } : null;
  }

  /** Region (or body) under a client point. */
  pick(clientX: number, clientY: number): { body: Body; region: Region | null } | null {
    const hit = this.hitBody(clientX, clientY);
    if (!hit) return null;
    if (!this.regionsVisible) return { body: hit.body, region: null };
    const { lat, lon } = vec3ToLatLon(this.bodies[hit.body].pivot.worldToLocal(hit.point.clone()));
    let best: Region | null = null;
    let bestD = Infinity;
    for (const { region } of this.regions.values()) {
      if (region.body !== hit.body) continue;
      const reach = Math.max(region.radiusDeg * 1.25, 1.6);
      const d = angularDistanceDeg(lat, lon, region.lat, region.lon) / reach;
      if (d <= 1 && d < bestD) {
        best = region;
        bestD = d;
      }
    }
    return { body: hit.body, region: best };
  }

  /* ------------------------------------------------------------ input */

  private bindInput(): void {
    const el = this.renderer.domElement;
    const pointers = new Map<number, { x: number; y: number }>();
    let drag: { mode: 'turn' | 'pan'; body: Body | null; x: number; y: number; moved: boolean } | null = null;
    let pinch = 0;

    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        drag = null;
        return;
      }
      const hit = e.button === 0 && !e.shiftKey ? this.hitBody(e.clientX, e.clientY) : null;
      drag = { mode: hit ? 'turn' : 'pan', body: hit?.body ?? null, x: e.clientX, y: e.clientY, moved: false };
    });
    el.addEventListener('pointermove', (e) => {
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        if (pinch > 0) this.zoomAt((a!.x + b!.x) / 2, (a!.y + b!.y) / 2, pinch / d);
        pinch = d;
        return;
      }
      if (!drag) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 4) return;
      if (!drag.moved) this.events.interact();
      drag.moved = true;
      drag.x = e.clientX;
      drag.y = e.clientY;
      if (drag.mode === 'turn' && drag.body) this.turn(drag.body, dx, dy);
      else this.pan(dx, dy);
    });
    const end = (e: PointerEvent): void => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = 0;
      if (drag && !drag.moved && e.type === 'pointerup') {
        this.idle = false;
        this.events.click(this.pick(e.clientX, e.clientY));
      }
      drag = null;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.events.interact();
        const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
        this.zoomAt(e.clientX, e.clientY, Math.exp(Math.max(-0.6, Math.min(0.6, dy * 0.0016))));
      },
      { passive: false },
    );
  }

  /** Turn one planet by a screen drag; the others do not move. */
  private turn(body: Body, dx: number, dy: number): void {
    this.idle = false;
    this.cancelFlight();
    const node = this.bodies[body];
    this.turnTo.delete(body);
    const speed = 0.0055 / Math.max(0.4, Math.min(2, this.zoomFactor(body)));
    const q = new Quaternion().setFromAxisAngle(Y, dx * speed);
    q.multiply(new Quaternion().setFromAxisAngle(X, dy * speed));
    node.pivot.quaternion.premultiply(q).normalize();
  }

  /** Below 1 when the camera is close to that body: turn more finely up close. */
  private zoomFactor(body: Body): number {
    return (this.camera.position.distanceTo(BODY_CENTER[body]) - BODY_RADIUS[body]) / (BODY_RADIUS[body] * 2);
  }

  /** World units per screen pixel at the z = 0 plane. */
  private worldPerPixel(): number {
    const h = this.renderer.domElement.clientHeight || 1;
    return (2 * Math.max(this.camGoal.z, 0.2) * Math.tan((this.camera.fov * Math.PI) / 360)) / h;
  }

  pan(dx: number, dy: number): void {
    this.idle = false;
    this.cancelFlight();
    const k = this.worldPerPixel();
    this.camGoal.x -= dx * k;
    this.camGoal.y += dy * k;
    this.clampGoal();
  }

  /** Zoom toward the point under the cursor (factor < 1 zooms in). */
  zoomAt(clientX: number, clientY: number, factor: number): void {
    this.idle = false;
    this.cancelFlight();
    this.raycaster.setFromCamera(this.ndc(clientX, clientY), this.camera);
    const hit = this.hitBody(clientX, clientY);
    const anchor = hit?.point ?? this.raycaster.ray.intersectPlane(new Plane(new Vector3(0, 0, 1), 0), new Vector3());
    if (!anchor) return;
    const goal = anchor.clone().add(this.camGoal.clone().sub(anchor).multiplyScalar(factor));
    // Keep z only; x/y follow the cursor ray so the point under the cursor stays put.
    this.camGoal.copy(goal);
    this.clampGoal();
  }

  /** Never inside a planet, never too far, never lost off to the side. */
  private clampGoal(): void {
    const g = this.camGoal;
    g.x = Math.max(-PAN_LIMIT.x, Math.min(PAN_LIMIT.x, g.x));
    g.y = Math.max(-PAN_LIMIT.y, Math.min(PAN_LIMIT.y, g.y));
    let minZ = 0.6;
    for (const b of ['moon', 'earth', 'mars'] as const) {
      const c = BODY_CENTER[b];
      const r = BODY_RADIUS[b];
      const dxy = Math.hypot(g.x - c.x, g.y - c.y);
      if (dxy < r * 1.05) minZ = Math.max(minZ, c.z + Math.sqrt(Math.max(r * r - dxy * dxy, 0)) + r * 0.07);
    }
    g.z = Math.max(minZ, Math.min(MAX_Z, g.z));
  }

  /* ------------------------------------------------------------ camera flights */

  private cancelFlight(): void {
    if (!this.flight) return;
    this.camGoal.copy(this.camera.position);
    this.flight.done();
  }

  private fly(to: Vector3, dur: number, arc = false): Promise<void> {
    this.flight?.done();
    const p0 = this.camera.position.clone();
    const lift = arc ? Math.max(p0.z, to.z, 7.5) : 0;
    const p1 = arc ? new Vector3(p0.x, p0.y, lift) : p0.clone().lerp(to, 1 / 3);
    const p2 = arc ? new Vector3(to.x, to.y, lift) : p0.clone().lerp(to, 2 / 3);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    return new Promise((resolve) => {
      this.flight = {
        path: new CubicBezierCurve3(p0, p1, p2, to.clone()),
        t: 0,
        dur: reduce ? 0.001 : dur,
        done: () => {
          this.flight = null;
          resolve();
        },
      };
      this.camGoal.copy(to);
    });
  }

  /**
   * Rotation that brings lat/lon to face the camera (+Z) with north up; the planet glides there.
   */
  private face(body: Body, lat: number, lon: number): void {
    const n = latLonToVec3(lat, lon, 1);
    let east = new Vector3(0, 1, 0).cross(n);
    if (east.lengthSq() < 1e-6) east = new Vector3(1, 0, 0);
    east.normalize();
    const north = n.clone().cross(east).normalize();
    const local = new Matrix4().makeBasis(east, north, n); // columns: local east, north, normal
    this.turnTo.set(body, new Quaternion().setFromRotationMatrix(local.invert()));
  }

  async toSystem(): Promise<void> {
    this.setSelected(null);
    await this.fly(SYSTEM_CAM, 2.0);
  }

  async toBody(body: Body): Promise<void> {
    this.setSelected(null);
    const c = BODY_CENTER[body];
    const travel = this.focusBody !== null && this.focusBody !== body;
    await this.fly(new Vector3(c.x, c.y, c.z + BODY_RADIUS[body] * BODY_FRAME), travel ? 2.6 : 2.0, travel);
  }

  async toRegion(region: Region): Promise<void> {
    const c = BODY_CENTER[region.body];
    const r = BODY_RADIUS[region.body];
    const travel = this.focusBody !== null && this.focusBody !== region.body;
    this.patch.clear();
    this.face(region.body, region.lat, region.lon);
    const alt = REGION_ALTITUDE[region.kind === 'ranked' ? 'ranked' : region.body];
    await this.fly(new Vector3(c.x, c.y, c.z + r * (1 + alt)), travel ? 3.4 : 2.2, travel);
    if (this.selected !== region.id) return;
    // Cover the whole close-up view (ground half-width is about altitude x 45 degrees) with margin.
    void this.patch.show(
      this.bodies[region.body].pivot,
      r,
      IMAGERY[region.body].color,
      region.lat,
      region.lon,
      alt * 62,
    );
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

    // Camera: either on a flight path, or easing toward the goal set by pan / zoom.
    if (this.flight) {
      const f = this.flight;
      f.t = Math.min(1, f.t + dt / f.dur);
      f.path.getPoint(easeInOutCubic(f.t), this.camera.position);
      if (f.t >= 1) f.done();
    } else {
      this.camera.position.lerp(this.camGoal, 1 - Math.exp(-dt * 9));
    }

    // Planets: glide to a requested orientation, or idle-spin in the system view.
    for (const b of ['moon', 'earth', 'mars'] as const) {
      const node = this.bodies[b];
      const want = this.turnTo.get(b);
      if (want) {
        node.pivot.quaternion.slerp(want, 1 - Math.exp(-dt * 3.4));
        if (node.pivot.quaternion.angleTo(want) < 1e-3) this.turnTo.delete(b);
      } else if (this.view === 'system' && this.idle) {
        node.pivot.quaternion.premultiply(tmpQ.setFromAxisAngle(Y, IDLE_SPIN * dt));
      }
    }

    this.updateView();
    num(this.stars.material, 'uTime').value = this.time;
    for (const n of this.regions.values()) num(n.points.material, 'uTime').value = this.time;
    this.scene.updateMatrixWorld();
    this.updateArcs();
    this.patch.update(dt);
    this.renderer.render(this.scene, this.camera);
  };

  /** Work out the view level from the camera position; tell the app when it changes. */
  private updateView(): void {
    // Mid-flight the camera passes through other levels on purpose: judge only where it lands.
    if (this.flight) return;
    const cam = this.camera.position;
    let body: Body | null = null;
    for (const b of ['moon', 'earth', 'mars'] as const) {
      const c = BODY_CENTER[b];
      const r = BODY_RADIUS[b];
      if (Math.hypot(cam.x - c.x, cam.y - c.y) < r * 1.35 && cam.z - c.z < r * 4.6) body = b;
    }
    let view: View = body ? 'body' : 'system';
    const sel = this.selected ? this.regions.get(this.selected) : undefined;
    if (body && sel && sel.region.body === body) {
      const r = BODY_RADIUS[body];
      const p = this.bodies[body].pivot.localToWorld(tmp.copy(sel.local));
      const facing = tmp2.copy(p).sub(BODY_CENTER[body]).normalize().z;
      const turning = this.turnTo.has(body); // still gliding to face the camera: counts as open
      const near = cam.z - BODY_CENTER[body].z < r * 2.1 && (turning || Math.hypot(cam.x - p.x, cam.y - p.y) < r * 0.9);
      if (near && (facing > 0.55 || turning)) view = 'region';
    }
    if (view !== this.view || body !== this.focusBody) {
      this.view = view;
      this.focusBody = body;
      this.refreshStates();
      this.events.view(view, body);
    }
  }

  private arcAlpha(a: ArcNode): number {
    if (!this.regionsVisible) return 0;
    const touches = (id: string | null): boolean => !!id && (a.link.from === id || a.link.to === id);
    if (touches(this.selected)) return 1;
    if (touches(this.hovered)) return 0.75;
    return 0;
  }

  private updateArcs(): void {
    for (const a of this.arcs) {
      const mat = a.line.material;
      const alpha = num(mat, 'uAlpha');
      alpha.value += (this.arcAlpha(a) - alpha.value) * 0.12;
      num(mat, 'uTime').value = this.time;
      a.line.visible = alpha.value > 0.01;
      if (!a.line.visible) continue;
      const p0 = this.bodies[a.from.region.body].pivot.localToWorld(tmp.copy(a.from.local)).clone();
      const p3 = this.bodies[a.to.region.body].pivot.localToWorld(tmp.copy(a.to.local)).clone();
      const n0 = p0.clone().sub(BODY_CENTER[a.from.region.body]).normalize();
      const n3 = p3.clone().sub(BODY_CENTER[a.to.region.body]).normalize();
      const span = p0.distanceTo(p3);
      const lift = new Vector3(0, 0, span * 0.22); // bow toward the viewer, away from the planets
      const curve = new CubicBezierCurve3(
        p0,
        p0
          .clone()
          .addScaledVector(n0, span * 0.3)
          .add(lift),
        p3
          .clone()
          .addScaledVector(n3, span * 0.3)
          .add(lift),
        p3,
      );
      const attr = a.line.geometry.getAttribute('position') as BufferAttribute;
      for (let k = 0; k <= ARC_SEGMENTS; k++) {
        curve.getPoint(k / ARC_SEGMENTS, tmp);
        attr.setXYZ(k, tmp.x, tmp.y, tmp.z);
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
    camera: number[];
  } {
    return {
      view: this.view,
      body: this.focusBody,
      selected: this.selected,
      regions: this.regions.size,
      visible: this.regionsVisible,
      patch: this.patch.state,
      tiles: this.patch.tiles,
      camera: this.camera.position.toArray().map((v) => Math.round(v * 100) / 100),
    };
  }

  /** Where a planet's centre is on screen, in client pixels (tests). */
  screenOf(body: Body): { x: number; y: number } {
    const p = BODY_CENTER[body].clone().project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height };
  }

  /** Orientation of one planet (tests: turning one must not move the others). */
  orientation(body: Body): number[] {
    return this.bodies[body].pivot.quaternion.toArray().map((v) => Math.round(v * 1e4) / 1e4);
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }
}

const tmpQ = new Quaternion();
