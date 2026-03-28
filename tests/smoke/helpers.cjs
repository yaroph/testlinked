const { expect } = require('@playwright/test');

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function buildIsoNow() {
    return new Date().toISOString();
}

function jsonResponse(route, status, payload) {
    return route.fulfill({
        status,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify(payload),
    });
}

async function installNetlifyMocks(page, options = {}) {
    const requests = [];
    const latencyByAction = options.latencyByAction && typeof options.latencyByAction === 'object'
        ? options.latencyByAction
        : {};
    const authUser = options.authUser && typeof options.authUser === 'object'
        ? clone(options.authUser)
        : { username: 'smoke-user' };
    let authPassword = String(options.authPassword || 'secret');
    const alertsStore = {
        nextId: 1,
        alerts: Array.isArray(options.alerts) ? clone(options.alerts) : [],
        users: Array.isArray(options.users) ? clone(options.users) : ['atlas', 'delta', 'helix'],
    };
    const boardsStore = {
        boards: Array.isArray(options.boards) ? clone(options.boards) : [],
    };
    const collabUsers = Array.isArray(options.collabUsers)
        ? clone(options.collabUsers)
        : [
            { userId: 'u-smoke', username: String(authUser.username || 'smoke-user') },
            { userId: 'u-alpha', username: 'alpha.team' },
            { userId: 'u-bravo', username: 'bravo' },
        ];

    await page.route('**/.netlify/functions/**', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        const pathname = url.pathname;
        const method = request.method().toUpperCase();
        let body = {};

        if (method !== 'GET') {
            try {
                body = JSON.parse(request.postData() || '{}');
            } catch (error) {
                body = {};
            }
        }

        if (pathname.endsWith('/collab-auth')) {
            const action = String(body.action || url.searchParams.get('action') || 'me');
            requests.push({ endpoint: 'collab-auth', action, payload: clone(body) });
            const actionDelay = Math.max(0, Number(latencyByAction[action]) || 0);
            if (actionDelay > 0) {
                await new Promise((resolve) => setTimeout(resolve, actionDelay));
            }

            if (action === 'me') {
                if (options.authSession === true) {
                    return jsonResponse(route, 200, {
                        ok: true,
                        user: authUser,
                    });
                }
                return jsonResponse(route, 401, {
                    ok: false,
                    error: 'Session absente',
                });
            }

            if (action === 'login' || action === 'register') {
                return jsonResponse(route, 200, {
                    ok: true,
                    token: 'smoke-token',
                    user: { ...authUser, username: String(body.username || authUser.username || 'smoke-user') },
                });
            }

            if (action === 'logout') {
                return jsonResponse(route, 200, { ok: true });
            }

            if (action === 'update_profile') {
                if (String(body.currentPassword || '') !== authPassword) {
                    return jsonResponse(route, 401, {
                        ok: false,
                        error: 'Mot de passe actuel invalide.',
                    });
                }
                const nextUsername = String(body.nextUsername || '').trim();
                const nextPassword = String(body.nextPassword || '');
                if (nextUsername) {
                    authUser.username = nextUsername;
                }
                if (nextPassword) {
                    authPassword = nextPassword;
                }
                return jsonResponse(route, 200, {
                    ok: true,
                    user: clone(authUser),
                });
            }

            return jsonResponse(route, 200, { ok: true });
        }

        if (pathname.endsWith('/collab-board')) {
            const action = String(body.action || url.searchParams.get('action') || 'list');
            requests.push({ endpoint: 'collab-board', action, payload: clone(body) });
            const actionDelay = Math.max(0, Number(latencyByAction[action]) || 0);
            if (actionDelay > 0) {
                await new Promise((resolve) => setTimeout(resolve, actionDelay));
            }
            const viewerId = String(authUser.id || 'u-smoke');
            const viewerName = String(authUser.username || 'smoke-user');
            const findBoard = (boardId) => boardsStore.boards.find((entry) => String(entry?.id || '') === String(boardId || '').trim());
            const canEditBoard = (board) => {
                const role = String(board?.role || 'editor');
                return role === 'owner' || role === 'editor';
            };
            const normalizeEditLock = (board) => {
                const lock = board?.editLock && typeof board.editLock === 'object' ? board.editLock : null;
                const boardId = String(board?.id || '');
                const userId = String(lock?.userId || '').trim();
                if (!boardId || !userId) return null;
                const username = String(lock?.username || 'operateur').trim() || 'operateur';
                const isSelf = userId === viewerId;
                const heldByOther = !isSelf;
                return {
                    boardId,
                    userId,
                    username,
                    isSelf,
                    heldByOther,
                    message: String(lock?.message || (heldByOther ? `${username} modifie deja ce board.` : 'Edition reservee pour toi.')),
                    acquiredAt: String(lock?.acquiredAt || buildIsoNow()),
                    lastAt: String(lock?.lastAt || buildIsoNow()),
                    expiresAt: String(lock?.expiresAt || new Date(Date.now() + 60000).toISOString()),
                };
            };
            const acquireEditLock = (board) => {
                if (!board || !canEditBoard(board)) return normalizeEditLock(board);
                const existing = normalizeEditLock(board);
                if (existing && !existing.isSelf) return existing;
                const now = buildIsoNow();
                board.editLock = {
                    boardId: String(board.id || ''),
                    userId: viewerId,
                    username: viewerName,
                    acquiredAt: String(existing?.acquiredAt || now),
                    lastAt: now,
                    expiresAt: new Date(Date.now() + 60000).toISOString(),
                };
                return normalizeEditLock(board);
            };

             if (action === 'list_boards') {
                const requestedPage = String(body.page || '').trim().toLowerCase();
                return jsonResponse(route, 200, {
                    ok: true,
                    boards: boardsStore.boards
                        .filter((board) => !requestedPage || String(board.page || 'point').toLowerCase() === requestedPage)
                        .map((board) => ({
                            id: String(board.id || ''),
                            title: String(board.title || 'Sans nom'),
                            role: String(board.role || 'editor'),
                            page: String(board.page || 'point'),
                            ownerId: String(board.ownerId || ''),
                            ownerName: String(board.ownerName || ''),
                            updatedAt: String(board.updatedAt || ''),
                        })),
                    board: null,
                    shares: [],
                    presence: [],
                    activity: [],
                });
            }

            if (action === 'get_board') {
                const boardId = String(body.boardId || '').trim();
                const board = boardsStore.boards.find((entry) => String(entry?.id || '') === boardId);
                if (!board) {
                    return jsonResponse(route, 404, {
                        ok: false,
                        error: 'Board introuvable',
                    });
                }
                const editLock = canEditBoard(board) ? acquireEditLock(board) : normalizeEditLock(board);
                return jsonResponse(route, 200, {
                    ok: true,
                    role: String(board.role || 'editor'),
                    board: {
                        id: String(board.id || ''),
                        title: String(board.title || 'Sans nom'),
                        page: String(board.page || 'point'),
                        role: String(board.role || 'editor'),
                        ownerId: String(board.ownerId || ''),
                        ownerName: String(board.ownerName || ''),
                        members: Array.isArray(board.members) ? clone(board.members) : [],
                        data: board.data && typeof board.data === 'object' ? clone(board.data) : { nodes: [], links: [] },
                        activity: Array.isArray(board.activity) ? clone(board.activity) : [],
                    },
                    presence: Array.isArray(board.presence) ? clone(board.presence) : [],
                    onlineUsers: Array.isArray(board.onlineUsers) ? clone(board.onlineUsers) : [],
                    editLock,
                });
            }

            if (action === 'refresh_edit_lock') {
                const board = findBoard(body.boardId);
                if (!board) {
                    return jsonResponse(route, 404, {
                        ok: false,
                        error: 'Board introuvable',
                    });
                }
                if (!canEditBoard(board)) {
                    return jsonResponse(route, 403, {
                        ok: false,
                        error: 'Modification interdite.',
                    });
                }
                const editLock = acquireEditLock(board);
                if (editLock && editLock.heldByOther) {
                    return jsonResponse(route, 423, {
                        ok: false,
                        error: editLock.message,
                        editLock,
                    });
                }
                return jsonResponse(route, 200, {
                    ok: true,
                    boardId: String(board.id || ''),
                    editLock,
                });
            }

            if (action === 'release_edit_lock') {
                const board = findBoard(body.boardId);
                if (board) {
                    const editLock = normalizeEditLock(board);
                    if (!editLock || editLock.isSelf) {
                        board.editLock = null;
                    }
                }
                return jsonResponse(route, 200, {
                    ok: true,
                    boardId: String(body.boardId || ''),
                });
            }

            if (action === 'touch_presence') {
                const board = findBoard(body.boardId);
                if (!board) {
                    return jsonResponse(route, 404, {
                        ok: false,
                        error: 'Board introuvable',
                    });
                }
                const nextPresence = Array.isArray(board.presence) ? clone(board.presence) : [];
                const row = {
                    userId: viewerId,
                    username: viewerName,
                    role: String(board.role || 'editor'),
                    boardId: String(board.id || ''),
                    activeNodeId: String(body.activeNodeId || ''),
                    activeNodeName: String(body.activeNodeName || ''),
                    activeTextKey: String(body.activeTextKey || ''),
                    activeTextLabel: String(body.activeTextLabel || ''),
                    mode: String(body.mode || 'editing'),
                    cursorVisible: Boolean(body.cursorVisible),
                    cursorWorldX: Number(body.cursorWorldX ?? 0),
                    cursorWorldY: Number(body.cursorWorldY ?? 0),
                    cursorMapX: Number(body.cursorMapX ?? 50),
                    cursorMapY: Number(body.cursorMapY ?? 50),
                    lastAt: buildIsoNow(),
                };
                const filtered = nextPresence.filter((entry) => String(entry?.userId || '') !== viewerId);
                filtered.push(row);
                board.presence = filtered;
                return jsonResponse(route, 200, {
                    ok: true,
                    boardId: String(board.id || ''),
                    presence: clone(board.presence),
                });
            }

            if (action === 'search_users') {
                const board = findBoard(body.boardId);
                if (!board) {
                    return jsonResponse(route, 404, {
                        ok: false,
                        error: 'Board introuvable',
                    });
                }
                const query = String(body.query || '').trim().toLowerCase();
                const memberIds = new Set(
                    (Array.isArray(board.members) ? board.members : [])
                        .map((entry) => String(entry?.userId || ''))
                        .filter(Boolean)
                );
                const users = collabUsers
                    .filter((entry) => {
                        const username = String(entry?.username || '').toLowerCase();
                        const userId = String(entry?.userId || '');
                        return query && username.includes(query) && !memberIds.has(userId);
                    })
                    .slice(0, Number(body.limit || 7))
                    .map((entry) => ({
                        userId: String(entry.userId || ''),
                        username: String(entry.username || ''),
                    }));
                return jsonResponse(route, 200, {
                    ok: true,
                    users,
                });
            }

            if (action === 'clear_presence') {
                const board = findBoard(body.boardId);
                if (board) {
                    board.presence = (Array.isArray(board.presence) ? board.presence : [])
                        .filter((entry) => String(entry?.userId || '') !== viewerId);
                }
                return jsonResponse(route, 200, {
                    ok: true,
                    boardId: String(body.boardId || ''),
                });
            }

            if (action === 'watch_board') {
                const board = findBoard(body.boardId);
                if (!board) {
                    return jsonResponse(route, 404, {
                        ok: false,
                        error: 'Board introuvable',
                    });
                }
                return jsonResponse(route, 200, {
                    ok: true,
                    changed: false,
                    boardId: String(board.id || ''),
                    updatedAt: String(board.updatedAt || ''),
                    presence: Array.isArray(board.presence) ? clone(board.presence) : [],
                });
            }

            return jsonResponse(route, 200, {
                ok: true,
                boards: [],
                board: null,
                shares: [],
                presence: [],
                activity: [],
            });
        }

        if (pathname.endsWith('/alerts')) {
            const action = String(body.action || url.searchParams.get('action') || 'list-public');
            requests.push({ endpoint: 'alerts', action, payload: clone(body) });

            if (action === 'list-public') {
                return jsonResponse(route, 200, {
                    ok: true,
                    alerts: alertsStore.alerts.filter((alert) => alert && alert.active !== false),
                });
            }

            if (action === 'list-admin') {
                return jsonResponse(route, 200, {
                    ok: true,
                    alerts: alertsStore.alerts,
                });
            }

            if (action === 'list_users') {
                const query = String(body.query || '').trim().toLowerCase();
                const users = alertsStore.users.filter((entry) => !query || String(entry).toLowerCase().includes(query));
                return jsonResponse(route, 200, {
                    ok: true,
                    users,
                });
            }

            if (action === 'upsert') {
                const incomingAlert = body.alert && typeof body.alert === 'object' ? clone(body.alert) : {};
                const now = buildIsoNow();
                const alertId = String(incomingAlert.id || `alert-${alertsStore.nextId++}`);
                const savedAlert = {
                    ...incomingAlert,
                    id: alertId,
                    createdAt: incomingAlert.createdAt || now,
                    updatedAt: now,
                };
                const existingIndex = alertsStore.alerts.findIndex((entry) => String(entry?.id || '') === alertId);
                if (existingIndex >= 0) alertsStore.alerts.splice(existingIndex, 1, savedAlert);
                else alertsStore.alerts.unshift(savedAlert);
                return jsonResponse(route, 200, {
                    ok: true,
                    alert: savedAlert,
                });
            }

            if (action === 'delete') {
                const targetId = String(body.id || '').trim();
                alertsStore.alerts = alertsStore.alerts.filter((entry) => String(entry?.id || '') !== targetId);
                return jsonResponse(route, 200, { ok: true });
            }

            return jsonResponse(route, 200, { ok: true });
        }

        return jsonResponse(route, 404, {
            ok: false,
            error: `Unhandled endpoint: ${pathname}`,
        });
    });

    return {
        requests,
        alertsStore,
        boardsStore,
    };
}

async function seedHomeBootSeen(page) {
    await page.addInitScript(() => {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        localStorage.setItem('bniLinkedBootSeenDay_v1', `${year}-${month}-${day}`);
    });
}

async function waitForLoaderToLeave(page, selector = '#app-loader') {
    const loader = page.locator(selector);
    if (await loader.count()) {
        await loader.waitFor({ state: 'detached', timeout: 7000 }).catch(async () => {
            await expect(loader).toBeHidden({ timeout: 1000 });
        });
    }
}

async function waitForPointReady(page) {
    await waitForLoaderToLeave(page);
    await expect(page.locator('#quick-actions')).toBeVisible();
}

async function waitForMapReady(page) {
    await waitForLoaderToLeave(page);
    await expect(page.locator('#viewport')).toBeVisible();
}

async function unlockStaffConsole(page) {
    await expect(page.locator('#staff-access-overlay')).toBeVisible();
    await page.fill('#staff-access-input', 'staff');
    await page.click('#staff-access-submit');
    await expect(page.locator('#staff-access-overlay')).toBeHidden();
    await expect(page.locator('#staffAlertState')).toContainText(/Pret|Brouillon|Aucune|Visible/i);
}

async function drawCircleInViewport(page, selector, options = {}) {
    const target = page.locator(selector);
    const box = await target.boundingBox();
    if (!box) throw new Error(`No bounding box for ${selector}`);

    const startX = box.x + box.width * (options.startXRatio || 0.45);
    const startY = box.y + box.height * (options.startYRatio || 0.45);
    const endX = box.x + box.width * (options.endXRatio || 0.62);
    const endY = box.y + box.height * (options.endYRatio || 0.58);

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(endX, endY, { steps: 8 });
    await page.mouse.up();
}

module.exports = {
    drawCircleInViewport,
    installNetlifyMocks,
    seedHomeBootSeen,
    unlockStaffConsole,
    waitForMapReady,
    waitForPointReady,
};
