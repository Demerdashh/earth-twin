// Region close-up: when the camera dives into a region, the real NASA tiles for that area
// (config/imagery.json) are stitched on a canvas and draped on a patch of the sphere, with a soft
// radial edge. Display imagery only. Polar regions keep the globe texture (equirectangular tiles
// are degenerate there).
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Mesh,
  MeshStandardMaterial,
  SRGBColorSpace,
  type Object3D,
} from 'three';
import type { ImageryLayer } from '../data/config';
import { latLonToVec3, zoomForSpan } from './geo';

const TILE = 256;
const MAX_TILES = 36;
const SEG = 64;

const mercY = (lat: number): number => {
  const r = (Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180;
  return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2; // 0 top .. 1 bottom
};

interface TileWindow {
  z: number;
  col0: number;
  col1: number;
  row0: number;
  row1: number;
}

function tileWindow(layer: ImageryLayer, latMin: number, latMax: number, lonMin: number, lonMax: number): TileWindow {
  let z = zoomForSpan(lonMax - lonMin, layer.scheme, Math.min(layer.max_level, 7), 5);
  for (; ; z--) {
    let w: TileWindow;
    if (layer.scheme === 'geographic') {
      const deg = 180 / 2 ** z;
      w = {
        z,
        col0: Math.floor((lonMin + 180) / deg),
        col1: Math.floor((lonMax + 180 - 1e-9) / deg),
        row0: Math.floor((90 - latMax) / deg),
        row1: Math.floor((90 - latMin - 1e-9) / deg),
      };
    } else {
      const n = 2 ** z;
      w = {
        z,
        col0: Math.floor(((lonMin + 180) / 360) * n),
        col1: Math.floor(((lonMax + 180 - 1e-9) / 360) * n),
        row0: Math.floor(mercY(latMax) * n),
        row1: Math.floor(mercY(latMin) * n - 1e-9),
      };
    }
    if ((w.col1 - w.col0 + 1) * (w.row1 - w.row0 + 1) <= MAX_TILES || z <= 1) return w;
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

/** Soft circular mask (uv1 space) so the sharp patch melts into the globe texture. */
function edgeMask(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 20, 64, 64, 64);
  grad.addColorStop(0, '#fff');
  grad.addColorStop(0.75, '#fff');
  grad.addColorStop(1, '#000');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new CanvasTexture(c);
  t.channel = 1;
  return t;
}

export type PatchState = 'none' | 'skipped' | 'loading' | 'ready' | 'failed';

export class RegionPatch {
  private mesh: Mesh<BufferGeometry, MeshStandardMaterial> | null = null;
  private ctrl: AbortController | null = null;
  private fade = 0;
  state: PatchState = 'none';
  tiles = 0;

  /** Build and attach a patch; resolves once tiles are drawn (or skipped). */
  async show(
    parent: Object3D,
    radius: number,
    layer: ImageryLayer,
    lat: number,
    lon: number,
    halfDeg: number,
  ): Promise<void> {
    this.clear();
    if (Math.abs(lat) + Math.min(halfDeg, 6) > 82) {
      this.state = 'skipped'; // polar: equirectangular tiles degenerate, keep the globe texture
      return;
    }
    const ctrl = new AbortController();
    this.ctrl = ctrl;
    this.state = 'loading';
    this.tiles = 0;

    const lonHalf = Math.min(60, halfDeg / Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
    const latMin = lat - halfDeg;
    const latMax = lat + halfDeg;
    const lonMin = Math.max(-180, lon - lonHalf);
    const lonMax = Math.min(180, lon + lonHalf);
    const w = tileWindow(layer, latMin, latMax, lonMin, lonMax);
    const cols = w.col1 - w.col0 + 1;
    const rows = w.row1 - w.row0 + 1;

    const canvas = document.createElement('canvas');
    canvas.width = cols * TILE;
    canvas.height = rows * TILE;
    const g = canvas.getContext('2d')!;

    // Canvas-space extent of the stitched tiles, for uv mapping.
    const uOf = (lo: number): number => {
      const n = layer.scheme === 'geographic' ? 2 ** (w.z + 1) : 2 ** w.z;
      return (((lo + 180) / 360) * n - w.col0) / cols;
    };
    const vOf = (la: number): number => {
      const y = layer.scheme === 'geographic' ? ((90 - la) / 180) * 2 ** w.z : mercY(la) * 2 ** w.z;
      return 1 - (y - w.row0) / rows; // three's v runs bottom-up
    };

    const pos = new Float32Array((SEG + 1) * (SEG + 1) * 3);
    const uv = new Float32Array((SEG + 1) * (SEG + 1) * 2);
    const uv1 = new Float32Array((SEG + 1) * (SEG + 1) * 2);
    const v = latLonToVec3(0, 0);
    let i = 0;
    for (let y = 0; y <= SEG; y++)
      for (let x = 0; x <= SEG; x++, i++) {
        const la = latMin + ((latMax - latMin) * y) / SEG;
        const lo = lonMin + ((lonMax - lonMin) * x) / SEG;
        latLonToVec3(la, lo, radius * 1.0012, v);
        pos.set([v.x, v.y, v.z], i * 3);
        uv.set([uOf(lo), vOf(la)], i * 2);
        uv1.set([x / SEG, y / SEG], i * 2);
      }
    const index: number[] = [];
    for (let y = 0; y < SEG; y++)
      for (let x = 0; x < SEG; x++) {
        const a = y * (SEG + 1) + x;
        index.push(a, a + 1, a + SEG + 1, a + 1, a + SEG + 2, a + SEG + 1);
      }
    const geom = new BufferGeometry();
    geom.setAttribute('position', new BufferAttribute(pos, 3));
    geom.setAttribute('uv', new BufferAttribute(uv, 2));
    geom.setAttribute('uv1', new BufferAttribute(uv1, 2));
    geom.setIndex(index);
    geom.computeVertexNormals();

    const map = new CanvasTexture(canvas);
    map.colorSpace = SRGBColorSpace;
    map.anisotropy = 8;
    const mat = new MeshStandardMaterial({
      map,
      alphaMap: edgeMask(),
      transparent: true,
      opacity: 0,
      roughness: 0.95,
      metalness: 0,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    this.mesh = new Mesh(geom, mat);
    this.mesh.renderOrder = 1;
    parent.add(this.mesh);
    this.fade = 0;

    // Progressive: each tile appears as soon as it arrives (Trek can take seconds per tile);
    // undrawn areas stay transparent, so the globe texture shows through until then.
    const jobs: Promise<void>[] = [];
    for (let r = w.row0; r <= w.row1; r++)
      for (let c = w.col0; c <= w.col1; c++) {
        const url = layer.url.replace('{z}', String(w.z)).replace('{y}', String(r)).replace('{x}', String(c));
        jobs.push(
          loadImage(url, ctrl.signal).then((img) => {
            if (!img || ctrl.signal.aborted) return;
            g.drawImage(img, (c - w.col0) * TILE, (r - w.row0) * TILE, TILE, TILE);
            map.needsUpdate = true;
            this.tiles++;
          }),
        );
      }
    await Promise.all(jobs);
    if (ctrl.signal.aborted) return;
    // offline or server down: the globe texture stays, nothing breaks
    this.state = this.tiles > 0 ? 'ready' : 'failed';
  }

  /** Called every frame: fades a fresh patch in. */
  update(dt: number): void {
    if (!this.mesh || this.fade >= 1) return;
    this.fade = Math.min(1, this.fade + dt / 0.8);
    this.mesh.material.opacity = this.fade;
  }

  clear(): void {
    this.ctrl?.abort();
    this.ctrl = null;
    this.state = 'none';
    if (!this.mesh) return;
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.map?.dispose();
    this.mesh.material.alphaMap?.dispose();
    this.mesh.material.dispose();
    this.mesh = null;
  }
}
