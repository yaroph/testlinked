const { test, expect } = require('@playwright/test');
const { installNetlifyMocks, waitForPointReady } = require('./helpers.cjs');

async function seedPointGraph(page, nodes, links = [], selectionId = null) {
    await page.evaluate(async ({ nodes, links, selectionId }) => {
        const { state } = await import('/point/js/state.js');
        const { updatePersonColors } = await import('/point/js/logic.js');
        const { refreshLists, selectNode } = await import('/point/js/ui.js');

        state.nodes = nodes;
        state.links = links;
        state.selection = null;
        state.hoverId = null;
        state.focusMode = false;
        state.focusRootId = null;
        state.focusSet.clear();
        state.focusDirectSet.clear();
        state.pathfinding.startId = null;
        state.pathfinding.active = false;
        state.pathfinding.pathNodes = [];
        state.pathfinding.pathLinks = [];
        state.aiPredictedLinks = [];
        state.aiPreviewPair = null;
        updatePersonColors();
        refreshLists();
        if (selectionId) selectNode(selectionId);
    }, { nodes, links, selectionId });
}

async function sampleCanvasPixelAtPairMidpoint(page, aId, bId) {
    return page.evaluate(async ({ aId, bId }) => {
        const { state } = await import('/point/js/state.js');
        const canvas = document.getElementById('graph');
        const ctx = canvas.getContext('2d');
        const a = state.nodes.find((node) => String(node.id) === String(aId));
        const b = state.nodes.find((node) => String(node.id) === String(bId));
        if (!a || !b) throw new Error('Pair nodes missing');

        const midX = (Number(a.x) + Number(b.x)) / 2;
        const midY = (Number(a.y) + Number(b.y)) / 2;
        const cssX = (midX * state.view.scale) + state.view.x + (canvas.clientWidth / 2);
        const cssY = (midY * state.view.scale) + state.view.y + (canvas.clientHeight / 2);
        const dpr = window.devicePixelRatio || 1;
        const pixel = Array.from(ctx.getImageData(Math.round(cssX * dpr), Math.round(cssY * dpr), 1, 1).data);

        return {
            pixel,
            preview: state.aiPreviewPair,
            point: { x: cssX, y: cssY }
        };
    }, { aId, bId });
}

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

test('point cloud profile editor updates the account username and password', async ({ page }) => {
    await page.addInitScript(() => {
        localStorage.setItem('bniLinkedCollabSession_v1', JSON.stringify({
            token: 'smoke-token',
            user: { id: 'u-smoke', username: 'smoke-user' },
        }));
    });

    const api = await installNetlifyMocks(page, {
        authSession: true,
        authUser: { id: 'u-smoke', username: 'smoke-user' },
        authPassword: 'secret123',
        boards: [{
            id: 'board-point-owner',
            title: 'Point Owner',
            role: 'owner',
            page: 'point',
            members: [{ userId: 'u-smoke', username: 'smoke-user', role: 'owner' }],
        }],
    });

    await page.goto('/point/');
    await waitForPointReady(page);

    await page.click('#btnDataFileToggle');
    await page.click('#cloud-open-profile');

    await expect(page.locator('#cloud-profile-username')).toBeVisible();
    await page.fill('#cloud-profile-username', 'smoke-user-2');
    await page.fill('#cloud-profile-current-pass', 'secret123');
    await page.fill('#cloud-profile-next-pass', 'secret456');
    await page.click('#cloud-profile-save');

    await expect(page.locator('.cloud-profile-current-value')).toContainText('smoke-user-2');
    await expect(page.locator('.cloud-profile-feedback')).toContainText('Profil mis a jour');

    await page.click('#cloud-profile-back');
    await expect(page.locator('.cloud-home-title')).toContainText('smoke-user-2');

    await expect.poll(() => {
        const lastRequest = [...api.requests]
            .reverse()
            .find((entry) => entry.endpoint === 'collab-auth' && entry.action === 'update_profile');
        return lastRequest?.payload || null;
    }).toMatchObject({
        currentPassword: 'secret123',
        nextUsername: 'smoke-user-2',
        nextPassword: 'secret456',
    });
});

test('point ai link panel stays compact on ultra-wide screens', async ({ page }) => {
    await installNetlifyMocks(page);

    await page.setViewportSize({ width: 2560, height: 1440 });
    await page.goto('/point/');
    await waitForPointReady(page);

    await seedPointGraph(page, [
        {
            id: 'pf-a',
            name: 'Weazel News',
            type: 'company',
            color: '#73fbf7',
            manualColor: false,
            personStatus: 'active',
            num: '',
            accountNumber: '',
            citizenNumber: '',
            linkedMapPointId: '',
            description: '',
            notes: '',
            x: -120,
            y: 0,
            fixed: true
        },
        {
            id: 'pf-b',
            name: 'Nadio Ricci',
            type: 'person',
            color: '#ffffff',
            manualColor: false,
            personStatus: 'active',
            num: '',
            accountNumber: '',
            citizenNumber: '',
            linkedMapPointId: '',
            description: '',
            notes: '',
            x: 120,
            y: 0,
            fixed: true
        }
    ], [
        {
            id: 'pf-link',
            source: 'pf-a',
            target: 'pf-b',
            kind: 'relation'
        }
    ], 'pf-a');

    await expect(page.locator('#btnPathStart')).toBeVisible();
    await page.click('#btnPathStart');

    await page.evaluate(async () => {
        const { selectNode } = await import('/point/js/ui.js');
        selectNode('pf-b');
    });

    await expect(page.locator('#btnPathCalc')).toBeVisible();
    await page.click('#btnPathCalc');
    await expect(page.locator('.pf-status-active')).toContainText(/Liaison active/i);

    const cardBox = await page.locator('.pf-card').boundingBox();
    if (!cardBox) throw new Error('AI link card unavailable');
    expect(cardBox.height).toBeLessThanOrEqual(190);
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

test('point editor docks to the top right slot on ultra-wide screens', async ({ page }) => {
    await installNetlifyMocks(page);

    await page.setViewportSize({ width: 2560, height: 1440 });
    await page.goto('/point/');
    await waitForPointReady(page);

    await page.evaluate(() => {
        const btn = document.getElementById('createPerson');
        if (!btn) throw new Error('createPerson button missing');
        btn.click();
    });

    await expect(page.locator('#editor')).toBeVisible();
    await page.waitForTimeout(120);

    const rightBox = await page.locator('#right').boundingBox();
    const editorBox = await page.locator('#editor').boundingBox();
    if (!rightBox || !editorBox) throw new Error('Editor box unavailable');
    const reservedRightGap = await page.evaluate(() => {
        const value = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--editor-side-clearance'));
        return Number.isFinite(value) ? value : 0;
    });
    const actualRightGap = (rightBox.x + rightBox.width) - (editorBox.x + editorBox.width);
    const topGap = editorBox.y - rightBox.y;

    expect(actualRightGap).toBeGreaterThanOrEqual(Math.max(120, reservedRightGap - 30));
    expect(actualRightGap).toBeLessThanOrEqual(reservedRightGap + 60);
    expect(topGap).toBeLessThanOrEqual(50);
    expect(editorBox.height).toBeLessThanOrEqual(920);
});

test('point empty cloud board keeps freshly linked nodes inside the viewport', async ({ page }) => {
    await page.addInitScript(() => {
        localStorage.setItem('bniLinkedCollabSession_v1', JSON.stringify({
            token: 'smoke-token',
            user: { id: 'u-smoke', username: 'smoke-user' },
        }));
        localStorage.setItem('pointPageState_v13', JSON.stringify({
            nodes: [],
            links: [],
            view: { x: 180000, y: -140000, scale: 0.8 },
            physicsSettings: {},
            nextId: 1,
        }));
    });

    await installNetlifyMocks(page, {
        authSession: true,
        authUser: { id: 'u-smoke', username: 'smoke-user' },
        boards: [{
            id: 'board-empty-cloud',
            title: 'Board Empty',
            role: 'owner',
            page: 'point',
            members: [{ userId: 'u-smoke', username: 'smoke-user', role: 'owner' }],
            data: { meta: {}, physicsSettings: {}, nodes: [], links: [] },
            presence: [],
        }],
    });

    await page.goto('/point/?board=board-empty-cloud');
    await waitForPointReady(page);
    await page.waitForTimeout(250);

    await page.click('#btnQuickCreate');
    await page.fill('#quick-link-source', 'Alpha Spawn');
    await page.fill('#quick-link-target', 'Bravo Spawn');
    await page.click('#quick-link-apply');
    await page.waitForTimeout(700);

    const snapshot = await page.evaluate(() => {
        const raw = localStorage.getItem('pointPageState_v13');
        const data = raw ? JSON.parse(raw) : null;
        const canvas = document.getElementById('graph');
        const width = Number(canvas?.clientWidth || canvas?.width || 0);
        const height = Number(canvas?.clientHeight || canvas?.height || 0);
        return {
            width,
            height,
            nodes: Array.isArray(data?.nodes) ? data.nodes.map((node) => ({
                name: String(node?.name || ''),
                screenX: (Number(node?.x || 0) * Number(data?.view?.scale || 1)) + Number(data?.view?.x || 0) + (width / 2),
                screenY: (Number(node?.y || 0) * Number(data?.view?.scale || 1)) + Number(data?.view?.y || 0) + (height / 2),
            })) : [],
        };
    });

    const alpha = snapshot.nodes.find((node) => node.name === 'Alpha Spawn');
    const bravo = snapshot.nodes.find((node) => node.name === 'Bravo Spawn');
    expect(alpha).toBeTruthy();
    expect(bravo).toBeTruthy();
    expect(alpha.screenX).toBeGreaterThan(40);
    expect(alpha.screenX).toBeLessThan(snapshot.width - 40);
    expect(alpha.screenY).toBeGreaterThan(40);
    expect(alpha.screenY).toBeLessThan(snapshot.height - 40);
    expect(bravo.screenX).toBeGreaterThan(40);
    expect(bravo.screenX).toBeLessThan(snapshot.width - 40);
    expect(bravo.screenY).toBeGreaterThan(40);
    expect(bravo.screenY).toBeLessThan(snapshot.height - 40);
});

test('point file merge keeps person and company separate when they only share a phone number', async ({ page }) => {
    await installNetlifyMocks(page);

    await page.goto('/point/');
    await waitForPointReady(page);

    const payload = {
        nodes: [
            {
                id: 'person-1',
                name: 'Aaron Ashford',
                type: 'person',
                color: '#ffffff',
                manualColor: false,
                personStatus: 'active',
                num: '55511646',
                accountNumber: '',
                citizenNumber: '',
                linkedMapPointId: '',
                description: '',
                notes: '',
                x: -80,
                y: 0,
                fixed: true
            },
            {
                id: 'company-1',
                name: 'Luchetti\'s',
                type: 'company',
                color: '#73fbf7',
                manualColor: true,
                personStatus: 'active',
                num: '55511646',
                accountNumber: '',
                citizenNumber: '',
                linkedMapPointId: '',
                description: '',
                notes: '',
                x: 80,
                y: 0,
                fixed: true
            }
        ],
        links: []
    };

    await page.setInputFiles('#fileMerge', {
        name: 'merge-phone.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(payload), 'utf8')
    });

    await page.waitForFunction(async () => {
        const { state } = await import('/point/js/state.js');
        return state.nodes.length === 2;
    });

    const nodeSummary = await page.evaluate(async () => {
        const { state } = await import('/point/js/state.js');
        return state.nodes.map((node) => ({ id: node.id, name: node.name, type: node.type }));
    });

    expect(nodeSummary).toHaveLength(2);
    expect(nodeSummary.find((node) => node.type === 'person')?.name).toBe('Aaron Ashford');
    expect(nodeSummary.find((node) => node.type === 'company')?.name).toBe("Luchetti's");
});

test('point intel suggests merges and previewing them lights up the pair on the canvas', async ({ page }) => {
    await installNetlifyMocks(page);

    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto('/point/');
    await waitForPointReady(page);

    await seedPointGraph(page, [
        {
            id: 'p-short',
            name: 'D. Kralj',
            type: 'person',
            color: '#ffffff',
            manualColor: false,
            personStatus: 'active',
            num: '55544123',
            accountNumber: '',
            citizenNumber: '',
            linkedMapPointId: '',
            description: 'detective terrain',
            notes: 'liaison lspd',
            x: -140,
            y: 0,
            fixed: true
        },
        {
            id: 'p-full',
            name: 'Dragic Kralj',
            type: 'person',
            color: '#ffffff',
            manualColor: false,
            personStatus: 'active',
            num: '55544123',
            accountNumber: '',
            citizenNumber: '',
            linkedMapPointId: '',
            description: 'detective terrain',
            notes: 'liaison lspd',
            x: 140,
            y: 0,
            fixed: true
        },
        {
            id: 'org-lspd',
            name: 'LSPD',
            type: 'company',
            color: '#73fbf7',
            manualColor: true,
            personStatus: 'active',
            num: '',
            accountNumber: '',
            citizenNumber: '',
            linkedMapPointId: '',
            description: '',
            notes: '',
            x: -320,
            y: -70,
            fixed: true
        }
    ], [], 'p-short');

    await page.click('#btnQuickIntel');
    await page.click('[data-ai-open="intel-global"]');
    await expect(page.locator('#intel-panel')).toBeVisible();

    await page.click('#intelRun');
    const mergeRow = page.locator('.intel-item', { hasText: 'Fusionner' }).first();
    await expect(mergeRow).toBeVisible();
    await expect(mergeRow).toContainText('D. Kralj');
    await expect(mergeRow).toContainText('Dragic Kralj');
    await expect(mergeRow).toContainText('Cible: Dragic Kralj');

    await mergeRow.getByRole('button', { name: 'Voir' }).click();
    await expect(mergeRow).toHaveClass(/is-previewing/);

    const after = await sampleCanvasPixelAtPairMidpoint(page, 'p-short', 'p-full');

    expect(after.preview).toBeTruthy();
    expect(after.preview.actionType).toBe('merge');
    expect(after.pixel[1]).toBeGreaterThan(160);
    expect(after.pixel[2]).toBeGreaterThan(180);
    expect(after.pixel[3]).toBeGreaterThan(120);
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

    await expect(page.locator('#cloudStatus')).toContainText('Local');
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

test('point board manager ne propose plus owner dans le partage', async ({ page }) => {
    await page.addInitScript(() => {
        localStorage.setItem('bniLinkedCollabSession_v1', JSON.stringify({
            token: 'smoke-token',
            user: { id: 'u-smoke', username: 'smoke-user' },
        }));
    });

    await installNetlifyMocks(page, {
        authSession: true,
        authUser: { id: 'u-smoke', username: 'smoke-user' },
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
    await page.click('.cloud-manage-board');
    await expect(page.locator('#cloud-share-role')).toBeVisible();
    await expect(page.locator('#cloud-share-role option[value="owner"]')).toHaveCount(0);
});

test('point file modal only lists point boards', async ({ page }) => {
    await page.addInitScript(() => {
        localStorage.setItem('bniLinkedCollabSession_v1', JSON.stringify({
            token: 'smoke-token',
            user: { id: 'u-smoke', username: 'smoke-user' },
        }));
    });

    const api = await installNetlifyMocks(page, {
        authSession: true,
        authUser: { id: 'u-smoke', username: 'smoke-user' },
        boards: [
            {
                id: 'board-point-only',
                title: 'Point Board',
                role: 'editor',
                page: 'point',
            },
            {
                id: 'board-map-hidden',
                title: 'Map Board',
                role: 'editor',
                page: 'map',
            }
        ],
    });

    await page.goto('/point/');
    await waitForPointReady(page);

    await page.click('#btnDataFileToggle');
    await expect(page.locator('.cloud-board-row')).toHaveCount(1);
    await expect(page.locator('.cloud-board-row')).toContainText('Point Board');

    await expect.poll(() => {
        const lastRequest = [...api.requests]
            .reverse()
            .find((entry) => entry.endpoint === 'collab-board' && entry.action === 'list_boards');
        return lastRequest?.payload?.page || '';
    }).toBe('point');
});

test('point board manager suggests cloud usernames while sharing', async ({ page }) => {
    await page.addInitScript(() => {
        localStorage.setItem('bniLinkedCollabSession_v1', JSON.stringify({
            token: 'smoke-token',
            user: { id: 'u-smoke', username: 'smoke-user' },
        }));
    });

    await installNetlifyMocks(page, {
        authSession: true,
        authUser: { id: 'u-smoke', username: 'smoke-user' },
        collabUsers: [
            { userId: 'u-smoke', username: 'smoke-user' },
            { userId: 'u-alpha', username: 'alpha.team' },
            { userId: 'u-alfred', username: 'alfred.ops' },
        ],
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
    await page.click('.cloud-manage-board');
    await expect(page.locator('.cloud-board-manage-head')).toBeVisible();

    await page.fill('#cloud-share-username', 'alf');
    await expect(page.locator('#cloud-share-username-results')).toBeVisible();
    await expect(page.locator('#cloud-share-username-results .editor-autocomplete-hit').first()).toContainText('alfred.ops');
});
