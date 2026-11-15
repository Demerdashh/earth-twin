// Lazy chunk: three.js and the app. Loaded during the preloader, started only after it.
import { Texture } from 'three';
import { App } from './app';
import type { OutState } from './data/out';
import type { BodyTextures } from './scene/space';

export type TextureImages = Record<keyof BodyTextures, HTMLImageElement>;

export function start(out: OutState, images: TextureImages): App {
  const tex = (img: HTMLImageElement): Texture => {
    const t = new Texture(img);
    t.needsUpdate = true;
    return t;
  };
  return new App(out, {
    moon: tex(images.moon),
    mars: tex(images.mars),
    earth: tex(images.earth),
    earthNight: tex(images.earthNight),
    earthWater: tex(images.earthWater),
  });
}
