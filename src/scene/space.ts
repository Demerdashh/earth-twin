// One three.js scene: Earth as the hero, with the Moon and Mars at their real relative sizes
// further out in the same sky. Each body spins slowly on its own axis.
//
// Interaction:
//   drag a planet       turn that planet only (smoothly, at a speed that follows your altitude)
//   drag empty space    pan; wheel / pinch zooms toward the cursor, slowing near the surface
//   click               a planet to go there, a dotted region to dive into it
// Trips between bodies: the camera turns toward the destination, jumps with star streaks,
// shows the whole planet, then dives to the place. The view level follows the camera.
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
import { angularDistanceDeg, latLonToVec3, vec3ToLatLon } from './geo';
import { arcMaterial, atmosphereMaterial, earthMaterial, num, regionMaterial, starMaterial } from './materials';
import { RegionPatch } from './patch';
import { Warp } from './warp';

export type View = 'system' | 'body' | 'region';
export interface BodyTextures {
  moon: Texture;
  mars: Texture;
  earth: Texture;
  earthNight: Texture;
  earthWater: Texture;
}

const BODIES = ['earth', 'moon', 'mars'] as const;
/** Real relative sizes (mean radii: Moon 0.273 and Mars 0.532 of Earth). Distances are not to scale. */
export const BODY_RADIUS: Record<Body, number> = { earth: 1, moon: 0.273, mars: 0.532 };
const BODY_CENTER: Record<Body, Vector3> = {
  earth: new Vector3(0, 0, 0),
  moon: new Vector3(3.6, 1.35, -7),
  mars: new Vector3(-7.6, -1.0, -16),
};
const BODY_TINT: Record<Body, string> = { earth: '#cfe3ff', moon: '#e6e8f2', mars: '#ffc4a8' };
const SPIN: Record<Body, number> = { earth: 0.05, moon: 0.03, mars: 0.04 }; // rad/s about each body's own axis
export const KIND_COLOR: Record<RegionKind, string> = {
  target: '#ffffff',
  known: '#9fe3d0',
  egypt: '#ecd29a',
  ranked: '#b9bcff',
};
/** Sunlight from the upper left, slightly in front of the home view. */
const LIGHT_DIR = new Vector3(-0.72, 0.42, 0.9).normalize();
/** Home: Earth fills most of the view, the Moon and Mars hang in the same sky. */
const HOME_POS = new Vector3(0.25, 0.1, 4.3);
const HOME_Q = new Quaternion();
const WORLD_LIMIT = 45;
const BODY_FRAME = 3.9; // camera distance from a body's centre when framing it, in radii
/** Camera height above the surface when diving into a region, in body radii. */
const REGION_ALTITUDE: Record<Body | 'ranked', number> = { earth: 0.28, mars: 0.34, moon: 0.36, ranked: 0.12 };
const ARC_SEGMENTS = 72;
const Y = new Vector3(0, 1, 0);
const tmp = new Vector3();
const tmp2 = new Vector3();
const tmpQ = new Quaternion();

interface BodyNode {
  pivot: Group;
  mesh: Mesh;
  radius: number;
  goal: Quaternion; // orientation the pivot glides toward
  facing: boolean; // gliding to present a region (slower, cinematic)
  heldUntil: number; // spin paused until (ms), after the user turns it
}
interface RegionNode {
  region: Region;
  points: Points<BufferGeometry, ShaderMaterial>;
  local: Vector3;
}
interface ArcNode {
  link: Link;
  line: Line<BufferGeometry, ShaderMaterial>;
  from: RegionNode;
  to: RegionNode;
}
/** One stage of a camera trip. Start pose is taken when the leg begins. */
interface Leg {
  to: Vector3;
  look: Quaternion;
  dur: number;
  warp?: boolean;
  onStart?: () => void;
  start?: { pos: Vector3; q: Quaternion; c1: Vector3; c2: Vector3 };
  t: number;
}
export interface SpaceEvents {
  click(hit: { body: Body; region: Region | null } | null): void;
  view(view: View, body: Body | null): void;
  interact(): void;
}

const ease = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const easeWarp = (t: number): number => (t < 0.5 ? 16 * t ** 5 : 1 - (-2 * t + 2) ** 5 / 2); // quintic: long cruise
const lookRotation = (eye: Vector3, target: Vector3): Quaternion =>
  new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(eye, target, Y));

export class Space {
  readonly renderer: WebGLRenderer;
  readonly camera = new PerspectiveCamera(36, 1, 0.005, 2000);
  private readonly scene = new Scene();
  private readonly bodies = {} as Record<Body, BodyNode>;
  private regions = new Map<string, RegionNode>();
  private arcs: ArcNode[] = [];
  private readonly stars: Points<BufferGeometry, ShaderMaterial>;
  private readonly warp = new Warp();
  private readonly patch = new RegionPatch();
  private readonly raycaster = new Raycaster();
  private readonly camGoal = HOME_POS.clone();
  private legs: Leg[] = [];
  private tripDone: (() => void) | null = null;
  private time = 0;
  private last = performance.now();
  private warpLevel = 0;

  view: View = 'system';
  focusBody: Body | null = 'earth';
  selected: string | null = null;
  hovered: string | null = null;
  regionsVisible = true;

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
    sun.position.copy(LIGHT_DIR).multiplyScalar(80);
    this.scene.add(sun, new AmbientLight('#8c8fd0', 0.1));
    this.stars = this.makeStars(pr);
    this.scene.add(this.stars, this.camera);
    this.camera.add(this.warp.lines);

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

    this.camera.position.copy(HOME_POS);
    this.camera.quaternion.copy(HOME_Q);
    this.resize();
    window.addEventListener('resize', this.resize);
    this.bindInput();
    this.renderer.setAnimationLoop(this.tick);
  }

  /* ------------------------------------------------------------ building */

  private makeStars(pr: number): Points<BufferGeometry, ShaderMaterial> {
    const n = 3400;
    const pos = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const phase = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1;
      const t = Math.random() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      pos.set([s * Math.cos(t) * 700, u * 700, s * Math.sin(t) * 700], i * 3);
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
    this.bodies[body] = { pivot, mesh, radius, goal: pivot.quaternion.clone(), facing: false, heldUntil: 0 };
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
    const inside = this.view === 'region';
    for (const [id, n] of this.regions) {
      n.points.visible = this.regionsVisible;
      num(n.points.material, 'uState').value = id === this.selected ? 2 : id === this.hovered ? 1 : 0;
      // Inside a region the imagery leads: the open region's dots soften, the others step back.
      num(n.points.material, 'uOpacity').value =
        id === this.selected ? (inside ? 0.45 : 1) : this.selected && id !== this.hovered ? 0.3 : 1;
    }
  }

  region(id: string): Region | undefined {
    return this.regions.get(id)?.region;
  }

  /* ------------------------------------------------------------ geometry helpers */

  private forward(out = new Vector3()): Vector3 {
    return out.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
  }

  /** Body nearest to the camera relative to its size, with the camera's altitude above it. */
  private nearest(p: Vector3 = this.camera.position): { body: Body; alt: number; rel: number } {
    let best: { body: Body; alt: number; rel: number } = { body: 'earth', alt: Infinity, rel: Infinity };
    for (const b of BODIES) {
      const d = p.distanceTo(BODY_CENTER[b]);
      const rel = d / BODY_RADIUS[b];
      if (rel < best.rel) best = { body: b, alt: d - BODY_RADIUS[b], rel };
    }
    return best;
  }

  /** Scene units per screen pixel at a given viewing distance. */
  private unitsPerPixel(distance: number): number {
    const h = this.renderer.domElement.clientHeight || 1;
    return (2 * Math.max(distance, 0.01) * Math.tan((this.camera.fov * Math.PI) / 360)) / h;
  }

  /* ------------------------------------------------------------ picking */

  private ndc(clientX: number, clientY: number): Vector2 {
    const rect = this.renderer.domElement.getBoundingClientRect();
    return new Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  }

  private hitBody(clientX: number, clientY: number): { body: Body; point: Vector3 } | null {
    this.raycaster.setFromCamera(this.ndc(clientX, clientY), this.camera);
    const hit = this.raycaster.intersectObjects(
      BODIES.map((b) => this.bodies[b].mesh),
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
      if (drag && !drag.moved && e.type === 'pointerup') this.events.click(this.pick(e.clientX, e.clientY));
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
        this.zoomAt(e.clientX, e.clientY, Math.exp(Math.max(-0.35, Math.min(0.35, dy * 0.0012))));
      },
      { passive: false },
    );
  }

  /**
   * Turn one planet by a screen drag. The rotation per pixel matches the ground under the cursor,
   * so close up it moves slowly and evenly instead of racing.
   */
  private turn(body: Body, dx: number, dy: number): void {
    this.cancelTrip();
    const node = this.bodies[body];
    const dist = this.camera.position.distanceTo(BODY_CENTER[body]) - node.radius;
    const k = Math.min(0.01, this.unitsPerPixel(Math.max(dist, node.radius * 0.02)) / node.radius);
    const up = new Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
    const right = new Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const q = new Quaternion().setFromAxisAngle(up, dx * k).multiply(new Quaternion().setFromAxisAngle(right, dy * k));
    node.goal.premultiply(q).normalize();
    node.facing = false;
    node.heldUntil = performance.now() + 2500;
  }

  pan(dx: number, dy: number): void {
    this.cancelTrip();
    const { alt } = this.nearest(this.camGoal);
    const k = this.unitsPerPixel(Math.min(alt, 12));
    const right = new Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const up = new Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
    this.camGoal.addScaledVector(right, -dx * k).addScaledVector(up, dy * k);
    this.clampGoal();
  }

  /** Zoom toward the point under the cursor; altitude shrinks proportionally, so it eases near the ground. */
  zoomAt(clientX: number, clientY: number, factor: number): void {
    this.cancelTrip();
    this.raycaster.setFromCamera(this.ndc(clientX, clientY), this.camera);
    const hit = this.hitBody(clientX, clientY);
    let anchor = hit?.point ?? null;
    if (!anchor) {
      const c = BODY_CENTER[this.nearest(this.camGoal).body];
      anchor = this.raycaster.ray.intersectPlane(
        new Plane().setFromNormalAndCoplanarPoint(this.forward(), c),
        new Vector3(),
      );
    }
    if (!anchor) return;
    this.camGoal.copy(anchor.clone().add(this.camGoal.clone().sub(anchor).multiplyScalar(factor)));
    this.clampGoal();
  }

  /** Never inside a planet, never lost far out in space. */
  private clampGoal(): void {
    const g = this.camGoal;
    if (g.length() > WORLD_LIMIT) g.setLength(WORLD_LIMIT);
    for (const b of BODIES) {
      const c = BODY_CENTER[b];
      const min = BODY_RADIUS[b] * 1.035;
      if (g.distanceTo(c) < min) g.copy(c).add(tmp.copy(g).sub(c).setLength(min));
    }
  }

  /* ------------------------------------------------------------ trips */

  private cancelTrip(): void {
    if (!this.legs.length) return;
    this.legs = [];
    this.camGoal.copy(this.camera.position);
    const done = this.tripDone;
    this.tripDone = null;
    done?.();
  }

  private trip(legs: Leg[]): Promise<void> {
    this.cancelTrip();
    this.legs = legs;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) for (const l of legs) l.dur = 0.001;
    return new Promise((resolve) => (this.tripDone = resolve));
  }

  /** Rotation that presents lat/lon toward the camera direction `back` (north kept up). */
  private faceToward(body: Body, lat: number, lon: number, back: Vector3, camQ: Quaternion): void {
    const n = latLonToVec3(lat, lon, 1);
    let east = new Vector3(0, 1, 0).cross(n);
    if (east.lengthSq() < 1e-6) east = new Vector3(1, 0, 0);
    east.normalize();
    const north = n.clone().cross(east).normalize();
    const local = new Matrix4().makeBasis(east, north, n);
    const right = new Vector3(1, 0, 0).applyQuaternion(camQ);
    const up = new Vector3(0, 1, 0).applyQuaternion(camQ);
    const world = new Matrix4().makeBasis(right, up, back);
    const node = this.bodies[body];
    node.goal.setFromRotationMatrix(world.multiply(local.invert()));
    node.facing = true;
  }

  /**
   * Legs to bring the camera in front of `body`. Close by: one smooth glide. Far away: turn toward it,
   * jump across space with star streaks, and arrive with the whole planet in view.
   */
  private approach(body: Body): { legs: Leg[]; fwd: Vector3; framed: Vector3; look: Quaternion } {
    const c = BODY_CENTER[body];
    const r = BODY_RADIUS[body];
    const from = this.camera.position.clone();
    const near = this.nearest(from);
    const local = near.body === body && near.rel < 7;
    const fwd = local ? this.forward() : c.clone().sub(from).normalize();
    const framed = c.clone().addScaledVector(fwd, -r * BODY_FRAME);
    const look = lookRotation(framed, c);
    if (local) return { legs: [{ to: framed, look, dur: 1.6, t: 0 }], fwd, framed, look };
    const legs: Leg[] = [];
    // Lift off first when we start close to another planet's surface.
    let start = from;
    const home = BODY_CENTER[near.body];
    const homeR = BODY_RADIUS[near.body];
    if (near.alt < homeR * 2.2) {
      start = home.clone().add(
        from
          .clone()
          .sub(home)
          .setLength(homeR * BODY_FRAME),
      );
      legs.push({ to: start, look: lookRotation(start, home), dur: 1.1, t: 0 });
    }
    const turnLook = lookRotation(start, c);
    const angle = (legs.length ? legs[legs.length - 1]!.look : this.camera.quaternion).angleTo(turnLook);
    const dist = start.distanceTo(framed);
    legs.push(
      { to: start.clone(), look: turnLook, dur: 0.35 + angle * 0.45, t: 0 },
      { to: framed, look, dur: 1.5 + Math.min(1.3, dist * 0.06), warp: dist > 4, t: 0 },
      { to: framed, look, dur: 0.45, t: 0 }, // a beat to see the whole planet
    );
    return { legs, fwd, framed, look };
  }

  async toSystem(): Promise<void> {
    this.setSelected(null);
    let from = this.camera.position.clone();
    const legs: Leg[] = [];
    const far = from.distanceTo(HOME_POS) > 6;
    const near = this.nearest(from);
    if (far && near.alt < BODY_RADIUS[near.body] * 2.2) {
      // Lift off the planet we are on before turning home.
      const c = BODY_CENTER[near.body];
      from = c.clone().add(
        from
          .clone()
          .sub(c)
          .setLength(BODY_RADIUS[near.body] * BODY_FRAME),
      );
      legs.push({ to: from, look: lookRotation(from, c), dur: 1.1, t: 0 });
    }
    if (far) legs.push({ to: from, look: lookRotation(from, BODY_CENTER.earth), dur: 0.7, t: 0 });
    legs.push({ to: HOME_POS.clone(), look: HOME_Q.clone(), dur: far ? 2.6 : 1.8, warp: far, t: 0 });
    await this.trip(legs);
  }

  async toBody(body: Body): Promise<void> {
    this.setSelected(null);
    await this.trip(this.approach(body).legs);
  }

  async toRegion(region: Region): Promise<void> {
    const body = region.body;
    const c = BODY_CENTER[body];
    const r = BODY_RADIUS[body];
    this.patch.clear();
    const { legs, fwd, look } = this.approach(body);
    const alt = REGION_ALTITUDE[region.kind === 'ranked' ? 'ranked' : body];
    const close = c.clone().addScaledVector(fwd, -r * (1 + alt));
    const dive: Leg = {
      to: close,
      look: lookRotation(close, c),
      dur: 1.9,
      t: 0,
      onStart: () => this.faceToward(body, region.lat, region.lon, fwd.clone().negate(), look),
    };
    // Already framed on this body: turn the planet while gliding down.
    if (legs.length === 1) legs[0] = { ...dive, onStart: dive.onStart!, dur: 2.0 };
    else legs.push(dive);
    await this.trip(legs);
    if (this.selected !== region.id) return;
    // Cover the whole close-up view (ground half-width is about altitude x 45 degrees) with margin.
    void this.patch.show(this.bodies[body].pivot, r, IMAGERY[body].color, region.lat, region.lon, alt * 62);
  }

  /* ------------------------------------------------------------ frame */

  private readonly resize = (): void => {
    const w = this.host.clientWidth || window.innerWidth;
    const h = this.host.clientHeight || window.innerHeight;
    this.camera.aspect = w / Math.max(h, 1);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  };

  private runLegs(dt: number): void {
    const leg = this.legs[0];
    if (!leg) return;
    if (!leg.start) {
      const pos = this.camera.position.clone();
      // Bow the path around any planet that sits on the straight line.
      const c1 = pos.clone().lerp(leg.to, 1 / 3);
      const c2 = pos.clone().lerp(leg.to, 2 / 3);
      for (const b of BODIES) {
        const c = BODY_CENTER[b];
        const r = BODY_RADIUS[b];
        const line = leg.to.clone().sub(pos);
        const len = line.length();
        if (len < 1e-6) continue;
        const t = Math.max(0, Math.min(1, c.clone().sub(pos).dot(line) / (len * len)));
        const closest = pos.clone().addScaledVector(line, t);
        const d = closest.distanceTo(c);
        if (d < r * 2 && t > 0.05 && t < 0.95) {
          const away = closest.clone().sub(c);
          if (away.lengthSq() < 1e-6) away.set(0, 1, 0);
          away.setLength(r * 2.6 - d);
          c1.add(away);
          c2.add(away);
        }
      }
      leg.start = { pos, q: this.camera.quaternion.clone(), c1, c2 };
      leg.onStart?.();
    }
    leg.t = Math.min(1, leg.t + dt / leg.dur);
    const k = leg.warp ? easeWarp(leg.t) : ease(leg.t);
    new CubicBezierCurve3(leg.start.pos, leg.start.c1, leg.start.c2, leg.to).getPoint(k, this.camera.position);
    // Turn early in the leg so the destination is in front while we move.
    this.camera.quaternion.slerpQuaternions(leg.start.q, leg.look, ease(Math.min(1, leg.t * (leg.warp ? 2.2 : 1))));
    this.warpLevel = leg.warp ? Math.sin(Math.PI * leg.t) ** 1.4 : 0;
    if (leg.t >= 1) {
      this.legs.shift();
      if (!this.legs.length) {
        this.camGoal.copy(this.camera.position);
        const done = this.tripDone;
        this.tripDone = null;
        done?.();
      }
    }
  }

  private readonly tick = (): void => {
    if (document.hidden) return;
    const now = performance.now();
    const elapsed = (now - this.last) / 1000;
    const dt = Math.min(0.05, elapsed); // smoothing steps
    this.last = now;
    this.time += dt;

    // Trips follow real time, so a 3-second jump stays 3 seconds even on a slow device.
    if (this.legs.length) this.runLegs(Math.min(0.25, elapsed));
    else {
      this.warpLevel = 0;
      this.camera.position.lerp(this.camGoal, 1 - Math.exp(-dt * 7));
    }
    // Speed feel: the field of view opens during a jump, streaks rush past.
    const fov = 36 + 30 * this.warpLevel;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    this.warp.update(dt, this.warpLevel);
    document.body.style.setProperty('--warp', this.warpLevel.toFixed(3));

    // Planets: each spins slowly on its own axis unless you hold it, look at it closely or a region is open.
    const camNear = this.nearest();
    for (const b of BODIES) {
      const node = this.bodies[b];
      const paused =
        now < node.heldUntil ||
        node.facing ||
        (this.view === 'region' && this.focusBody === b) ||
        (camNear.body === b && camNear.alt < node.radius * 1.4);
      if (!paused) {
        tmpQ.setFromAxisAngle(Y, SPIN[b] * dt);
        node.goal.multiply(tmpQ);
        node.pivot.quaternion.multiply(tmpQ);
      }
      node.pivot.quaternion.slerp(node.goal, 1 - Math.exp(-dt * (node.facing ? 3.2 : 11)));
      if (node.facing && node.pivot.quaternion.angleTo(node.goal) < 2e-3) node.facing = false;
    }

    this.updateView();
    num(this.stars.material, 'uTime').value = this.time;
    for (const n of this.regions.values()) num(n.points.material, 'uTime').value = this.time;
    this.scene.updateMatrixWorld();
    this.updateArcs();
    this.patch.update(dt);
    this.renderer.render(this.scene, this.camera);
  };

  /** Work out the view level from the camera; tell the app when it changes. */
  private updateView(): void {
    if (this.legs.length) return; // judge only where a trip lands
    const cam = this.camera.position;
    const near = this.nearest();
    const fwd = this.forward(tmp2);
    let body: Body | null = near.rel < 6.5 ? near.body : null;
    let view: View = body ? 'body' : 'system';
    if (body === 'earth' && cam.distanceTo(HOME_POS) < 1.6 && fwd.z < -0.95) view = 'system';
    const sel = this.selected ? this.regions.get(this.selected) : undefined;
    if (body && sel && sel.region.body === body) {
      const node = this.bodies[body];
      const p = node.pivot.localToWorld(tmp.copy(sel.local));
      const toCam = cam.clone().sub(BODY_CENTER[body]).normalize();
      const facing = p.clone().sub(BODY_CENTER[body]).normalize().dot(toCam);
      const inView = p.clone().sub(cam).normalize().dot(fwd) > 0.86;
      if (near.alt < node.radius * 1.15 && (node.facing || (facing > 0.6 && inView))) view = 'region';
    }
    if (view === 'system' && near.rel >= 6.5) body = null;
    if (view !== this.view || body !== this.focusBody) {
      this.view = view;
      this.focusBody = body;
      this.refreshStates();
      this.events.view(view, body);
    }
  }

  private arcAlpha(a: ArcNode): number {
    if (!this.regionsVisible || this.warpLevel > 0.05) return 0;
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
      const curve = new CubicBezierCurve3(
        p0,
        p0.clone().addScaledVector(n0, span * 0.32),
        p3.clone().addScaledVector(n3, span * 0.32),
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

  /* ------------------------------------------------------------ test hooks */

  debug(): {
    view: View;
    body: Body | null;
    selected: string | null;
    regions: number;
    visible: boolean;
    patch: string;
    tiles: number;
    camera: number[];
    travelling: boolean;
    warp: number;
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
      travelling: this.legs.length > 0,
      warp: Math.round(this.warpLevel * 100) / 100,
    };
  }

  /** Where a planet's centre is on screen, in client pixels. */
  screenOf(body: Body): { x: number; y: number } {
    const p = BODY_CENTER[body].clone().project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height };
  }

  /** Orientation of one planet as a quaternion. */
  orientation(body: Body): number[] {
    return this.bodies[body].pivot.quaternion.toArray();
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }
}
