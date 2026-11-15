import { AdditiveBlending, Color, ShaderMaterial, type ColorRepresentation } from 'three';

/** Typed access to a numeric uniform created by the factories below. */
export function num(mat: ShaderMaterial, name: string): { value: number } {
  const u = mat.uniforms[name];
  if (!u) throw new Error(`uniform ${name} missing`);
  return u as { value: number };
}

/** Fresnel rim glow for an atmosphere shell (Earth, faintly Mars). */
export function atmosphereMaterial(color: ColorRepresentation, strength: number, power: number): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uColor: { value: new Color(color) }, uStrength: { value: strength }, uPower: { value: power } },
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uStrength;
      uniform float uPower;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        float rim = pow(1.0 - max(dot(vNormal, vView), 0.0), uPower);
        gl_FragColor = vec4(uColor * rim * uStrength, rim * uStrength);
      }`,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
  });
}

/** Star field: fixed pixel size with a slow, per-star twinkle. */
export function starMaterial(pixelRatio: number): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPixelRatio: { value: pixelRatio } },
    vertexShader: /* glsl */ `
      attribute float aSize;
      attribute float aPhase;
      uniform float uTime;
      uniform float uPixelRatio;
      varying float vAlpha;
      void main() {
        vAlpha = 0.55 + 0.45 * sin(uTime * 0.8 + aPhase);
        gl_PointSize = aSize * uPixelRatio;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d) * vAlpha;
        gl_FragColor = vec4(vec3(0.85, 0.9, 1.0) * a, a);
      }`,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
  });
}

/**
 * Dotted region: a disc of points on the surface with a ripple running outward.
 * uState: 0 idle, 1 hover, 2 selected.
 */
export function regionMaterial(color: ColorRepresentation, pixelRatio: number, phase: number): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uColor: { value: new Color(color) },
      uTime: { value: 0 },
      uState: { value: 0 },
      uOpacity: { value: 1 },
      uSize: { value: 3.2 },
      uPixelRatio: { value: pixelRatio },
      uPhase: { value: phase },
    },
    vertexShader: /* glsl */ `
      attribute float aD;
      uniform float uSize;
      uniform float uPixelRatio;
      uniform float uState;
      varying float vD;
      varying float vFacing;
      void main() {
        vD = aD;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vec3 n = normalize(normalMatrix * normalize(position));
        vFacing = dot(n, normalize(-mv.xyz));
        float s = uSize * (1.0 + 0.35 * step(0.5, uState));
        gl_PointSize = clamp(s * uPixelRatio * (4.0 / -mv.z), 1.5 * uPixelRatio, 7.0 * uPixelRatio);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uTime;
      uniform float uState;
      uniform float uOpacity;
      uniform float uPhase;
      varying float vD;
      varying float vFacing;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        if (d > 0.5) discard;
        float disc = smoothstep(0.5, 0.2, d);
        float ripple = 0.5 + 0.5 * sin(uTime * 2.4 + uPhase - vD * 7.0);
        float edge = 1.0 - 0.55 * vD;
        float boost = uState > 1.5 ? 1.6 : (uState > 0.5 ? 1.3 : 1.0);
        float a = disc * (0.35 + 0.65 * ripple) * edge * boost * uOpacity * smoothstep(0.0, 0.25, vFacing);
        gl_FragColor = vec4(uColor * a, a);
      }`,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
  });
}

/** Link arc: colour runs from the source body to Earth, with light pulses flowing along it. */
export function arcMaterial(from: ColorRepresentation, to: ColorRepresentation, phase: number): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uFrom: { value: new Color(from) },
      uTo: { value: new Color(to) },
      uTime: { value: 0 },
      uAlpha: { value: 0 },
      uPhase: { value: phase },
    },
    vertexShader: /* glsl */ `
      attribute float aU;
      varying float vU;
      void main() {
        vU = aU;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uFrom;
      uniform vec3 uTo;
      uniform float uTime;
      uniform float uAlpha;
      uniform float uPhase;
      varying float vU;
      void main() {
        float flow = pow(fract(vU - uTime * 0.22 + uPhase), 14.0) * 1.8;
        float ends = smoothstep(0.0, 0.06, vU) * smoothstep(1.0, 0.94, vU);
        float a = uAlpha * ends * (0.38 + flow);
        gl_FragColor = vec4(mix(uFrom, uTo, vU) * a, a);
      }`,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
  });
}
