/**
 * Space preloader: a small Moon turns in the centre while the data set and the 3D engine load,
 * then rises off the top of the screen while the space curtain lifts.
 * `finish()` resolves only after the exit animation has completed and the preloader is removed,
 * so the app is never started underneath it.
 */
import { prefersReducedMotion } from './dom';

const MIN_VISIBLE_MS = 2400;

export class Preloader {
  private readonly started = performance.now();
  private readonly arc: SVGCircleElement | null;
  private readonly status: HTMLElement | null;
  private readonly steps = new Set<string>();

  constructor(
    private readonly root: HTMLElement,
    private readonly totalSteps: number,
  ) {
    this.arc = root.querySelector<SVGCircleElement>('.pl-progress');
    this.status = root.querySelector<HTMLElement>('.pl-status');
    this.render();
  }

  /** Mark one named loading step as done (data, engine, ...). */
  step(name: string): void {
    this.steps.add(name);
    this.render();
  }

  private render(): void {
    const p = Math.min(1, this.steps.size / this.totalSteps);
    this.arc?.style.setProperty('--p', String(p));
    if (this.status) this.status.textContent = p < 1 ? `Loading ${Math.round(p * 100)}%` : 'Ready';
  }

  /** Play the exit and remove the preloader. Resolves when it is completely gone. */
  async finish(): Promise<void> {
    const wait = MIN_VISIBLE_MS - (performance.now() - this.started);
    const reduced = prefersReducedMotion();
    if (wait > 0 && !reduced) await new Promise((r) => setTimeout(r, wait));

    const moon = this.root.querySelector<HTMLElement>('.pl-moon-wrap');
    const word = this.root.querySelector<HTMLElement>('.pl-word');
    const animations: Animation[] = [];
    if (reduced) {
      animations.push(this.root.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 250, fill: 'forwards' }));
    } else {
      const ease = 'cubic-bezier(0.7, 0, 0.2, 1)';
      if (word) animations.push(word.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: 'forwards' }));
      if (moon)
        animations.push(
          moon.animate(
            [
              { transform: 'translateY(0) scale(1)' },
              { transform: 'translateY(6vh) scale(0.96)', offset: 0.18 }, // small anticipation dip
              { transform: 'translateY(-75vh) scale(1.25)' },
            ],
            { duration: 1500, easing: ease, fill: 'forwards' },
          ),
        );
      animations.push(
        this.root.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(-100%)' }], {
          duration: 1100,
          delay: 650,
          easing: ease,
          fill: 'forwards',
        }),
      );
    }
    await Promise.all(animations.map((a) => a.finished));
    this.root.remove();
  }
}
