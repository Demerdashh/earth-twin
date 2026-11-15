import { AdditiveBlending, Color, ShaderMaterial, type ColorRepresentation, type Texture, type Vector3 } from 'three';

/** Typed access to a numeric uniform created by the factories below. */
export function num(mat: ShaderMaterial, name: string): { value: number } {
  const u = mat.uniforms[name];
  if (!u) throw new Error(`uniform ${name} missing`);
  return u as { value: number };
}

/**
 * Realistic Earth: Blue Marble NG by day, VIIRS Black Marble city lights on the night side,
 * sun glint on the oceans only (land mask), and a thin blue haze toward the limb.
 */
export function earthMaterial(day: Texture, night: Texture, water: Texture, lightDir: Vector3): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uDay: { value: day },
      uNight: { value: night },
      uWater: { value: water },
      uLight: { value: lightDir },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vNormalW;
      varying vec3 vPosW;
      void main() {
        vUv = uv;
        vNormalW = normalize(mat3(modelMatrix) * normal);
        vec4 w = modelMatrix * vec4(position, 1.0);
        vPosW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uDay;
      uniform sampler2D uNight;
      uniform sampler2D uWater;
      uniform vec3 uLight;
      varying vec2 vUv;
      varying vec3 vNormalW;
      varying vec3 vPosW;
      void main() {
        vec3 n = normalize(vNormalW);
        vec3 v = normalize(cameraPosition - vPosW);
        float ndl = dot(n, uLight);
        float dayMix = smoothstep(-0.35, 0.05, ndl);
        vec3 day = texture2D(uDay, vUv).rgb;
        // Wrapped daylight: the face toward you is bright and clear, falling off softly to the limb.
        float wrap = max(ndl * 0.7 + 0.3, 0.0);
        vec3 lit = day * (wrap * 1.55 + 0.08) * 1.08;
        // City lights only: the Black Marble's bluish moonlit land is dropped, warm lights kept.
        vec3 nl = texture2D(uNight, vUv).rgb;
        float lights = smoothstep(0.1, 0.55, min(nl.r, nl.g) - nl.b * 0.25);
        vec3 night = vec3(1.0, 0.78, 0.48) * lights * 1.2 * (1.0 - dayMix);
        float water = texture2D(uWater, vUv).r;
        vec3 h = normalize(uLight + v);
        float glint = pow(max(dot(n, h), 0.0), 320.0) * smoothstep(0.5, 0.9, water) * dayMix;
        float fres = pow(1.0 - max(dot(n, v), 0.0), 2.6);
        vec3 haze = vec3(0.32, 0.55, 1.0) * fres * 0.55 * smoothstep(-0.25, 0.5, ndl);
        vec3 ocean = vec3(0.02, 0.05, 0.11) * water * wrap; // deep-water blue
        gl_FragColor = vec4(lit + ocean + night + vec3(1.0, 0.96, 0.88) * glint * 0.14 + haze, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

/** Fresnel rim glow for an atmosphere shell (Earth, faintly Mars). */
export function atmosphereMaterial(
  color: ColorRepresentation,
  strength: number,
  power: number,
  lightDir: Vector3,
): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uColor: { value: new Color(color) },
      uStrength: { value: strength },
      uPower: { value: power },
      uLight: { value: lightDir },
    },
    vertexShader: /* glsl */ `
      varying vec3 vNormalW;
      varying vec3 vPosW;
      void main() {
        vNormalW = normalize(mat3(modelMatrix) * normal);
        vec4 w = modelMatrix * vec4(position, 1.0);
        vPosW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uStrength;
      uniform float uPower;
      uniform vec3 uLight;
      varying vec3 vNormalW;
      varying vec3 vPosW;
      void main() {
        vec3 n = normalize(vNormalW);
        vec3 v = normalize(cameraPosition - vPosW);
        float rim = pow(1.0 - max(dot(n, v), 0.0), uPower);
        float sun = 0.12 + 0.88 * smoothstep(-0.35, 0.55, dot(n, uLight)); // glow on the day side
        float a = rim * uStrength * sun;
        gl_FragColor = vec4(uColor * a, a);
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
        float a = disc * (0.35 + 0.65 * ripple) * edge * boost * uOpacity * smoothstep(0.15, 0.45, vFacing);
        gl_FragColor = vec4(uColor * a, a);
      }`,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
  });
}
