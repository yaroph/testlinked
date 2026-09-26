const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const { createNetlifyFixture } = require('../helpers/memory-netlify.cjs');
const testCode = 'admin-ui-test-code';
const accessCode = process.env.BNI_TEST_PERMANENT_STAFF_CODE || testCode;
let previousCode;
test.beforeEach(() => { previousCode = process.env.BNI_LINKED_STAFF_CODE; process.env.BNI_LINKED_STAFF_CODE = testCode; });
test.afterEach(() => {
  if (previousCode === undefined) delete process.env.BNI_LINKED_STAFF_CODE;
  else process.env.BNI_LINKED_STAFF_CODE = previousCode;
});

async function installApi(page) {
  const api = createNetlifyFixture();
  const requests = [];
  await page.route('**/.netlify/functions/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const name = url.pathname.split('/').pop();
    const body = request.postDataJSON() || {};
    requests.push({ name, body, headers: request.headers() });
    if (!['db-boards', 'db-list', 'db-get', 'alerts'].includes(name)) {
      return route.fulfill({ status: 401, json: { ok: false, error: 'Session requise.' } });
    }
    const response = await api.request(name, { method: request.method(), headers: request.headers(), body, query: Object.fromEntries(url.searchParams) });
    return route.fulfill({ status: response.statusCode, headers: response.headers, body: response.body });
  });
  return { ...api, requests };
}

test('admin login exposes every owner, downloads a cloud and paginates', async ({ page }, testInfo) => {
  const api = await installApi(page);
  for (let i = 0; i < 56; i++) {
    await api.getLogicalStore('bni-linked-collab').setJSON(`boards/board-${i}`, {
      id: `board-${i}`, title: `Cloud ${i}`, ownerId: `owner-${i}`, ownerName: `user-${i}`,
      page: i % 2 ? 'map' : 'point', members: [], updatedAt: '2026-09-26T10:00:00.000Z',
      data: i % 2 ? { groups: [], tacticalLinks: [] } : { nodes: [], links: [] },
    });
  }
  await page.goto('/database/');
  await page.getByRole('textbox', { name: 'Code administrateur' }).fill('incorrect');
  await page.getByRole('button', { name: 'SE CONNECTER' }).click();
  await expect(page.locator('.db-auth-error')).toContainText('incorrect');
  await page.getByRole('textbox', { name: 'Code administrateur' }).fill(accessCode);
  await page.getByRole('button', { name: 'SE CONNECTER' }).click();
  await expect(page.locator('#cards-boards .data-card')).toHaveCount(50);
  await expect(page.locator('#status-boards')).toContainText('56 clouds');
  await page.locator('#load-more-boards').click();
  await expect(page.locator('#cards-boards .data-card')).toHaveCount(56);
  await expect(page.locator('#cards-boards')).toContainText('user-55');
  const downloadPromise = page.waitForEvent('download');
  await page.locator('[data-board-action="download"]').first().click();
  const download = await downloadPromise;
  const downloaded = JSON.parse(await fs.readFile(await download.path(), 'utf8'));
  expect(downloaded.nodes).toEqual([]);
  expect(downloaded.ownerId).toBeUndefined();
  await page.reload();
  await expect(page.locator('#cards-boards .data-card')).toHaveCount(50);
  await page.screenshot({ path: testInfo.outputPath('database-desktop.png'), fullPage: false });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath('database-mobile.png'), fullPage: false });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('staff validates the permanent or configured code on the server before unlocking', async ({ page }) => {
  const api = await installApi(page);
  await page.goto('/staff/');
  await page.locator('#staff-access-input').fill('incorrect');
  await page.locator('#staff-access-submit').click();
  await expect(page.locator('#staff-access-error')).toContainText('refusé');
  await expect(page.locator('#staff-access-overlay')).toBeVisible();
  await page.locator('#staff-access-input').fill(accessCode);
  await page.locator('#staff-access-submit').click();
  await expect(page.locator('#staff-access-overlay')).toBeHidden();
  await expect.poll(() => api.requests.some((request) => ['list-admin', 'get-admin'].includes(request.body.action) && request.headers['x-staff-code'] === accessCode)).toBe(true);
});
