import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { getStore } = require('../../netlify/lib/blob-store.js');
const { MAX_SCAN_FILES, parseKey, rebuildIndex } = require('../../netlify/lib/db-index.js');
const { __test: collabTest } = require('../../netlify/lib/collab.js');

const COLLAB_STORE_NAME = 'bni-linked-collab';
const DB_STORE_NAME = 'bni-linked-db';
const DEFAULT_PRESENCE_TTL_MS = 2 * 60 * 1000;
const DEFAULT_EXPORT_RETENTION_DAYS = 45;
const DEFAULT_SCAN_LIMIT = MAX_SCAN_FILES;
const DEFAULT_SESSION_MAX_IDLE_MS = Math.max(
    60 * 1000,
    Number(collabTest?.SESSION_MAX_IDLE_MS || 30 * 24 * 60 * 60 * 1000) || (30 * 24 * 60 * 60 * 1000)
);

function readNumber(value, fallback, min = 0) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, parsed);
}

function readTimeValue(value) {
    const parsed = Date.parse(String(value || ''));
    return Number.isFinite(parsed) ? parsed : 0;
}

function isExpired(timestampMs, ttlMs, nowMs) {
    if (!timestampMs) return true;
    return nowMs - timestampMs > ttlMs;
}

async function listKeysByPrefix(store, prefix, maxItems = DEFAULT_SCAN_LIMIT) {
    const keys = [];
    let cursor = null;

    do {
        const page = await store.list({ prefix, cursor });
        const blobs = Array.isArray(page?.blobs) ? page.blobs : [];
        blobs.forEach((blob) => {
            const key = String(blob?.key || '').trim();
            if (key) keys.push(key);
        });
        cursor = page?.cursor || null;
        if (keys.length >= maxItems) {
            cursor = null;
        }
    } while (cursor);

    return keys.slice(0, maxItems);
}

async function listPresenceKeys(store, maxItems = DEFAULT_SCAN_LIMIT) {
    const keys = [];
    const boardKeys = await listKeysByPrefix(store, 'presence/', maxItems);

    for (const boardKey of boardKeys) {
        if (keys.length >= maxItems) break;
        const remaining = Math.max(1, maxItems - keys.length);
        const childKeys = await listKeysByPrefix(store, `${String(boardKey || '').replace(/\/+$/, '')}/`, remaining);
        keys.push(...childKeys);
    }

    return keys.slice(0, maxItems);
}

async function purgePresence(store, nowMs, options = {}) {
    const presenceTtlMs = readNumber(options.presenceTtlMs, DEFAULT_PRESENCE_TTL_MS, 60 * 1000);
    const keys = await listPresenceKeys(store, readNumber(options.scanLimit, DEFAULT_SCAN_LIMIT, 100));
    const deletedKeys = [];

    for (const key of keys) {
        const entry = await store.get(key, { type: 'json' }).catch(() => null);
        const lastAt = readTimeValue(entry?.lastAt);
        if (!entry || isExpired(lastAt, presenceTtlMs, nowMs)) {
            await store.delete(key).catch(() => {});
            deletedKeys.push(key);
        }
    }

    return {
        scanned: keys.length,
        deleted: deletedKeys.length,
        kept: Math.max(0, keys.length - deletedKeys.length),
        ttlMs: presenceTtlMs,
        deletedKeys,
    };
}

async function purgeSessions(store, nowMs, options = {}) {
    const sessionMaxIdleMs = readNumber(
        options.sessionMaxIdleMs,
        DEFAULT_SESSION_MAX_IDLE_MS,
        60 * 1000
    );
    const keys = await listKeysByPrefix(store, 'sessions/', readNumber(options.scanLimit, DEFAULT_SCAN_LIMIT, 100));
    const deletedKeys = [];

    for (const key of keys) {
        const session = await store.get(key, { type: 'json' }).catch(() => null);
        const lastSeen = Math.max(
            readTimeValue(session?.lastAt),
            readTimeValue(session?.createdAt)
        );
        if (!session || isExpired(lastSeen, sessionMaxIdleMs, nowMs)) {
            await store.delete(key).catch(() => {});
            deletedKeys.push(key);
        }
    }

    return {
        scanned: keys.length,
        deleted: deletedKeys.length,
        kept: Math.max(0, keys.length - deletedKeys.length),
        ttlMs: sessionMaxIdleMs,
        deletedKeys,
    };
}

async function purgeExports(store, nowMs, options = {}) {
    const exportRetentionDays = readNumber(
        options.exportRetentionDays,
        DEFAULT_EXPORT_RETENTION_DAYS,
        1
    );
    const scanLimit = readNumber(options.scanLimit, DEFAULT_SCAN_LIMIT, 100);
    const retentionMs = exportRetentionDays * 24 * 60 * 60 * 1000;
    const deletedByPage = { point: [], map: [] };

    for (const page of ['point', 'map']) {
        const snapshot = await rebuildIndex(store, page, { maxScanFiles: scanLimit });
        const entries = Array.isArray(snapshot?.entries) ? snapshot.entries : [];

        for (const entry of entries) {
            const parsed = parseKey(entry?.key || '');
            if (!parsed || !String(parsed.action || '').startsWith('export')) continue;
            if (!isExpired(Number(parsed.ts || 0), retentionMs, nowMs)) continue;
            await store.delete(parsed.key).catch(() => {});
            deletedByPage[page].push(parsed.key);
        }

        if (deletedByPage[page].length > 0) {
            await rebuildIndex(store, page, { maxScanFiles: scanLimit });
        }
    }

    return {
        retentionDays: exportRetentionDays,
        deleted: deletedByPage.point.length + deletedByPage.map.length,
        deletedKeys: deletedByPage,
    };
}

export async function runRuntimeMaintenance(options = {}) {
    const nowMs = readNumber(options.nowMs, Date.now(), 1);
    const collabStore = options.collabStore || getStore(COLLAB_STORE_NAME);
    const dbStore = options.dbStore || getStore(DB_STORE_NAME);
    const startedAt = new Date(nowMs).toISOString();

    const [presence, sessions, exports] = await Promise.all([
        purgePresence(collabStore, nowMs, options),
        purgeSessions(collabStore, nowMs, options),
        purgeExports(dbStore, nowMs, options),
    ]);

    const finishedAt = new Date().toISOString();
    return {
        ok: true,
        startedAt,
        finishedAt,
        durationMs: Math.max(0, Date.parse(finishedAt) - nowMs),
        presence,
        sessions,
        exports,
    };
}
