// Overlay colour ramps — keep in sync with pipeline/contract/colormaps.py (used to render the PNGs).
export type Rgba = [number, number, number, number];
export type RampName = 'similarity' | 'vegetation_exclusion' | 'water_ice';

export const RAMPS: Record<RampName, [number, Rgba][]> = {
  similarity: [
    [0.0, [13, 27, 42, 0]],
    [0.25, [31, 78, 121, 110]],
    [0.5, [42, 157, 143, 170]],
    [0.75, [233, 196, 106, 210]],
    [1.0, [255, 244, 214, 235]],
  ],
  vegetation_exclusion: [
    [0.0, [120, 200, 120, 0]],
    [1.0, [120, 200, 120, 150]],
  ],
  water_ice: [
    [0.0, [90, 170, 255, 0]],
    [0.5, [90, 170, 255, 120]],
    [1.0, [200, 235, 255, 220]],
  ],
};

export function sampleRamp(name: RampName, value: number): Rgba {
  const stops = RAMPS[name];
  const v = Math.min(1, Math.max(0, value));
  for (let i = 0; i < stops.length - 1; i++) {
    const [p0, c0] = stops[i]!;
    const [p1, c1] = stops[i + 1]!;
    if (v <= p1) {
      const t = p1 === p0 ? 0 : (v - p0) / (p1 - p0);
      return c0.map((c, k) => Math.round(c + (c1[k]! - c) * t)) as Rgba;
    }
  }
  return stops[stops.length - 1]![1];
}

/** Opaque CSS colour for markers (alpha ignored so small markers stay visible). */
export const rampCss = (name: RampName, value: number): string => {
  const [r, g, b] = sampleRamp(name, Math.max(0.3, value));
  return `rgb(${r}, ${g}, ${b})`;
};

/** CSS gradient for legends. */
export const rampGradient = (name: RampName): string =>
  `linear-gradient(90deg, ${RAMPS[name].map(([p, [r, g, b, a]]) => `rgba(${r}, ${g}, ${b}, ${Math.max(a, 60) / 255}) ${p * 100}%`).join(', ')})`;
