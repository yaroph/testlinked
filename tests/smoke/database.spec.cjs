const { test, expect } = require('@playwright/test');

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function jsonResponse(route, status, payload) {
    return route.fulfill({
        status,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify(payload),
    });
}

function createArchiveEntry(page, index, action = 'export-standard', summary = null) {
    const suffix = String(index).padStart(3, '0');
    return {
        key: `${page}/archive-${suffix}.json`,
        page,
        action,
        ts: `${page}-${suffix}`,
        createdAt: new Date(Date.UTC(2026, 2, index, 10, 0, 0)).toISOString(),
        ...(summary ? { summary: clone(summary) } : {}),
    };
}

function createBoardEntry(index, options = {}) {
    const id = `board-${index}`;
    const title = String(options.title || `Board ${index}`);
    const page = String(options.page || 'point');
    const ownerName = String(options.ownerName || `owner-${index}`);
    const updatedAt = new Date(Date.UTC(2026, 2, index, 14, 30, 0)).toISOString();
    const activity = Array.isArray(options.activity) ? clone(options.activity) : [];
    const members = Array.isArray(options.members)
        ? clone(options.members)
        : [
            { userId: `u-${index}-owner`, username: ownerName, role: 'owner' },
            { userId: `u-${index}-editor`, username: `editor-${index}`, role: 'editor' },
        ];

    return {
        id,
        title,
        page,
        ownerId: members[0]?.userId || '',
        ownerName,
        createdAt: updatedAt,
        updatedAt,
        memberCount: members.length,
        memberNames: members.map((member) => member.username),
        members,
        content: page === 'map'
            ? { page, statLines: ['3 groupes', '8 points', '2 zones', '1 liaisons'] }
            : { page, statLines: ['12 fiches', '9 liens'] },
        editLock: options.lockedBy
            ? {
                boardId: id,
                userId: `lock-${index}`,
                username: String(options.lockedBy),
                expiresAt: new Date(Date.UTC(2026, 2, index, 14, 31, 0)).toISOString(),
            }
            : null,
        searchText: `${title} ${ownerName} ${members.map((member) => member.username).join(' ')}`,
        activityCount: activity.length || Number(options.activityCount || 0),
        activity,
    };
}

async function installDatabaseMocks(page, options = {}) {
    const requests = [];
    const listFailuresByTab = Object.fromEntries(
        Object.entries(options.listFailuresByTab || {}).map(([tabName, failures]) => {
            const nextFailures = Array.isArray(failures) ? failures : [failures];
            return [tabName, nextFailures.map((entry) => String(entry || 'error'))];
        })
    );
    const store = {
        point: Array.isArray(options.pointEntries) ? clone(options.pointEntries) : [],
        map: Array.isArray(options.mapEntries) ? clone(options.mapEntries) : [],
        boards: Array.isArray(options.boardEntries) ? clone(options.boardEntries) : [],
    };
    const payloads = new Map(
        Object.entries(options.payloads || {}).map(([key, value]) => [String(key), clone(value)])
    );

    await page.route('**/.netlify/functions/**', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        const pathname = url.pathname;

        if (pathname.endsWith('/db-list')) {
            const pageName = String(url.searchParams.get('page') || 'point');
            const offset = Math.max(0, Number(url.searchParams.get('offset') || 0));
            const limit = Math.max(0, Number(url.searchParams.get('limit') || 0));
            requests.push({ endpoint: 'db-list', page: pageName, offset, limit });

            const failures = listFailuresByTab[pageName];
            if (Array.isArray(failures) && failures.length) {
                const errorCode = failures.shift();
                const status = errorCode === 'not_found' ? 404 : 500;
                return jsonResponse(route, status, {
                    ok: false,
                    error: errorCode,
                });
            }

            const entries = Array.isArray(store[pageName]) ? store[pageName] : [];
            const slice = entries.slice(offset, offset + limit);
            const nextOffset = offset + slice.length;
            return jsonResponse(route, 200, {
                ok: true,
                entries: clone(slice),
                totalFound: entries.length,
                hasMore: nextOffset < entries.length,
                nextOffset,
            });
        }

        if (pathname.endsWith('/db-boards')) {
            if (request.method() === 'POST') {
                let body = {};
                try {
                    body = JSON.parse(request.postData() || '{}');
                } catch (error) {
                    body = {};
                }

                const action = String(body.action || '');
                const boardId = String(body.boardId || '');
                requests.push({ endpoint: 'db-boards', method: 'POST', action, boardId });

                if (action === 'clear_activity') {
                    const board = store.boards.find((entry) => String(entry?.id || '') === boardId);
                    if (!board) {
                        return jsonResponse(route, 404, {
                            ok: false,
                            error: 'Board introuvable',
                        });
                    }
                    board.activity = [];
                    board.activityCount = 0;
                    return jsonResponse(route, 200, {
                        ok: true,
                        board: clone(board),
                    });
                }

                return jsonResponse(route, 400, {
                    ok: false,
                    error: 'Action inconnue',
                });
            }

            const offset = Math.max(0, Number(url.searchParams.get('offset') || 0));
            const limit = Math.max(0, Number(url.searchParams.get('limit') || 0));
            requests.push({ endpoint: 'db-boards', method: 'GET', offset, limit });

            const failures = listFailuresByTab.boards;
            if (Array.isArray(failures) && failures.length) {
                const errorCode = failures.shift();
                const status = errorCode === 'not_found' ? 404 : 500;
                return jsonResponse(route, status, {
                    ok: false,
                    error: errorCode,
                });
            }

            const entries = Array.isArray(store.boards) ? store.boards : [];
            const slice = entries.slice(offset, offset + limit);
            const nextOffset = offset + slice.length;
            return jsonResponse(route, 200, {
                ok: true,
                entries: clone(slice),
                totalFound: entries.length,
                hasMore: nextOffset < entries.length,
                nextOffset,
            });
        }

        if (pathname.endsWith('/db-get')) {
            const key = String(url.searchParams.get('key') || '');
            requests.push({ endpoint: 'db-get', key });
            return jsonResponse(route, 200, payloads.get(key) || { ok: true, key, nodes: [] });
        }

        if (pathname.endsWith('/db-delete')) {
            let body = {};
            try {
                body = JSON.parse(request.postData() || '{}');
            } catch (error) {
                body = {};
            }

            const key = String(body.key || '');
            requests.push({ endpoint: 'db-delete', key });

            for (const pageName of ['point', 'map']) {
                store[pageName] = store[pageName].filter((entry) => String(entry?.key || '') !== key);
            }

            return jsonResponse(route, 200, { ok: true });
        }

        return jsonResponse(route, 404, {
            ok: false,
            error: `Unhandled endpoint: ${pathname}`,
        });
    });

    return { requests, store };
}

test('database loads point archives by default, paginates, switches tabs, and loads boards', async ({ page }) => {
    const pointEntries = Array.from({ length: 55 }, (_, index) =>
        createArchiveEntry('point', index + 1, `export-point-${String(index + 1).padStart(3, '0')}`)
    );
    const mapEntries = [
        createArchiveEntry('map', 1, 'import-sitrep'),
        createArchiveEntry('map', 2, 'export-zones'),
    ];
    const boardEntries = [
        createBoardEntry(1, { title: 'Alpha Cloud', ownerName: 'atlas', lockedBy: 'atlas' }),
        createBoardEntry(2, { title: 'Bravo Cloud', page: 'map', ownerName: 'bravo' }),
    ];
    const api = await installDatabaseMocks(page, { pointEntries, mapEntries, boardEntries });

    await page.goto('/database/');

    await expect(page.locator('#panel-point')).toHaveClass(/active/);
    await expect(page.locator('#cards-point .data-card')).toHaveCount(50);
    await expect(page.locator('#status-point')).toContainText(/50 visibles/i);
    await expect(page.locator('#load-more-point')).toBeVisible();

    await page.click('#load-more-point');

    await expect(page.locator('#cards-point .data-card')).toHaveCount(55);
    await expect(page.locator('#status-point')).toContainText(/55 visibles/i);
    await expect(page.locator('#load-more-point')).toBeHidden();

    await page.click('[data-tab="map"]');

    await expect(page.locator('#panel-map')).toHaveClass(/active/);
    await expect(page.locator('#cards-map .data-card')).toHaveCount(2);
    await expect(page.locator('#cards-map')).toContainText(/sitrep/i);
    await expect(page.locator('#global-status')).toContainText('MAP');

    await page.click('[data-tab="boards"]');

    await expect(page.locator('#panel-boards')).toHaveClass(/active/);
    await expect(page.locator('#cards-boards .data-card')).toHaveCount(2);
    await expect(page.locator('#cards-boards')).toContainText('Alpha Cloud');
    await expect(page.locator('#cards-boards')).toContainText('atlas');

    expect(api.requests.filter((entry) => entry.endpoint === 'db-list' && entry.page === 'point')).toHaveLength(2);
    expect(api.requests.filter((entry) => entry.endpoint === 'db-list' && entry.page === 'map')).toHaveLength(1);
    expect(api.requests.filter((entry) => entry.endpoint === 'db-boards')).toHaveLength(1);
});

test('database shows the board activity log in board details', async ({ page }) => {
    const boardEntries = [
        createBoardEntry(1, {
            title: 'Alpha Cloud',
            ownerName: 'eric',
            activity: [
                {
                    id: 'act-1',
                    at: new Date(Date.UTC(2026, 2, 1, 14, 35, 0)).toISOString(),
                    actorId: 'u-eric',
                    actorName: 'eric',
                    type: 'field',
                    text: 'a modifie la description de Alicia',
                    details: {
                        label: 'Description',
                        before: 'Ancienne description',
                        after: 'Nouvelle description',
                    },
                },
                {
                    id: 'act-2',
                    at: new Date(Date.UTC(2026, 2, 1, 14, 34, 0)).toISOString(),
                    actorId: 'u-eric',
                    actorName: 'eric',
                    type: 'link',
                    text: 'a ajoute une relation entre Alicia et Bob',
                },
            ],
        }),
    ];

    await installDatabaseMocks(page, { boardEntries });

    await page.goto('/database/');
    await page.click('[data-tab="boards"]');
    await page.click('#cards-boards [data-board-action="detail"]');

    await expect(page.locator('#custom-modal')).toBeVisible();
    const modalWidth = await page.locator('#custom-modal .modal-box').evaluate((element) => element.getBoundingClientRect().width);
    expect(modalWidth).toBeGreaterThan(900);
    await expect(page.locator('#custom-modal')).toContainText('Journal');
    await expect(page.locator('#custom-modal')).toContainText('eric');
    await expect(page.locator('#custom-modal')).toContainText('a modifie la description de Alicia');
    await expect(page.locator('#custom-modal')).toContainText('a ajoute une relation entre Alicia et Bob');
    const detailToggle = page.locator('#custom-modal .activity-row-details summary').first();
    await expect(detailToggle).toContainText('Voir avant / apres');
    await detailToggle.click();
    const openedDetails = page.locator('#custom-modal .activity-row-details[open]').first();
    await expect(openedDetails).toBeVisible();
    await expect(openedDetails).toContainText('Ancienne description');
    await expect(openedDetails).toContainText('Nouvelle description');
});

test('database can clear a board activity log after confirmation', async ({ page }) => {
    const boardEntries = [
        createBoardEntry(1, {
            title: 'Alpha Cloud',
            ownerName: 'eric',
            activity: [
                {
                    id: 'act-1',
                    at: new Date(Date.UTC(2026, 2, 1, 14, 35, 0)).toISOString(),
                    actorId: 'u-eric',
                    actorName: 'eric',
                    type: 'field',
                    text: 'a modifie la description de Alicia',
                },
            ],
        }),
    ];

    const api = await installDatabaseMocks(page, { boardEntries });

    await page.goto('/database/');
    await page.click('[data-tab="boards"]');
    await page.click('#cards-boards [data-board-action="detail"]');

    await expect(page.locator('#custom-modal')).toBeVisible();
    await page.click('#modal-footer .modal-btn.danger');
    await expect(page.locator('#custom-modal')).toContainText('Etes-vous sur ?');
    await page.click('#modal-footer .modal-btn.danger');

    await expect.poll(() =>
        api.requests.filter((entry) =>
            entry.endpoint === 'db-boards' &&
            entry.method === 'POST' &&
            entry.action === 'clear_activity'
        ).length
    ).toBe(1);
    await expect.poll(() => api.store.boards[0].activity.length).toBe(0);
    await expect(page.locator('#custom-modal')).toContainText('Aucune activite detaillee pour ce board.');
    await expect(page.locator('#modal-footer .modal-btn.danger')).toBeDisabled();
});

test('database exposes retry state when archive service is unavailable', async ({ page }) => {
    await installDatabaseMocks(page, {
        pointEntries: [createArchiveEntry('point', 1, 'export-alpha')],
        listFailuresByTab: { point: ['not_found'] },
    });

    await page.goto('/database/');

    await expect(page.locator('#status-point')).toContainText('SOURCE ARCHIVES RESEAU INDISPONIBLE');
    await expect(page.locator('#cards-point')).toContainText('REESSAYER');

    await page.click('[data-retry-tab="point"]');

    await expect(page.locator('#cards-point .data-card')).toHaveCount(1);
    await expect(page.locator('#cards-point')).toContainText(/alpha/i);
    await expect(page.locator('#status-point')).toContainText(/1 visibles/i);
});

test('database can delete an archive and refresh the point list', async ({ page }) => {
    const pointEntries = [createArchiveEntry('point', 1, 'export-archive-a-supprimer')];
    const api = await installDatabaseMocks(page, { pointEntries });

    await page.goto('/database/');

    await expect(page.locator('#cards-point .data-card')).toHaveCount(1);

    await page.click('#cards-point .btn-del');
    await expect(page.locator('#custom-modal')).toBeVisible();
    await page.click('#modal-footer .modal-btn.danger');

    await expect.poll(() => api.requests.filter((entry) => entry.endpoint === 'db-delete').length).toBe(1);
    await expect.poll(() => api.store.point.length).toBe(0);
    await expect(page.locator('#cards-point')).toContainText(/AUCUNE ARCHIVE TROUV/i);
    await expect(page.locator('#status-point')).toContainText(/Aucune donn/i);
});

test('database filters archives and boards from the toolbar', async ({ page }) => {
    const pointEntries = [
        createArchiveEntry('point', 1, 'export-alpha'),
        createArchiveEntry('point', 2, 'import-bravo'),
    ];
    const boardEntries = [
        createBoardEntry(1, { title: 'Alpha Network', ownerName: 'alpha-owner' }),
        createBoardEntry(2, { title: 'Bravo Network', ownerName: 'bravo-owner' }),
    ];
    await installDatabaseMocks(page, { pointEntries, boardEntries });

    await page.goto('/database/');

    await expect(page.locator('#cards-point .data-card')).toHaveCount(2);

    await page.selectOption('#toolbar-action-filter', 'import');
    await expect(page.locator('#cards-point .data-card')).toHaveCount(1);
    await expect(page.locator('#cards-point')).toContainText(/bravo/i);

    await page.click('[data-tab="boards"]');
    await expect(page.locator('#cards-boards .data-card')).toHaveCount(2);

    await page.fill('#toolbar-search', 'alpha');
    await expect(page.locator('#cards-boards .data-card')).toHaveCount(1);
    await expect(page.locator('#cards-boards')).toContainText('Alpha Network');
});
