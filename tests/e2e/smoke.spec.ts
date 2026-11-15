import { expect, test, type Page } from '@playwright/test';

interface Debug {
  body: string | null;
  ellipsoidRadii: number[];
  layers: number;
}

async function ready(page: Page): Promise<void> {
  await page.waitForFunction(
    () => 'ready' in ((window as unknown as { __analogFinder?: object }).__analogFinder ?? {}),
  );
  await page.evaluate(() =>
    (window as unknown as { __analogFinder: { ready: () => Promise<void> } }).__analogFinder.ready(),
  );
}

const debug = (page: Page): Promise<Debug> =>
  page.evaluate(() =>
    (window as unknown as { __analogFinder: { globe: { debugInfo: () => Debug } } }).__analogFinder.globe.debugInfo(),
  );

const rankingIds = (page: Page): Promise<string[]> =>
  page.locator('#ranking-list li').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.candidateId ?? ''));

test('nothing in the app starts until the preloader has completely finished', async ({ page }) => {
  await page.goto('/?data=mock#story');
  await expect(page.locator('#preloader')).toBeVisible();
  await page.waitForTimeout(800);
  // Still loading: no app object, no globe canvas, content inert.
  expect(
    await page.evaluate(() => 'ready' in ((window as unknown as { __analogFinder?: object }).__analogFinder ?? {})),
  ).toBe(false);
  await expect(page.locator('#globe canvas')).toHaveCount(0);
  await expect(page.locator('#app')).toHaveAttribute('inert', '');

  await ready(page);
  await expect(page.locator('#preloader')).toHaveCount(0);
  await expect(page.locator('#app')).not.toHaveAttribute('inert', '');
  await expect(page.locator('#globe canvas')).toHaveCount(1);

  // Fast chapter jumps (Moon -> Earth -> Moon, passing Mars while scrolling) must end on the last body.
  await page.locator('[data-dot="search"]').click();
  await page.locator('[data-dot="fingerprint"]').click();
  await page.waitForTimeout(1500);
  await ready(page);
  expect((await debug(page)).body).toBe('moon');
  expect((await debug(page)).ellipsoidRadii[0]).toBe(1737400);
});

test('loads, switches bodies with the right ellipsoid, and re-ranks when a weight changes', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?data=mock#explore');

  await expect(page.locator('#data-badge')).toHaveText('Mock data');
  await ready(page);
  expect((await debug(page)).body).toBe('earth');
  expect((await debug(page)).ellipsoidRadii[0]).toBeCloseTo(6378137, 0);

  await page.getByRole('button', { name: 'Moon', exact: true }).click();
  await expect.poll(async () => (await debug(page)).body).toBe('moon');
  await ready(page);
  expect((await debug(page)).ellipsoidRadii).toEqual([1737400, 1737400, 1737400]);

  await page.getByRole('button', { name: 'Mars', exact: true }).click();
  await expect.poll(async () => (await debug(page)).body).toBe('mars');
  await ready(page);
  expect((await debug(page)).ellipsoidRadii).toEqual([3396190, 3396190, 3376200]);

  await page.getByRole('button', { name: 'Earth', exact: true }).click();
  await expect.poll(async () => (await debug(page)).body).toBe('earth');

  const before = await rankingIds(page);
  expect(before.length).toBeGreaterThan(5);
  await page.locator('#w-temp_range_k').fill('0');
  await page.locator('#w-slope_deg').fill('3');
  await expect.poll(() => rankingIds(page)).not.toEqual(before);

  // Keyboard path: open a candidate from the ranking list.
  await page.locator('#ranking-list li').first().locator('button').press('Enter');
  await expect(page.locator('#popup')).toBeVisible();
  await expect(page.locator('#popup')).toContainText('Mock values — not measurements');
  await page.keyboard.press('Escape');
  await expect(page.locator('#popup')).toBeHidden();

  expect(errors).toEqual([]);
});

test('refuses data that breaks the contract and explains why', async ({ page }) => {
  await page.route('**/data/manifest.json', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ schema_version: '1.0', mock: false }) }),
  );
  await page.goto('/?data=real');
  await expect(page.getByRole('alert')).toContainText('does not match the contract');
  await expect(page.getByRole('alert')).toContainText('manifest.json');
  await expect(page.getByRole('link', { name: 'Load the mock data set instead' })).toBeVisible();
});
