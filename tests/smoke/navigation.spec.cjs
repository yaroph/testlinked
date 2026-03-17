const { test, expect } = require('@playwright/test');
const { installNetlifyMocks, seedHomeBootSeen, waitForMapReady, waitForPointReady } = require('./helpers.cjs');

test('home navigates directly to point without auth gate', async ({ page }) => {
    await installNetlifyMocks(page);
    await seedHomeBootSeen(page);

    await page.goto('/');
    await expect(page.locator('#module-reticule')).toBeVisible();
    await page.click('#module-reticule');
    await page.waitForURL('**/point/');
    await waitForPointReady(page);
});

test('home navigates directly to map without auth gate', async ({ page }) => {
    await installNetlifyMocks(page);
    await seedHomeBootSeen(page);

    await page.goto('/');
    await expect(page.locator('#module-tactique')).toBeVisible();
    await page.click('#module-tactique');
    await page.waitForURL('**/map/');
    await waitForMapReady(page);
});
