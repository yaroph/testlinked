const { test, expect } = require('@playwright/test');
const { drawCircleInViewport, installNetlifyMocks, unlockStaffConsole } = require('./helpers.cjs');

test('staff can draw and publish a circle alert', async ({ page }) => {
    const api = await installNetlifyMocks(page);

    await page.goto('/staff/');
    await unlockStaffConsole(page);

    await page.click('#btnNewAlert');
    await drawCircleInViewport(page, '#viewport', {
        startXRatio: 0.48,
        startYRatio: 0.45,
        endXRatio: 0.64,
        endYRatio: 0.58,
    });

    await expect(page.locator('#staff-alert-modal')).toBeVisible();
    await page.fill('#alertTitle', 'Smoke alert');
    await page.fill('#alertDescription', 'Smoke description');
    await page.click('#btnPublishAlert');

    await expect.poll(() => api.requests.filter((entry) => entry.endpoint === 'alerts' && entry.action === 'upsert').length).toBe(1);
    await expect(page.locator('#staffAlertsList')).toContainText('Smoke alert');
});
