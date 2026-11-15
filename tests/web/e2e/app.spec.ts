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
  shown: string[];
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
  facingRegions: () => { id: string; name: string; x: number; y: number }[];
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

test('home is Earth alone, centred; hover names a region; each planet turns on its own', async ({ page }) => {
  await page.goto('/');
  await started(page);
  await settle(page, 800);

  // Home: only Earth is drawn, exactly in the middle of the screen.
  const d0 = await debug(page);
  expect(d0.view).toBe('system');
  expect(d0.shown).toEqual(['earth']);
  const size = page.viewportSize()!;
  const earth = await screenOf(page, 'earth');
  expect(Math.abs(earth.x - size.width / 2)).toBeLessThan(2);
  expect(Math.abs(earth.y - size.height / 2)).toBeLessThan(2);

  // Hovering a dotted area shows a small label with its name.
  const facing = await page.evaluate(() => (window as unknown as { __analoglens: Hook }).__analoglens.facingRegions());
  const spot = facing.find((r) => Math.hypot(r.x - earth.x, r.y - earth.y) < 200) ?? facing[0]!;
  await page.mouse.move(spot.x, spot.y);
  await expect(page.locator('#tip')).toHaveClass(/is-on/);
  await expect(page.locator('#tip')).toContainText(spot.name);
  await page.mouse.move(20, 20);
  await expect(page.locator('#tip')).not.toHaveClass(/is-on/);

  // Every planet spins slowly on its own axis; dragging Earth turns Earth far more than that drift,
  // while the Moon and Mars only keep their slow spin.
  const before = await Promise.all(['moon', 'earth', 'mars'].map((b) => orientation(page, b)));
  await page.mouse.move(earth.x - 160, earth.y);
  await page.mouse.down();
  await page.mouse.move(earth.x + 160, earth.y + 30, { steps: 10 });
  await page.mouse.up();
  await settle(page, 300);
  const after = await Promise.all(['moon', 'earth', 'mars'].map((b) => orientation(page, b)));
  expect(angle(before[0]!, after[0]!)).toBeLessThan(0.15);
  expect(angle(before[1]!, after[1]!)).toBeGreaterThan(0.6);
  expect(angle(before[2]!, after[2]!)).toBeLessThan(0.15);

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

test('going to Mars is a long jump: Mars stays out of sight, then appears small and grows', async ({ page }) => {
  await page.goto('/');
  await started(page);
  await page.getByRole('button', { name: 'Mars', exact: true }).click();
  let peak = 0;
  for (let i = 0; i < 80 && peak < 0.9; i++) {
    const d = await debug(page);
    peak = Math.max(peak, d.warp);
    expect(d.shown).not.toContain('mars'); // not even during the turn or the first half of the jump
    await page.waitForTimeout(100);
  }
  expect(peak).toBeGreaterThan(0.9);
  await expect.poll(async () => (await debug(page)).shown, { timeout: 15_000 }).toContain('mars');
  await expect.poll(async () => (await debug(page)).travelling, { timeout: 15_000 }).toBe(false);
  const d = await debug(page);
  expect(d.body).toBe('mars');
  expect(d.shown).toEqual(['mars']);
  expect(d.warp).toBe(0);
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
  await expect.poll(async () => (await debug(page)).body, { timeout: 25_000 }).toBe('mars');
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
  await expect.poll(async () => (await debug(page)).body, { timeout: 30_000 }).toBe('earth');
  expect((await debug(page)).selected).toBe('egypt_kharga_depression');
  await expect(page.locator('#card-title')).toHaveText('Kharga Depression');
  await expect.poll(async () => (await debug(page)).patch, { timeout: 30_000 }).toMatch(/ready|failed/);

  // Scroll out: no hard stop. The region closes and the card goes with it.
  for (let i = 0; i < 8; i++) await page.mouse.wheel(0, 400);
  await expect.poll(async () => (await debug(page)).view).not.toBe('region');
  await expect(page.locator('#card')).not.toHaveClass(/is-open/);
  // Home: Earth whole and centred.
  await page.getByRole('button', { name: 'All three bodies' }).click();
  await expect.poll(async () => (await debug(page)).view, { timeout: 15_000 }).toBe('system');
  expect((await debug(page)).shown).toEqual(['earth']);
  await expect(page.locator('[data-body="earth"]')).toHaveAttribute('aria-pressed', 'false');

  // The guided tour (for the video) shows one caption at a time and stops on any input.
  await page.locator('#tour').click();
  await expect(page.locator('#caption')).toHaveClass(/is-on/);
  await expect(page.locator('#caption')).toContainText('Apollo');
  await page.keyboard.press('Escape');
  await expect(page.locator('#caption')).not.toHaveClass(/is-on/);
  expect(errors).toEqual([]);
});
