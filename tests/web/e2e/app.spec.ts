import { expect, test, type Page } from '@playwright/test';

interface Debug {
  view: 'system' | 'body' | 'region';
  body: string | null;
  selected: string | null;
  regions: number;
  visible: boolean;
  patch: string;
  tiles: number;
}

const debug = (page: Page): Promise<Debug> =>
  page.evaluate(() => (window as unknown as { __analoglens: { debug: () => Debug } }).__analoglens.debug());

const started = (page: Page): Promise<unknown> =>
  page.waitForFunction(() => '__analoglens' in window, undefined, { timeout: 30_000 });

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

test('one scene: switch bodies, hide regions, dive in and travel to the linked site', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await started(page);

  // No pipeline output is published: the page says so and shows no score.
  await expect(page.locator('#status')).toHaveText('Awaiting pipeline output');
  expect((await debug(page)).view).toBe('system');
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
  // The close-up drapes real NASA tiles over the region (needs network; never fakes imagery).
  await expect.poll(async () => (await debug(page)).patch, { timeout: 30_000 }).toMatch(/ready|failed/);

  await page.keyboard.press('Escape');
  await expect.poll(async () => (await debug(page)).view).toBe('body');
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await debug(page)).view).toBe('system');

  // The guided tour (for the video) shows one caption at a time and stops on any input.
  await page.locator('#tour').click();
  await expect(page.locator('#caption')).toHaveClass(/is-on/);
  await expect(page.locator('#caption')).toContainText('Apollo');
  await page.keyboard.press('Escape');
  await expect(page.locator('#caption')).not.toHaveClass(/is-on/);
  expect(errors).toEqual([]);
});
