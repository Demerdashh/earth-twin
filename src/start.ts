// Lazy chunk: three.js and the app. Loaded during the preloader, started only after it.
import { Texture } from 'three';
import { App } from './app';
import type { Body } from './data/config';
import type { OutState } from './data/out';

export function start(out: OutState, images: Record<Body, HTMLImageElement>): App {
  const tex = (img: HTMLImageElement): Texture => {
    const t = new Texture(img);
    t.needsUpdate = true;
    return t;
  };
  return new App(out, { moon: tex(images.moon), earth: tex(images.earth), mars: tex(images.mars) });
}
