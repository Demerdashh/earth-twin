// One three.js scene: Earth at home, the Moon and Mars far away in their own parts of space,
// all at their real relative sizes. Each body spins slowly on its own axis.
//
// Interaction:
//   drag a planet       turn that planet only (smoothly, at a speed that follows your altitude)
//   drag empty space    pan; wheel / pinch zooms toward the cursor, slowing near the surface
//   click               a dotted region to dive into it (or a planet to frame it)
// Trips between bodies: lift off, turn toward the destination, a long jump through star streaks,
// the destination appears as a speck and grows, a beat on the whole planet, then the dive.
// The view level follows the camera.
import {
  ACESFilmicToneMapping,
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  CubicBezierCurve3,
  DirectionalLight,
  Group,
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
import type { Region, RegionKind } from '../data/regions';
import { angularDistanceDeg, latLonToVec3, vec3ToLatLon } from './geo';
import { atmosphereMaterial, earthMaterial, num, regionMaterial, starMaterial } from './materials';
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
/** Real relative sizes (mean radii: Moon 0.273 and Mars 0.532 of Earth). */
export const BODY_RADIUS: Record<Body, number> = { earth: 1, moon: 0.273, mars: 0.532 };
/**
 * Far apart and out of each other's view, so only the body you are at is on screen. Distances are
 * compressed (not to scale) but large enough that a destination first appears as a speck.
 */
const BODY_CENTER: Record<Body, Vector3> = {
  earth: new Vector3(0, 0, 0),
  moon: new Vector3(260, 34, 120),
  mars: new Vector3(-690, -70, 410),
};
/** A body is drawn only within this distance (it would be sub-pixel beyond it anyway). */
const VISIBLE_RANGE = 170;
const SPIN: Record<Body, number> = { earth: 0.05, moon: 0.03, mars: 0.04 }; // rad/s about each body's own axis
export const KIND_COLOR: Record<RegionKind, string> = {
  target: '#ffffff',
  known: '#9fe3d0',
  egypt: '#ecd29a',
  ranked: '#b9bcff',
};
/** Key light in camera space (upper left, a little in front): every arrival is on the day side. */
const LIGHT_CAM = new Vector3(-0.45, 0.32, 0.83).normalize();
/** Home: Earth exactly centred, whole, with room around it. */
const BODY_FRAME = 4.9; // camera distance from a body's centre when framing it whole, in radii
const HOME_POS = new Vector3(0, 0, BODY_FRAME);
/** Side of Earth shown when arriving home from elsewhere: Africa and Egypt. */
const EARTH_HOME_FACE = { lat: 18, lon: 22 };
const MAX_FRAME = 12; // farthest zoom-out from the current body, in radii
/** Camera height above the surface when diving into a region, in body radii. */
const REGION_ALTITUDE: Record<Body | 'ranked', number> = { earth: 0.28, mars: 0.34, moon: 0.36, ranked: 0.12 };
const Y = new Vector3(0, 1, 0);
const tmp = new Vector3();
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
/** One stage of a camera trip. The start pose is taken when the leg begins. */
interface Leg {
  to: Vector3;
  look: Quaternion;
  dur: number;
  kind?: 'warp' | 'lift';
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
/**
 * Jump profile (distance over time, both 0..1): accelerate, cruise, then a long even braking while
 * the destination grows from a speck. Speed is continuous throughout.
 */
const JUMP_ACCEL = 0.2;
const JUMP_BRAKE = 0.45;
const JUMP_SPEED = 1 / (1 - JUMP_ACCEL / 2 - JUMP_BRAKE / 2);
const easeJump = (t: number): number => {
  const [a, d, v] = [JUMP_ACCEL, JUMP_BRAKE, JUMP_SPEED];
  if (t < a) return (v * t * t) / (2 * a);
  if (t < 1 - d) return v * (a / 2 + t - a);
  const s = t - (1 - d);
  return v * (a / 2 + 1 - d - a + s - (s * s) / (2 * d));
};
const lookRotation = (eye: Vector3, target: Vector3): Quaternion =>
  new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(eye, target, Y));

export class Space {
  readonly renderer: WebGLRenderer;
  readonly camera = new PerspectiveCamera(36, 1, 0.005, 30000);
  private readonly scene = new Scene();
  private readonly bodies = {} as Record<Body, BodyNode>;
  private regions = new Map<string, RegionNode>();
  private readonly stars: Points<BufferGeometry, ShaderMaterial>;
  private readonly warp = new Warp();
  private readonly patch = new RegionPatch();
  private readonly raycaster = new Raycaster();
  private readonly camGoal = HOME_POS.clone();
  private readonly lightDir = new Vector3();
  private readonly sun = new DirectionalLight('#fff4e6', 2.9);
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
    this.renderer.toneMappingExposure = 1.12;
    host.append(this.renderer.domElement);

    this.scene.add(this.sun, this.sun.target, new AmbientLight('#8c8fd0', 0.1));
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
    this.makeBody('earth', earthMaterial(textures.earth, textures.earthNight, textures.earthWater, this.lightDir));
    this.makeBody('moon', new MeshStandardMaterial({ map: textures.moon, roughness: 1, metalness: 0 }));
    this.makeBody('mars', new MeshStandardMaterial({ map: textures.mars, roughness: 0.95, metalness: 0 }));
    this.addAtmosphere('earth', '#6fa8ff', 0.95, 4.4, 1.022);
    this.addAtmosphere('mars', '#e8a07a', 0.45, 4.2, 1.02);

    this.camera.position.copy(HOME_POS);
    this.camera.lookAt(BODY_CENTER.earth);
    this.resize();
    window.addEventListener('resize', this.resize);
    this.bindInput();
    this.renderer.setAnimationLoop(this.tick);
  }

  /* ------------------------------------------------------------ building */

  private makeStars(pr: number): Points<BufferGeometry, ShaderMaterial> {
    const n = 4200;
    const pos = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const phase = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1;
      const t = Math.random() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      pos.set([s * Math.cos(t) * 9000, u * 9000, s * Math.sin(t) * 9000], i * 3);
      size[i] = 0.5 + Math.random() ** 4 * 2.2;
      phase[i] = Math.random() * 6.28;
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setAttribute('aSize', new BufferAttribute(size, 1));
    g.setAttribute('aPhase', new BufferAttribute(phase, 1));
    const points = new Points(g, starMaterial(pr));
    points.frustumCulled = false;
    return points;
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
      new Mesh(
        new SphereGeometry(node.radius * scale, 96, 64),
        atmosphereMaterial(color, strength, power, this.lightDir),
      ),
    );
  }

  /** Replace all regions. */
  setRegions(regions: Region[]): void {
    for (const n of this.regions.values()) {
      n.points.removeFromParent();
      n.points.geometry.dispose();
      n.points.material.dispose();
    }
    this.regions.clear();
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

  get travelling(): boolean {
    return this.legs.length > 0;
  }

  /* ------------------------------------------------------------ geometry helpers */

  private forward(out = new Vector3()): Vector3 {
    return out.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
  }

  /** Body nearest to a point relative to its size, with the altitude above it. */
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

  /** Screen position of a world point, or null when behind the camera. */
  private toScreen(p: Vector3): { x: number; y: number } | null {
    const v = p.clone().project(this.camera);
    if (v.z > 1) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
  }

  /** Where a region's centre is on screen, and whether it faces the camera. */
  regionScreen(id: string): { x: number; y: number; facing: boolean } | null {
    const n = this.regions.get(id);
    if (!n || !this.bodies[n.region.body].pivot.visible) return null;
    const c = BODY_CENTER[n.region.body];
    const p = this.bodies[n.region.body].pivot.localToWorld(tmp.copy(n.local)).clone();
    const s = this.toScreen(p);
    if (!s) return null;
    const facing = p.clone().sub(c).normalize().dot(this.camera.position.clone().sub(p).normalize()) > 0.2;
    return { ...s, facing };
  }

  /* ------------------------------------------------------------ picking */

  private ndc(clientX: number, clientY: number): Vector2 {
    const rect = this.renderer.domElement.getBoundingClientRect();
    return new Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  }

  private hitBody(clientX: number, clientY: number): { body: Body; point: Vector3 } | null {
    this.raycaster.setFromCamera(this.ndc(clientX, clientY), this.camera);
    const hit = this.raycaster.intersectObjects(
      BODIES.filter((b) => this.bodies[b].pivot.visible).map((b) => this.bodies[b].mesh),
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
        if (this.travelling) return;
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
    if (this.travelling) return;
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
    if (this.travelling) return;
    const { alt } = this.nearest(this.camGoal);
    const k = this.unitsPerPixel(alt);
    const right = new Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const up = new Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
    this.camGoal.addScaledVector(right, -dx * k).addScaledVector(up, dy * k);
    this.clampGoal();
  }

  /** Zoom toward the point under the cursor; altitude shrinks proportionally, so it eases near the ground. */
  zoomAt(clientX: number, clientY: number, factor: number): void {
    if (this.travelling) return;
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

  /** Never inside the planet, never drifting off into empty space. */
  private clampGoal(): void {
    const g = this.camGoal;
    const { body } = this.nearest(g);
    const c = BODY_CENTER[body];
    const r = BODY_RADIUS[body];
    const d = g.distanceTo(c);
    if (d < r * 1.035)
      g.copy(c).add(
        tmp
          .copy(g)
          .sub(c)
          .setLength(r * 1.035),
      );
    if (d > r * MAX_FRAME)
      g.copy(c).add(
        tmp
          .copy(g)
          .sub(c)
          .setLength(r * MAX_FRAME),
      );
  }

  /* ------------------------------------------------------------ trips */

  private finishTrip(): void {
    this.legs = [];
    this.camGoal.copy(this.camera.position);
    const done = this.tripDone;
    this.tripDone = null;
    done?.();
  }

  private trip(legs: Leg[]): Promise<void> {
    if (this.legs.length) this.finishTrip();
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
   * Legs that bring the camera to frame `body` whole and centred. Close by: one smooth glide.
   * Elsewhere: lift off, turn toward it, jump, and arrive with the whole planet in view.
   */
  private approach(body: Body): { legs: Leg[]; fwd: Vector3; look: Quaternion } {
    const distance = BODY_FRAME;
    const c = BODY_CENTER[body];
    const r = BODY_RADIUS[body];
    const from = this.camera.position.clone();
    const near = this.nearest(from);
    if (near.body === body) {
      const fwd = c.clone().sub(from).normalize();
      const framed = c.clone().addScaledVector(fwd, -r * distance);
      const look = lookRotation(framed, c);
      return { legs: [{ to: framed, look, dur: 1.8, t: 0 }], fwd, look };
    }
    const legs: Leg[] = [];
    // 1. Lift off: rise away from the planet we are on until it sits whole behind us.
    const home = BODY_CENTER[near.body];
    const homeR = BODY_RADIUS[near.body];
    let start = from;
    if (near.alt < homeR * 3) {
      start = home.clone().add(
        from
          .clone()
          .sub(home)
          .setLength(homeR * 4.2),
      );
      legs.push({ to: start, look: lookRotation(start, home), dur: 1.6, kind: 'lift', t: 0 });
    }
    // 2. Turn toward the destination (still out of sight, far beyond the stars' reach).
    const turnLook = lookRotation(start, c);
    legs.push({ to: start.clone(), look: turnLook, dur: 1.5, t: 0 });
    // 3. The jump: long cruise through the streaks, the planet appears as a speck and grows.
    const fwd = c.clone().sub(start).normalize();
    const framed = c.clone().addScaledVector(fwd, -r * distance);
    const look = lookRotation(framed, c);
    const dist = start.distanceTo(framed);
    const jump: Leg = { to: framed, look, dur: 4.2 + Math.min(1.8, dist / 450), kind: 'warp', t: 0 };
    // Coming home: Earth (out of sight for now) turns Africa and Egypt toward the arrival.
    if (body === 'earth')
      jump.onStart = () => {
        const node = this.bodies.earth;
        this.faceToward('earth', EARTH_HOME_FACE.lat, EARTH_HOME_FACE.lon, fwd.clone().negate(), look);
        node.pivot.quaternion.copy(node.goal);
        node.facing = false;
      };
    legs.push(jump);
    // 4. A beat with the whole planet in view.
    legs.push({ to: framed, look, dur: 0.9, t: 0 });
    return { legs, fwd, look };
  }

  async toSystem(): Promise<void> {
    await this.toBody('earth');
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
      dur: 2.4,
      t: 0,
      onStart: () => this.faceToward(body, region.lat, region.lon, fwd.clone().negate(), look),
    };
    // Already at this planet: turn it while gliding down.
    if (legs.length === 1) legs[0] = { ...dive, dur: 2.2 };
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
      const c1 = pos.clone().lerp(leg.to, 1 / 3);
      const c2 = pos.clone().lerp(leg.to, 2 / 3);
      // Bow the path around any planet that sits on the straight line.
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
    const k = leg.kind === 'warp' ? easeJump(leg.t) : ease(leg.t);
    new CubicBezierCurve3(leg.start.pos, leg.start.c1, leg.start.c2, leg.to).getPoint(k, this.camera.position);
    this.camera.quaternion.slerpQuaternions(
      leg.start.q,
      leg.look,
      ease(leg.kind === 'warp' ? Math.min(1, leg.t * 3) : leg.t),
    );
    // Streaks: build up quickly, hold through the cruise, fade as we brake and the planet grows.
    const fade = Math.min(1, Math.max(0, (leg.t - 0.5) / 0.36));
    this.warpLevel = leg.kind === 'warp' ? Math.min(1, leg.t / 0.16) * (1 - fade) ** 1.5 : 0;
    if (leg.t >= 1) {
      this.legs.shift();
      if (!this.legs.length) this.finishTrip();
    }
  }

  private readonly tick = (): void => {
    if (document.hidden) return;
    const now = performance.now();
    const elapsed = (now - this.last) / 1000;
    const dt = Math.min(0.05, elapsed); // smoothing steps
    this.last = now;
    this.time += dt;

    // Trips follow real time, so a jump lasts the same on any device.
    if (this.legs.length) this.runLegs(Math.min(0.25, elapsed));
    else {
      this.warpLevel = 0;
      this.camera.position.lerp(this.camGoal, 1 - Math.exp(-dt * 7));
    }
    // Speed feel: the field of view opens during a jump, streaks rush past, edges darken.
    const fov = 36 + 28 * this.warpLevel;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    this.warp.update(dt, this.warpLevel);
    document.body.style.setProperty('--warp', this.warpLevel.toFixed(3));

    // Sunlight rides with the camera (from its upper left): you always arrive on the day side.
    this.lightDir.copy(LIGHT_CAM).applyQuaternion(this.camera.quaternion);
    this.sun.position.copy(this.camera.position).addScaledVector(this.lightDir, 100);
    this.sun.target.position.copy(this.camera.position);

    // Planets: only the ones in range are drawn; each spins slowly on its own axis unless you
    // hold it, look at it closely, or a region is open on it.
    const camNear = this.nearest();
    for (const b of BODIES) {
      const node = this.bodies[b];
      node.pivot.visible = this.camera.position.distanceTo(BODY_CENTER[b]) < VISIBLE_RANGE;
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
    this.patch.update(dt);
    this.renderer.render(this.scene, this.camera);
  };

  /** Work out the view level from the camera; tell the app when it changes. */
  private updateView(): void {
    if (this.legs.length) return; // judge only where a trip lands
    const cam = this.camera.position;
    const near = this.nearest();
    const fwd = this.forward();
    const body = near.body;
    const c = BODY_CENTER[body];
    const toBody = c.clone().sub(cam).normalize();
    let view: View = 'body';
    // Home: Earth whole and centred.
    if (body === 'earth' && near.rel > 3.8 && near.rel < 7 && fwd.dot(toBody) > 0.995) view = 'system';
    const sel = this.selected ? this.regions.get(this.selected) : undefined;
    if (sel && sel.region.body === body) {
      const node = this.bodies[body];
      const p = node.pivot.localToWorld(tmp.copy(sel.local)).clone();
      const facing = p.clone().sub(c).normalize().dot(cam.clone().sub(c).normalize());
      const inView = p.clone().sub(cam).normalize().dot(fwd) > 0.86;
      if (near.alt < node.radius * 1.15 && (node.facing || (facing > 0.6 && inView))) view = 'region';
    }
    if (view !== this.view || body !== this.focusBody) {
      this.view = view;
      this.focusBody = body;
      this.refreshStates();
      this.events.view(view, body);
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
    shown: Body[];
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
      travelling: this.travelling,
      warp: Math.round(this.warpLevel * 100) / 100,
      shown: BODIES.filter((b) => this.bodies[b].pivot.visible),
    };
  }

  /** Where a planet's centre is on screen, in client pixels. */
  screenOf(body: Body): { x: number; y: number } | null {
    return this.toScreen(BODY_CENTER[body]);
  }

  /** Regions currently facing the camera on a visible planet (tests). */
  facingRegions(): { id: string; name: string; x: number; y: number }[] {
    const out: { id: string; name: string; x: number; y: number }[] = [];
    for (const [id, n] of this.regions) {
      const s = this.regionScreen(id);
      if (s?.facing) out.push({ id, name: n.region.name, x: s.x, y: s.y });
    }
    return out;
  }

  /** Orientation of one planet as a quaternion. */
  orientation(body: Body): number[] {
    return this.bodies[body].pivot.quaternion.toArray();
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }
}
