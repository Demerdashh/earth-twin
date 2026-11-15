// Captures docs/screenshots/*.jpg (JPEG q80 keeps the repo small). Run: npm run screenshots
import { expect, test, type Page } from '@playwright/test';

const settle = async (page: Page, ms = 4500): Promise<void> => {
  await page.waitForFunction(
    () => 'ready' in ((window as unknown as { __analogFinder?: object }).__analogFinder ?? {}),
    undefined,
    { timeout: 30_000 },
  );
  await page.evaluate(() =>
    (window as unknown as { __analogFinder: { ready: () => Promise<void> } }).__analogFinder.ready(),
  );
  await expect(page.locator('#imagery-status')).not.toHaveText('Connecting to imagery…', { timeout: 30_000 });
  await page.waitForTimeout(ms); // let tiles and the camera flight finish
};

/** Headless software-GL can refuse a capture while the engine chunk is parsing: retry briefly. */
async function shot(page: Page, path: string): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      await page.screenshot({ path, timeout: 5000, type: 'jpeg', quality: 80 }); // small files, not PNG
      return;
    } catch (err) {
      if (i >= 8) throw err;
      await page.waitForTimeout(250);
    }
  }
}

test('@screenshots preloader, story, explore and methods', async ({ page }) => {
  await page.goto('/?data=mock#story');
  await page.waitForTimeout(700);
  await shot(page, 'docs/screenshots/preloader.jpg');

  await settle(page);
  await shot(page, 'docs/screenshots/story-hook.jpg');

  for (const id of ['fingerprint', 'search', 'trust']) {
    await page.locator(`[data-dot="${id}"]`).click();
    await settle(page);
    await shot(page, `docs/screenshots/story-${id}.jpg`);
  }

  await page.goto('/?data=mock#explore');
  await page.reload(); // a hash-only navigation keeps Story state; start Explore fresh
  await settle(page);
  await shot(page, 'docs/screenshots/explore-earth.jpg');
  await page.locator('#ranking-list li').first().locator('button').click();
  await settle(page);
  await shot(page, 'docs/screenshots/explore.jpg');

  await page.getByRole('button', { name: 'Mars', exact: true }).click();
  await settle(page);
  await shot(page, 'docs/screenshots/explore-mars.jpg');

  await page.getByRole('button', { name: 'Moon', exact: true }).click();
  await settle(page);
  await shot(page, 'docs/screenshots/explore-moon.jpg');

  await page.goto('/?data=mock#methods');
  await page.waitForSelector('#methods-title');
  await page.waitForTimeout(500);
  await shot(page, 'docs/screenshots/methods.jpg');
});
