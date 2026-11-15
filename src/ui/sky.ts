/**
 * Background star field, painted once on a canvas (random positions, no tiling pattern).
 * Shared by the preloader and the page; repainted on resize.
 */
function paint(canvas: HTMLCanvasElement): void {
  const pr = Math.min(window.devicePixelRatio || 1, 2);
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = Math.round(w * pr);
  canvas.height = Math.round(h * pr);
  const g = canvas.getContext('2d');
  if (!g) return;
  g.scale(pr, pr);
  // Deterministic pseudo-random so the sky does not jump between the preloader and the page.
  let seed = 20261115;
  const rand = (): number => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const count = Math.round((w * h) / 2600);
  for (let i = 0; i < count; i++) {
    const r = rand() ** 4 * 1.3 + 0.35;
    const a = 0.25 + rand() * 0.6;
    g.beginPath();
    g.arc(rand() * w, rand() * h, r, 0, Math.PI * 2);
    g.fillStyle = rand() < 0.15 ? `rgba(190,210,255,${a})` : `rgba(255,255,255,${a})`;
    g.fill();
  }
}

export function mountSky(): void {
  const canvases = [...document.querySelectorAll<HTMLCanvasElement>('canvas.stars')];
  const all = (): void => canvases.forEach(paint);
  all();
  let t = 0;
  window.addEventListener('resize', () => {
    clearTimeout(t);
    t = window.setTimeout(all, 150);
  });
}
