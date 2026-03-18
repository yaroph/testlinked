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

function createArchiveEntry(page, index, action = 'export-standard') {
    const suffix = String(index).padStart(3, '0');
    return {
        key: `${page}/archive-${suffix}.json`,
        page,
        action,
        ts: `${page}-${suffix}`,
        createdAt: new Date(Date.UTC(2026, 2, index, 10, 0, 0)).toISOString(),
    };
}

async function installDatabaseMocks(page, options = {}) {
    const requests = [];
    const listFailuresByPage = Object.fromEntries(
        Object.entries(options.listFailuresByPage || {}).map(([pageName, failures]) => {
            const nextFailures = Array.isArray(failures) ? failures : [failures];
            return [pageName, nextFailures.map((entry) => String(entry || 'error'))];
        })
    );
    const store = {
        point: Array.isArray(options.pointEntries) ? clone(options.pointEntries) : [],
        map: Array.isArray(options.mapEntries) ? clone(options.mapEntries) : [],
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

            const failures = listFailuresByPage[pageName];
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

            for (const pageName of Object.keys(store)) {
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

test('database loads point archives by default, paginates, and switches to map archives', async ({ page }) => {
    const pointEntries = Array.from({ length: 55 }, (_, index) =>
        createArchiveEntry('point', index + 1, `export-point-${String(index + 1).padStart(3, '0')}`)
    );
    const mapEntries = [
        createArchiveEntry('map', 1, 'import-sitrep'),
        createArchiveEntry('map', 2, 'export-zones'),
    ];
    const api = await installDatabaseMocks(page, { pointEntries, mapEntries });

    await page.goto('/database/');

    await expect(page.locator('#panel-point')).toHaveClass(/active/);
    await expect(page.locator('#cards-point .data-card')).toHaveCount(50);
    await expect(page.locator('#status-point')).toContainText('50');
    await expect(page.locator('#status-point')).toContainText('55');
    await expect(page.locator('#load-more-point')).toBeVisible();

    await page.click('#load-more-point');

    await expect(page.locator('#cards-point .data-card')).toHaveCount(55);
    await expect(page.locator('#status-point')).toContainText('55 FICHIERS');
    await expect(page.locator('#load-more-point')).toBeHidden();

    await page.click('[data-tab="map"]');

    await expect(page.locator('#panel-map')).toHaveClass(/active/);
    await expect(page.locator('#cards-map .data-card')).toHaveCount(2);
    await expect(page.locator('#cards-map')).toContainText('SITREP');
    await expect(page.locator('#global-status')).toContainText('MAP');

    expect(api.requests.filter((entry) => entry.endpoint === 'db-list' && entry.page === 'point')).toHaveLength(2);
    expect(api.requests.filter((entry) => entry.endpoint === 'db-list' && entry.page === 'map')).toHaveLength(1);
});

test('database exposes retry state when archive service is unavailable', async ({ page }) => {
    await installDatabaseMocks(page, {
        pointEntries: [createArchiveEntry('point', 1, 'export-alpha')],
        listFailuresByPage: { point: ['not_found'] },
    });

    await page.goto('/database/');

    await expect(page.locator('#status-point')).toContainText('SOURCE ARCHIVES RESEAU INDISPONIBLE');
    await expect(page.locator('#cards-point')).toContainText('REESSAYER');

    await page.click('[data-retry-page="point"]');

    await expect(page.locator('#cards-point .data-card')).toHaveCount(1);
    await expect(page.locator('#cards-point')).toContainText('ALPHA');
    await expect(page.locator('#status-point')).toContainText(/1 FICHIERS SYNCHRONIS/i);
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
