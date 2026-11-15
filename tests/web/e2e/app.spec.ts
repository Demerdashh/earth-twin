import { expect, test, type Page } from '@playwright/test';

interface Debug {
  view: 'system' | 'body' | 'region';
  body: string | null;
  selected: string | null;
  regions: number;
  visible: boolean;
  patch: string;
  tiles: number;
  camera: number[];
  travelling: boolean;
  warp: number;
}

/** Rotation angle between two quaternions [x, y, z, w], radians. */
const angle = (a: number[], b: number[]): number => {
  const dot = Math.abs(a.reduce((s, v, i) => s + v * (b[i] ?? 0), 0));
  return 2 * Math.acos(Math.min(1, dot));
};
interface Hook {
  debug: () => Debug;
  orientation: (b: string) => number[];
  screenOf: (b: string) => { x: number; y: number };
}

const debug = (page: Page): Promise<Debug> =>
  page.evaluate(() => (window as unknown as { __analoglens: Hook }).__analoglens.debug());
const orientation = (page: Page, body: string): Promise<number[]> =>
  page.evaluate((b) => (window as unknown as { __analoglens: Hook }).__analoglens.orientation(b), body);
const screenOf = (page: Page, body: string): Promise<{ x: number; y: number }> =>
  page.evaluate((b) => (window as unknown as { __analoglens: Hook }).__analoglens.screenOf(b), body);
const started = (page: Page): Promise<unknown> =>
  page.waitForFunction(() => '__analoglens' in window, undefined, { timeout: 30_000 });
const settle = (page: Page, ms = 2600): Promise<void> => page.waitForTimeout(ms);

test('preloader plays first; nothing in the app starts until it is gone', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#preloader .pl-word')).toHaveText('Loading');
  await expect(page.locator('#preloader .pl-moon')).toHaveCount(5);
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => '__analoglens' in window)).toBe(false);
  await expect(page.locator('#space canvas')).toHaveCount(0);
  await expect(page.locator('#app')).toHaveAttribute('inert', '');

  await started(page);
  await expect(page.locator('#preloader')).toHaveCount(0);
  await expect(page.locator('#app')).not.toHaveAttribute('inert', '');
  await expect(page.locator('#space canvas')).toHaveCount(1);
});

test('each planet turns on its own; panning and zooming move only the view', async ({ page }) => {
  await page.goto('/');
  await started(page);
  await settle(page, 800);

  // Every planet spins slowly on its own axis; dragging Mars turns Mars far more than that drift,
  // while the Moon and Earth only keep their slow spin.
  const mars = await screenOf(page, 'mars');
  const before = await Promise.all(['moon', 'earth', 'mars'].map((b) => orientation(page, b)));
  await page.mouse.move(mars.x, mars.y);
  await page.mouse.down();
  await page.mouse.move(mars.x + 140, mars.y + 30, { steps: 8 });
  await page.mouse.up();
  await settle(page, 300);
  const after = await Promise.all(['moon', 'earth', 'mars'].map((b) => orientation(page, b)));
  expect(angle(before[0]!, after[0]!)).toBeLessThan(0.15);
  expect(angle(before[1]!, after[1]!)).toBeLessThan(0.15);
  expect(angle(before[2]!, after[2]!)).toBeGreaterThan(0.6);

  // Drag empty space: the view pans sideways (not an orbit).
  const cam0 = (await debug(page)).camera;
  await page.mouse.move(300, 90);
  await page.mouse.down();
  await page.mouse.move(140, 90, { steps: 8 });
  await page.mouse.up();
  await settle(page, 600);
  const cam1 = (await debug(page)).camera;
  expect(cam1[0]!).toBeGreaterThan(cam0[0]! + 0.2);
  expect(cam1[2]).toBeCloseTo(cam0[2]!, 1);
});

test('going to Mars is a jump across space: turn, star streaks, whole planet, then the place', async ({ page }) => {
  await page.goto('/');
  await started(page);
  await page.getByRole('button', { name: 'Mars', exact: true }).click();
  let peak = 0;
  for (let i = 0; i < 40 && peak < 0.5; i++) {
    peak = Math.max(peak, (await debug(page)).warp);
    await page.waitForTimeout(100);
  }
  expect(peak).toBeGreaterThan(0.5);
  await expect.poll(async () => (await debug(page)).travelling, { timeout: 15_000 }).toBe(false);
  expect((await debug(page)).body).toBe('mars');
  expect((await debug(page)).warp).toBe(0);
});

test('dive into a region, travel to its analog, then scroll back out freely', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await started(page);

  // No pipeline output is published: the page says so (About) and shows no score.
  await page.locator('#about-open').click();
  await expect(page.locator('#about')).toContainText('not published yet');
  await page.keyboard.press('Escape');
  expect((await debug(page)).regions).toBeGreaterThan(15);

  await page.getByRole('button', { name: 'Mars', exact: true }).click();
  await expect.poll(async () => (await debug(page)).body).toBe('mars');
  expect((await debug(page)).view).toBe('body');

  await page.locator('#toggle-regions').click();
  expect((await debug(page)).visible).toBe(false);
  await page.locator('#toggle-regions').click();
  expect((await debug(page)).visible).toBe(true);

  // Keyboard path into a region (the same action as clicking its dots).
  await page.locator('#region-nav button', { hasText: 'Medusae Fossae' }).focus();
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await debug(page)).view).toBe('region');
  await expect(page.locator('#card')).toHaveClass(/is-open/);
  await expect(page.locator('#card-title')).toContainText('Medusae Fossae');
  await expect(page.locator('#card')).toContainText(
    'Earth ranking appears here once the real pipeline output is published',
  );

  // Travel along the link to Earth.
  await page.locator('#card .link-chip', { hasText: 'Kharga Depression' }).click();
  await expect.poll(async () => (await debug(page)).body, { timeout: 15_000 }).toBe('earth');
  expect((await debug(page)).selected).toBe('egypt_kharga_depression');
  await expect(page.locator('#card-title')).toHaveText('Kharga Depression');
  await expect.poll(async () => (await debug(page)).patch, { timeout: 30_000 }).toMatch(/ready|failed/);

  // Scroll out: no hard stop. The region closes and the card goes with it.
  for (let i = 0; i < 8; i++) await page.mouse.wheel(0, 400);
  await expect.poll(async () => (await debug(page)).view).not.toBe('region');
  await expect(page.locator('#card')).not.toHaveClass(/is-open/);
  // Home: Earth in front, the Moon and Mars in the same sky.
  await page.getByRole('button', { name: 'All three bodies' }).click();
  await expect.poll(async () => (await debug(page)).view, { timeout: 15_000 }).toBe('system');
  await expect(page.locator('[data-body="earth"]')).toHaveAttribute('aria-pressed', 'false');

  // The guided tour (for the video) shows one caption at a time and stops on any input.
  await page.locator('#tour').click();
  await expect(page.locator('#caption')).toHaveClass(/is-on/);
  await expect(page.locator('#caption')).toContainText('Apollo');
  await page.keyboard.press('Escape');
  await expect(page.locator('#caption')).not.toHaveClass(/is-on/);
  expect(errors).toEqual([]);
});
