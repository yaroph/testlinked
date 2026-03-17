const { test, expect } = require('@playwright/test');
const { drawCircleInViewport, installNetlifyMocks, waitForMapReady } = require('./helpers.cjs');

test('map can create a point from GPS input and select it', async ({ page }) => {
    await installNetlifyMocks(page);

    await page.goto('/map/');
    await waitForMapReady(page);

    await page.click('#btnAddGroup');
    await page.click('#btnToggleGpsPanel');
    await page.fill('#gpsInputX', '0');
    await page.fill('#gpsInputY', '0');
    await page.fill('#gpsName', 'Smoke Point');
    await page.click('#btnAddGpsPoint');

    await expect(page.locator('#edName')).toHaveValue('Smoke Point');
});

test('map keeps a single interaction controller for draw mode and exposes the mode hud', async ({ page }) => {
    await installNetlifyMocks(page);

    await page.goto('/map/');
    await waitForMapReady(page);

    await page.click('#btnAddGroup');

    const viewport = page.locator('#viewport');
    const box = await viewport.boundingBox();
    if (!box) throw new Error('Viewport not available');

    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.45, { button: 'right' });
    await expect(page.locator('#context-menu')).toBeVisible();
    await page.click('#ctx-new-zone');

    await expect(page.locator('#map-interaction-mode')).toBeVisible();
    await expect(page.locator('#mapInteractionModeLabel')).toHaveText('Mode cercle');

    await drawCircleInViewport(page, '#viewport', {
        startXRatio: 0.52,
        startYRatio: 0.44,
        endXRatio: 0.68,
        endYRatio: 0.58,
    });

    await expect(page.locator('#ezName')).toHaveValue(/Zone 1/);
    await expect(page.locator('#map-interaction-mode')).toBeHidden();
});

test('map legacy cloud fallback keeps presence alive without user interaction', async ({ page }) => {
    await page.addInitScript(() => {
        localStorage.setItem('bniLinkedCollabSession_v1', JSON.stringify({
            token: 'smoke-token',
            user: { id: 'u-smoke', username: 'smoke-user' },
        }));
    });

    const api = await installNetlifyMocks(page, {
        authSession: true,
        authUser: { id: 'u-smoke', username: 'smoke-user' },
        boards: [{
            id: 'board-map-legacy',
            title: 'Legacy Map',
            role: 'editor',
            page: 'map',
            updatedAt: new Date().toISOString(),
            data: {
                groups: [{
                    id: 'grp-a',
                    name: 'Allies',
                    color: '#73fbf7',
                    visible: true,
                    points: [],
                    zones: [],
                }],
                tacticalLinks: [],
            },
            presence: [],
        }],
    });

    await page.goto('/map/?board=board-map-legacy');
    await waitForMapReady(page);

    await expect.poll(() =>
        api.requests.filter((entry) => entry.endpoint === 'collab-board' && entry.action === 'touch_presence').length
    ).toBeGreaterThanOrEqual(1);

    await expect.poll(() =>
        api.requests.filter((entry) => entry.endpoint === 'collab-board' && entry.action === 'touch_presence').length,
        { timeout: 14000 }
    ).toBeGreaterThanOrEqual(2);
});

test('map local tab does not relaunch board listing', async ({ page }) => {
    await page.addInitScript(() => {
        localStorage.setItem('bniLinkedCollabSession_v1', JSON.stringify({
            token: 'smoke-token',
            user: { id: 'u-smoke', username: 'smoke-user' },
        }));
    });

    const api = await installNetlifyMocks(page, {
        authSession: true,
        authUser: { id: 'u-smoke', username: 'smoke-user' },
        latencyByAction: { list_boards: 1400 },
        boards: [{
            id: 'board-map-owner',
            title: 'Map Owner',
            role: 'owner',
            page: 'map',
            updatedAt: new Date().toISOString(),
            data: {
                groups: [],
                tacticalLinks: [],
            },
            members: [{ userId: 'u-smoke', username: 'smoke-user', role: 'owner' }],
        }],
    });

    await page.goto('/map/');
    await waitForMapReady(page);

    await page.click('#btnDataFileToggle');
    await page.click('[data-action="cloud"]');
    await expect(page.locator('.cloud-open-board')).toBeVisible();

    const listBefore = api.requests.filter((entry) => entry.endpoint === 'collab-board' && entry.action === 'list_boards').length;

    await page.click('#cloud-home-tab-local');
    await expect(page.locator('[data-local-action="save-file"]')).toBeVisible({ timeout: 700 });

    const listAfter = api.requests.filter((entry) => entry.endpoint === 'collab-board' && entry.action === 'list_boards').length;
    expect(listAfter).toBe(listBefore);
});
