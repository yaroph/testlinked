const { test, expect } = require('@playwright/test');
const { installNetlifyMocks, waitForPointReady } = require('./helpers.cjs');

test('point guest file menu keeps local actions and auth-gated cloud access', async ({ page }) => {
    await installNetlifyMocks(page);

    await page.goto('/point/');
    await waitForPointReady(page);

    await page.click('#btnDataFileToggle');

    await expect(page.locator('#cloud-home-tab-local')).toBeVisible();
    await expect(page.locator('#cloud-home-tab-cloud')).toBeVisible();
    await expect(page.locator('[data-local-toggle="open"]')).toBeVisible();
    await expect(page.locator('[data-local-choices="open"]')).toBeHidden();
    await page.click('[data-local-toggle="open"]');
    await expect(page.locator('[data-local-action="open-file"]')).toBeVisible();
    await expect(page.locator('[data-local-action="open-text"]')).toBeVisible();
    const chooserPromise = page.waitForEvent('filechooser');
    await page.click('[data-local-action="open-file"]');
    const chooser = await chooserPromise;
    expect(chooser).toBeTruthy();

    await page.click('#btnDataFileToggle');

    await page.click('#cloud-home-tab-cloud');

    await expect(page.locator('#cloud-auth-user')).toBeVisible();
    await expect(page.locator('#cloud-auth-pass')).toBeVisible();
});

test('point editor keeps long names visible and uses a square color picker', async ({ page }) => {
    await installNetlifyMocks(page);

    await page.goto('/point/');
    await waitForPointReady(page);

    await page.evaluate(() => {
        const btn = document.getElementById('createPerson');
        if (!btn) throw new Error('createPerson button missing');
        btn.click();
    });
    await expect(page.locator('#edQuickNameInline')).toBeVisible();
    await expect(page.locator('#edQuickNameInline')).toHaveJSProperty('tagName', 'TEXTAREA');

    await page.fill('#edQuickNameInline', 'Morgane Fox');
    await page.click('#edQuickNameInline');
    await page.press('#edQuickNameInline', 'Control+A');
    await page.keyboard.type('Jean');
    await page.keyboard.press('Space');
    await page.keyboard.type('Dupont');
    await expect(page.locator('#edQuickNameInline')).toHaveValue('Jean Dupont');
    await page.fill('#edQuickNum', '75523');

    const shortNameBox = await page.locator('#edQuickNameInline').boundingBox();
    const shortNumBox = await page.locator('#edQuickNum').boundingBox();
    if (!shortNameBox || !shortNumBox) throw new Error('Header fields not available');
    expect(Math.abs(shortNameBox.y - shortNumBox.y)).toBeLessThanOrEqual(4);

    await page.fill('#edQuickNameInline', 'Jean-Baptiste Maximilien de la Tour du Nord - secteur tres long');
    await page.locator('#edQuickNum').focus();
    await expect(page.locator('#edQuickNameInline')).toHaveValue('Jean-Baptiste Maximilien de la Tour du Nord - secteur tres long');

    const nameHeight = await page.locator('#edQuickNameInline').evaluate((el) => el.clientHeight);
    expect(nameHeight).toBeGreaterThan(40);

    const colorBox = await page.locator('#edColorQuick').boundingBox();
    if (!colorBox) throw new Error('Color input not available');
    expect(Math.abs(colorBox.width - colorBox.height)).toBeLessThanOrEqual(6);
});

test('point editor keeps the action rail outside the panel and renames quick search', async ({ page }) => {
    await installNetlifyMocks(page);

    await page.setViewportSize({ width: 1536, height: 864 });
    await page.goto('/point/');
    await waitForPointReady(page);

    await expect(page.locator('#btnQuickSearch')).toHaveText('RECHERCHE');
    await expect(page.locator('#left .section h2').nth(2)).toHaveText('Recherche rapide');

    await page.evaluate(() => {
        const btn = document.getElementById('createPerson');
        if (!btn) throw new Error('createPerson button missing');
        btn.click();
    });

    await expect(page.locator('.editor-side-rail')).toBeVisible();
    await expect(page.locator('.editor-main-card')).toBeVisible();

    const railBox = await page.locator('.editor-side-rail').boundingBox();
    const cardBox = await page.locator('.editor-main-card').boundingBox();
    const focusBox = await page.locator('#btnFocusNode').boundingBox();
    const mergeBox = await page.locator('#btnMergeLaunch').boundingBox();
    if (!railBox || !cardBox) throw new Error('Editor layout boxes unavailable');
    if (!focusBox || !mergeBox) throw new Error('Editor action boxes unavailable');

    expect(railBox.x + railBox.width).toBeLessThan(cardBox.x + 2);
    expect(cardBox.width).toBeLessThanOrEqual(460);
    expect(Math.abs(mergeBox.width - focusBox.width)).toBeLessThanOrEqual(4);
});

test('point editor stays open while panning and closes on a single empty click', async ({ page }) => {
    await installNetlifyMocks(page);

    await page.goto('/point/');
    await waitForPointReady(page);

    await page.evaluate(() => {
        const btn = document.getElementById('createPerson');
        if (!btn) throw new Error('createPerson button missing');
        btn.click();
    });

    await expect(page.locator('#editor')).toBeVisible();

    const graphBox = await page.locator('#graph').boundingBox();
    if (!graphBox) throw new Error('Graph canvas not available');

    const startX = graphBox.x + 24;
    const startY = graphBox.y + 24;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 90, startY + 36, { steps: 8 });
    await page.mouse.up();

    await expect(page.locator('#editor')).toBeVisible();

    await page.mouse.click(startX, startY);
    await expect(page.locator('#editor')).toBeHidden();
});

test('point session summary hides the extra cloud box until a board is opened', async ({ page }) => {
    await page.addInitScript(() => {
        localStorage.setItem('bniLinkedCollabSession_v1', JSON.stringify({
            token: 'session-token',
            user: { username: 'dutch' },
        }));
    });

    await installNetlifyMocks(page, {
        authSession: true,
        authUser: { username: 'dutch' },
        boards: [],
    });

    await page.goto('/point/');
    await waitForPointReady(page);

    await expect(page.locator('#cloudStatus')).toContainText('Session');
    await expect(page.locator('#cloudStatus')).toContainText('dutch');
    await expect(page.locator('#cloudLiveInfo')).toBeHidden();
});

test('point settings presets remain clickable and update the panel state', async ({ page }) => {
    await installNetlifyMocks(page);

    await page.goto('/point/');
    await waitForPointReady(page);

    await page.getByTitle('Ouvrir les parametres et presets de vision reseau').click();
    await expect(page.locator('#settings-panel')).toBeVisible();

    await page.locator('.settings-preset-btn').nth(1).click();

    await expect(page.locator('.settings-preset-btn.active .settings-preset-name')).toContainText('Ennemis tres eloignes');
    await expect(page.locator('#val-repulsion')).toHaveText('1520');
});

test('point owner can open the Gerer board panel', async ({ page }) => {
    await page.addInitScript(() => {
        localStorage.setItem('bniLinkedCollabSession_v1', JSON.stringify({
            token: 'smoke-token',
            user: { username: 'smoke-user' },
        }));
    });

    await installNetlifyMocks(page, {
        authSession: true,
        authUser: { username: 'smoke-user' },
        boards: [{
            id: 'board-owner',
            title: 'Board Owner',
            role: 'owner',
            page: 'point',
            members: [{ userId: 'u-smoke', username: 'smoke-user', role: 'owner' }],
            onlineUsers: ['u-smoke'],
        }],
    });

    await page.goto('/point/');
    await waitForPointReady(page);

    await page.click('#btnDataFileToggle');
    await expect(page.locator('.cloud-manage-board')).toBeVisible();
    await page.click('.cloud-manage-board');

    await expect(page.locator('.cloud-board-manage-head')).toBeVisible();
    await expect(page.locator('.modal-tool-title')).toContainText('Gestion du board');
});
