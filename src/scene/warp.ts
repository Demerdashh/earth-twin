// Star streaks for interplanetary jumps: a field of short lines around the camera's forward axis
// that stretch and rush past while `strength` is up. Attached to the camera, so it costs nothing
// to place, and invisible (not drawn) when idle.
import { AdditiveBlending, BufferAttribute, BufferGeometry, LineSegments, ShaderMaterial } from 'three';

const COUNT = 700;
const DEPTH = 90;

export class Warp {
  readonly lines: LineSegments<BufferGeometry, ShaderMaterial>;
  private readonly heads = new Float32Array(COUNT * 3);
  private readonly pos = new Float32Array(COUNT * 2 * 3);

  constructor() {
    const t = new Float32Array(COUNT * 2);
    for (let i = 0; i < COUNT; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 1.2 + Math.random() ** 0.6 * 14; // keep the centre of the view clear
      this.heads.set([Math.cos(a) * r, Math.sin(a) * r, -Math.random() * DEPTH], i * 3);
      t[i * 2] = 0;
      t[i * 2 + 1] = 1;
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(this.pos, 3));
    g.setAttribute('aT', new BufferAttribute(t, 1));
    this.lines = new LineSegments(
      g,
      new ShaderMaterial({
        uniforms: { uStrength: { value: 0 } },
        vertexShader: /* glsl */ `
          attribute float aT;
          varying float vT;
          void main() {
            vT = aT;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform float uStrength;
          varying float vT;
          void main() {
            float a = uStrength * (1.0 - vT) * 0.85;
            gl_FragColor = vec4(vec3(0.86, 0.88, 1.0) * a, a);
          }`,
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        depthTest: false,
      }),
    );
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 10;
    this.lines.visible = false;
  }

  /** strength 0..1; streaks lengthen and speed up with it. */
  update(dt: number, strength: number): void {
    const mat = this.lines.material.uniforms.uStrength;
    if (mat) mat.value = strength;
    this.lines.visible = strength > 0.01;
    if (!this.lines.visible) return;
    const speed = 30 + strength * 220;
    const len = 0.3 + strength * 16;
    for (let i = 0; i < COUNT; i++) {
      let z = (this.heads[i * 3 + 2] ?? 0) + speed * dt;
      if (z > -0.5) z -= DEPTH; // recycle behind the far end
      this.heads[i * 3 + 2] = z;
      const x = this.heads[i * 3] ?? 0;
      const y = this.heads[i * 3 + 1] ?? 0;
      this.pos.set([x, y, z, x, y, z - len], i * 6);
    }
    (this.lines.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
  }
}
