import './styles.css';
import { loadOut } from './data/out';
import { $ } from './ui/dom';
import { Preloader } from './ui/preloader';
import { mountSky } from './ui/sky';

/**
 * Boot order: the preloader shows at once (this entry chunk is tiny). Meanwhile the 3D engine
 * chunk, the three globe textures and the real pipeline output (if published) load.
 * Nothing in the app is constructed until the preloader has completely finished.
 */
function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.decoding = 'async';
  img.src = src;
  return img.decode().then(() => img);
}

async function boot(): Promise<void> {
  mountSky();
  const preloader = new Preloader($('#preloader'));
  const base = import.meta.env.BASE_URL;
  const work = Promise.all([
    import('./start'),
    loadOut(),
    Promise.all([
      loadImage(`${base}textures/moon.webp`),
      loadImage(`${base}textures/earth.webp`),
      loadImage(`${base}textures/mars.webp`),
    ]),
  ]);
  let result: Awaited<typeof work> | Error;
  try {
    result = await work;
  } catch (err) {
    result = err instanceof Error ? err : new Error(String(err));
  }
  preloader.markReady();
  await preloader.finish();

  const app = $('#app');
  app.removeAttribute('inert');
  document.body.classList.remove('is-loading');
  if (result instanceof Error) {
    $('#fatal').hidden = false;
    $('#fatal-msg').textContent = result.message;
    return;
  }
  const [start, out, [moon, earth, mars]] = result;
  start.start(out, { moon, earth, mars });
}

void boot();
