// Close-up detail: whenever the camera rests near a surface, the real NASA tiles for exactly what is
// on screen (config/imagery.json) are stitched on a canvas and draped over that part of the sphere,
// at a zoom level that matches the screen. The previous patch stays until the new one is drawn, so
// moving never drops back to the blurry globe texture. Display imagery only.
//
// The patch shader works out latitude/longitude per pixel, so the same code covers the poles and
// the antimeridian (where a lat/lon mesh would fold).
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  LinearFilter,
  Mesh,
  NormalBlending,
  RepeatWrapping,
  SRGBColorSpace,
  ShaderMaterial,
  Vector3,
  type Object3D,
} from 'three';
import type { ImageryLayer } from '../data/config';
import { angularDistanceDeg, latLonToVec3 } from './geo';

const TILE = 256;
const MAX_TILES = 80;
const MAX_CANVAS = 4096; // px per side; safe on every WebGL2 device
const SEG = 72;
const D2R = Math.PI / 180;

const mercY = (lat: number): number => {
  const r = Math.max(-85.0511, Math.min(85.0511, lat)) * D2R;
  return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2; // 0 top .. 1 bottom
};

/** Tile grid covering a spherical cap, at the coarsest zoom that is still sharp on screen. */
interface Window {
  z: number;
  worldCols: number; // tile columns around the whole body at this zoom
  worldRows: number;
  col0: number; // may be negative or past worldCols across the antimeridian (wrapped when fetching)
  cols: number;
  row0: number;
  rows: number;
  colPx: number; // drawn width of one tile on the canvas (narrower near the poles)
  pxPerDeg: number;
}

function plan(layer: ImageryLayer, lat: number, lon: number, halfDeg: number, needPxPerDeg: number): Window {
  const geo = layer.scheme === 'geographic';
  const latMin = Math.max(-90, lat - halfDeg);
  const latMax = Math.min(90, lat + halfDeg);
  const polar = Math.abs(lat) + halfDeg >= 89.5;
  const s = Math.sin(halfDeg * D2R) / Math.max(1e-6, Math.cos(lat * D2R));
  const lonHalf = polar || s >= 1 ? 180 : Math.asin(s) / D2R;
  // Longitude degrees shrink toward the poles: draw tiles narrower there (no detail is lost).
  const nearest = latMin <= 0 && latMax >= 0 ? 0 : Math.min(Math.abs(latMin), Math.abs(latMax));
  const squeeze = Math.max(1 / 16, 2 ** Math.floor(Math.log2(Math.max(Math.cos(nearest * D2R), 1 / 16))));
  const pxPerDegAt = (z: number): number => (TILE * 2 ** z) / (geo ? 180 : 360 / Math.max(0.3, Math.cos(lat * D2R)));
  let z = 1;
  while (z < layer.max_level && pxPerDegAt(z) < needPxPerDeg * 0.8) z++;
  for (; ; z--) {
    const worldCols = geo ? 2 ** (z + 1) : 2 ** z;
    const worldRows = 2 ** z;
    const colOf = (lo: number): number => Math.floor(((lo + 180) / 360) * worldCols);
    const rowOf = (la: number): number =>
      Math.min(worldRows - 1, Math.max(0, Math.floor((geo ? (90 - la) / 180 : mercY(la)) * worldRows)));
    const full = lonHalf >= 180;
    const col0 = full ? 0 : colOf(lon - lonHalf);
    const cols = full ? worldCols : colOf(lon + lonHalf) - col0 + 1;
    const row0 = rowOf(latMax);
    const rows = rowOf(latMin) - row0 + 1;
    const colPx = Math.max(16, TILE * squeeze);
    const fits = cols * rows <= MAX_TILES && cols * colPx <= MAX_CANVAS && rows * TILE <= MAX_CANVAS;
    if (fits || z <= 1) return { z, worldCols, worldRows, col0, cols, row0, rows, colPx, pxPerDeg: pxPerDegAt(z) };
  }
}

function loadImage(url: string, signal: AbortSignal): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    const done = (ok: boolean): void => resolve(ok && !signal.aborted ? img : null);
    img.onload = () => done(true);
    img.onerror = () => done(false);
    signal.addEventListener('abort', () => (img.src = ''), { once: true });
    img.src = url;
  });
}

/** Per-pixel lat/lon lookup into the stitched canvas, lit like the globe underneath. */
function patchMaterial(
  map: CanvasTexture,
  w: Window,
  geo: boolean,
  center: Vector3,
  halfDeg: number,
  light: Vector3,
  earth: boolean,
): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uMap: { value: map },
      uGrid: { value: [w.worldCols, w.col0, w.cols, w.worldRows] },
      uRows: { value: [w.row0, w.rows] },
      uGeo: { value: geo ? 1 : 0 },
      uCenter: { value: center },
      uHalf: { value: halfDeg * D2R },
      uLight: { value: light },
      uEarth: { value: earth ? 1 : 0 },
      uFade: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vLocal;
      varying vec3 vNormalW;
      void main() {
        vLocal = position;
        vNormalW = normalize(mat3(modelMatrix) * normalize(position));
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform float uGrid[4];
      uniform float uRows[2];
      uniform float uGeo;
      uniform vec3 uCenter;
      uniform float uHalf;
      uniform vec3 uLight;
      uniform float uEarth;
      uniform float uFade;
      varying vec3 vLocal;
      varying vec3 vNormalW;
      const float PI = 3.141592653589793;
      void main() {
        vec3 p = normalize(vLocal);
        float lat = asin(clamp(p.y, -1.0, 1.0));
        float lon = atan(-p.z, p.x);
        // Unwrap longitude next to the patch centre so a patch across the antimeridian stays whole.
        float lonC = atan(-uCenter.z, uCenter.x);
        lon = lonC + mod(lon - lonC + PI, 2.0 * PI) - PI;
        float x = (lon + PI) / (2.0 * PI) * uGrid[0];
        float y = uGeo > 0.5
          ? (0.5 - lat / PI) * uGrid[3]
          : (1.0 - log(tan(PI / 4.0 + clamp(lat, -1.4844, 1.4844) / 2.0)) / PI) / 2.0 * uGrid[3];
        vec2 uv = vec2((x - uGrid[1]) / uGrid[2], 1.0 - (y - uRows[0]) / uRows[1]);
        vec4 t = texture2D(uMap, uv);
        float ang = acos(clamp(dot(p, normalize(uCenter)), -1.0, 1.0));
        float edge = 1.0 - smoothstep(0.72, 1.0, ang / uHalf);
        float a = t.a * edge * uFade;
        if (a < 0.002) discard;
        float ndl = dot(normalize(vNormalW), uLight);
        // Same light response as the globe below (Earth shader, or the standard material's Lambert).
        vec3 c = uEarth > 0.5
          ? t.rgb * (max(ndl * 0.7 + 0.3, 0.0) * 1.55 + 0.08) * 1.08
          : t.rgb * (max(ndl, 0.0) * 2.9 / PI + 0.03);
        gl_FragColor = vec4(c, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true,
    blending: NormalBlending,
    depthWrite: false,
  });
}

/** Spherical cap mesh around `center` (unit, body-local) with angular radius `halfDeg`. */
function capGeometry(center: Vector3, halfDeg: number, radius: number): BufferGeometry {
  let east = new Vector3(0, 1, 0).cross(center);
  if (east.lengthSq() < 1e-6) east = new Vector3(1, 0, 0);
  east.normalize();
  const north = center.clone().cross(east).normalize();
  const t = Math.tan(Math.min(halfDeg, 80) * D2R);
  const pos = new Float32Array((SEG + 1) * (SEG + 1) * 3);
  const v = new Vector3();
  let i = 0;
  for (let y = 0; y <= SEG; y++)
    for (let x = 0; x <= SEG; x++, i++) {
      v.copy(center)
        .addScaledVector(east, (x / SEG - 0.5) * 2 * t)
        .addScaledVector(north, (y / SEG - 0.5) * 2 * t)
        .setLength(radius * 1.0012);
      pos.set([v.x, v.y, v.z], i * 3);
    }
  const index: number[] = [];
  for (let y = 0; y < SEG; y++)
    for (let x = 0; x < SEG; x++) {
      const a = y * (SEG + 1) + x;
      index.push(a, a + 1, a + SEG + 1, a + 1, a + SEG + 2, a + SEG + 1);
    }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setIndex(index);
  return g;
}

export type PatchState = 'none' | 'loading' | 'ready' | 'failed';

class Patch {
  readonly mesh: Mesh<BufferGeometry, ShaderMaterial>;
  readonly ctrl = new AbortController();
  private readonly map: CanvasTexture;
  private dirty = false;
  private sinceUpload = 0;
  fade = 0;
  dying = false;
  tiles = 0;
  state: PatchState = 'loading';

  constructor(
    readonly owner: Object3D,
    readonly lat: number,
    readonly lon: number,
    readonly halfDeg: number,
    readonly w: Window,
    readonly need: number, // screen sharpness this patch was planned for (px per degree)
    layer: ImageryLayer,
    radius: number,
    light: Vector3,
    earth: boolean,
    order: number,
    onDone: (p: Patch) => void,
  ) {
    const canvas = document.createElement('canvas');
    canvas.width = w.cols * w.colPx;
    canvas.height = w.rows * TILE;
    const g = canvas.getContext('2d')!;
    this.map = new CanvasTexture(canvas);
    this.map.colorSpace = SRGBColorSpace;
    this.map.generateMipmaps = false; // seen at screen resolution: no mipmaps, cheap uploads
    this.map.minFilter = LinearFilter;
    this.map.wrapS = RepeatWrapping; // a full ring of tiles (polar caps) joins seamlessly
    const center = latLonToVec3(lat, lon, 1);
    this.mesh = new Mesh(
      capGeometry(center, halfDeg, radius),
      patchMaterial(this.map, w, layer.scheme === 'geographic', center, halfDeg, light, earth),
    );
    this.mesh.renderOrder = 1 + order / 1000;
    owner.add(this.mesh);

    // Progressive: each tile shows as soon as it arrives; undrawn areas are transparent, so the
    // previous patch (or the globe) shows through until then. Requested from the centre outward
    // (browsers fetch in request order), so the middle of the screen sharpens first.
    const geo = layer.scheme === 'geographic';
    const cx = ((lon + 180) / 360) * w.worldCols - w.col0;
    const cy = (geo ? (90 - lat) / 180 : mercY(lat)) * w.worldRows - w.row0;
    const order2: [number, number, number][] = [];
    for (let r = 0; r < w.rows; r++)
      for (let c = 0; c < w.cols; c++) {
        let dx = Math.abs(c + 0.5 - cx);
        if (w.cols === w.worldCols) dx = Math.min(dx, w.cols - dx); // full ring wraps around
        order2.push([r, c, ((dx * w.colPx) / TILE) ** 2 + (r + 0.5 - cy) ** 2]);
      }
    order2.sort((a, b) => a[2] - b[2]);
    const jobs: Promise<void>[] = [];
    for (const [r, c] of order2) {
      const col = (((w.col0 + c) % w.worldCols) + w.worldCols) % w.worldCols;
      const url = layer.url
        .replace('{z}', String(w.z))
        .replace('{y}', String(w.row0 + r))
        .replace('{x}', String(col));
      jobs.push(
        loadImage(url, this.ctrl.signal).then((img) => {
          if (!img) return;
          g.drawImage(img, c * w.colPx, r * TILE, w.colPx, TILE);
          this.dirty = true;
          this.tiles++;
        }),
      );
    }
    void Promise.all(jobs).then(() => {
      if (this.ctrl.signal.aborted) return;
      this.state = this.tiles > 0 ? 'ready' : 'failed'; // offline: the globe texture stays
      this.dirty = true;
      onDone(this);
    });
  }

  /** Returns false once a dying patch has faded out. */
  update(dt: number): boolean {
    this.sinceUpload += dt;
    if (this.dirty && this.sinceUpload > 0.25) {
      this.map.needsUpdate = true;
      this.dirty = false;
      this.sinceUpload = 0;
    }
    this.fade = this.dying ? Math.max(0, this.fade - dt / 0.5) : Math.min(1, this.fade + dt / 0.6);
    const u = this.mesh.material.uniforms.uFade;
    if (u) u.value = this.fade;
    return !(this.dying && this.fade <= 0);
  }

  /**
   * Whether this patch was planned for this view: same body, the view inside it, and a similar
   * sharpness request. Compared with the request, not the result, so a view the imagery cannot
   * match (its finest zoom reached) is not re-requested over and over.
   */
  covers(owner: Object3D, lat: number, lon: number, visibleHalf: number, needPxPerDeg: number): boolean {
    if (owner !== this.owner) return false;
    const d = angularDistanceDeg(lat, lon, this.lat, this.lon);
    return d + visibleHalf <= this.halfDeg * 0.85 && needPxPerDeg <= this.need * 1.6 && needPxPerDeg >= this.need / 4;
  }

  dispose(): void {
    this.ctrl.abort();
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.map.dispose();
    this.mesh.material.dispose();
  }
}

/** The detail layer: at most one shown patch and one loading on top of it. */
export class RegionDetail {
  private shown: Patch | null = null;
  private next: Patch | null = null;
  private fading: Patch[] = [];
  private failed: { patch: Patch; at: number } | null = null; // offline: wait before retrying
  private order = 0;

  get state(): PatchState {
    return (this.next ?? this.shown)?.state ?? (this.failed ? 'failed' : 'none');
  }

  get tiles(): number {
    return (this.next ?? this.shown)?.tiles ?? 0;
  }

  /**
   * Make sure the view centred on lat/lon, `visibleHalf` degrees across (half-width), is sharp at
   * `needPxPerDeg`. Does nothing when the shown or loading patch already covers it.
   */
  request(
    owner: Object3D,
    radius: number,
    layer: ImageryLayer,
    lat: number,
    lon: number,
    visibleHalf: number,
    needPxPerDeg: number,
    light: Vector3,
    earth: boolean,
  ): void {
    if (this.next?.covers(owner, lat, lon, visibleHalf, needPxPerDeg)) return;
    if (!this.next && this.shown?.covers(owner, lat, lon, visibleHalf, needPxPerDeg)) return;
    const f = this.failed;
    if (f && performance.now() - f.at < 8000 && f.patch.covers(owner, lat, lon, visibleHalf, needPxPerDeg)) return;
    if (this.next) this.retire(this.next);
    const halfDeg = Math.min(75, visibleHalf * 1.3 + 0.4);
    const w = plan(layer, lat, lon, halfDeg, needPxPerDeg);
    this.order = (this.order + 1) % 900;
    this.next = new Patch(owner, lat, lon, halfDeg, w, needPxPerDeg, layer, radius, light, earth, this.order, (p) => {
      if (p !== this.next) return;
      this.next = null;
      if (p.state === 'failed') {
        this.failed = { patch: p, at: performance.now() };
        this.retire(p);
        return;
      }
      this.failed = null;
      if (this.shown) this.retire(this.shown);
      this.shown = p;
      this.next = null;
    });
  }

  private retire(p: Patch): void {
    p.ctrl.abort();
    p.dying = true;
    this.fading.push(p);
  }

  /** Every frame: batched uploads and cross-fades. */
  update(dt: number): void {
    this.shown?.update(dt);
    this.next?.update(dt);
    this.fading = this.fading.filter((p) => {
      if (p.update(dt)) return true;
      p.dispose();
      return false;
    });
  }

  /** Fade everything out (left the surface). */
  clear(): void {
    for (const p of [this.shown, this.next]) if (p) this.retire(p);
    this.shown = this.next = null;
  }
}
