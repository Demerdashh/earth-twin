// Captures docs/screenshots/*.png. Run: npm run screenshots
import { expect, test, type Page } from '@playwright/test';

const settle = async (page: Page): Promise<void> => {
  await page.waitForFunction(
    () => 'ready' in ((window as unknown as { __analogFinder?: object }).__analogFinder ?? {}),
  );
  await page.evaluate(() =>
    (window as unknown as { __analogFinder: { ready: () => Promise<void> } }).__analogFinder.ready(),
  );
  await expect(page.locator('#imagery-status')).not.toHaveText('Connecting to imagery…', { timeout: 30_000 });
  await page.waitForTimeout(4000); // let tiles and the camera flight finish
};

test('@screenshots story, explore and methods', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?data=mock#story');
  await settle(page);
  await page.screenshot({ path: 'docs/screenshots/story-hook.png' });

  await page.locator('[data-dot="search"]').click();
  await settle(page);
  await page.screenshot({ path: 'docs/screenshots/story-search.png' });

  await page.locator('[data-dot="trust"]').click();
  await settle(page);
  await page.screenshot({ path: 'docs/screenshots/story-trust.png' });

  await page.goto('/?data=mock#explore');
  await page.reload(); // a hash-only navigation keeps Story state; start Explore fresh
  await settle(page);
  await page.screenshot({ path: 'docs/screenshots/explore-earth.png' });
  await page.locator('#ranking-list li').first().locator('button').click();
  await settle(page);
  await page.screenshot({ path: 'docs/screenshots/explore.png' });

  await page.getByRole('button', { name: 'Mars', exact: true }).click();
  await settle(page);
  await page.screenshot({ path: 'docs/screenshots/explore-mars.png' });

  await page.getByRole('button', { name: 'Moon', exact: true }).click();
  await settle(page);
  await page.screenshot({ path: 'docs/screenshots/explore-moon.png' });

  await page.goto('/?data=mock#methods');
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'docs/screenshots/methods.png' });
});
