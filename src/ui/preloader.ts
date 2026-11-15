/**
 * Preloader: dark sky with stars, the word "Loading", and a row of tiny moons that grow from
 * small to slightly larger one after another. The wave plays twice, then the page opens; if
 * loading is slower it keeps playing whole waves until everything is ready.
 * `finish()` resolves only when the preloader is completely gone.
 */
import { reducedMotion } from './dom';

const WAVE_MS = 1300;
const MIN_WAVES = 2;

export class Preloader {
  private readonly dots: HTMLElement[];
  private ready = false;
  private onReady: (() => void) | null = null;

  constructor(private readonly root: HTMLElement) {
    this.dots = [...root.querySelectorAll<HTMLElement>('.pl-moon')];
  }

  /** Call when every asset the page needs has loaded. */
  markReady(): void {
    this.ready = true;
    this.onReady?.();
  }

  private wave(): Promise<void> {
    const anims = this.dots.map((dot, i) =>
      dot.animate(
        [
          { transform: 'scale(0.6)', opacity: 0.55 },
          { transform: 'scale(1.12)', opacity: 1, offset: 0.5 },
          { transform: 'scale(1)', opacity: 1 },
        ],
        { duration: WAVE_MS - i * 90, delay: i * 90, easing: 'cubic-bezier(0.3, 0.7, 0.2, 1)', fill: 'both' },
      ),
    );
    return Promise.all(anims.map((a) => a.finished)).then(() => undefined);
  }

  async finish(): Promise<void> {
    if (!reducedMotion()) {
      let waves = 0;
      while (waves < MIN_WAVES || !this.ready) {
        await this.wave();
        waves++;
      }
    } else if (!this.ready) {
      await new Promise<void>((r) => (this.onReady = r));
    }
    const out = this.root.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: reducedMotion() ? 150 : 700,
      easing: 'ease',
      fill: 'forwards',
    });
    await out.finished;
    this.root.remove();
  }
}
