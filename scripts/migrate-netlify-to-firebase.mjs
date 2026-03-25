import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { getStore: getNetlifyStore } = require('@netlify/blobs');
const { getStore: getFirebaseStore } = require('../netlify/lib/blob-store.js');

const STORE_NAMES = [
    'bni-linked-collab',
    'bni-linked-alerts',
    'bni-linked-db'
];

function readFirstEnvValue(...names) {
    for (const name of names) {
        const value = String(process.env[name] || '').trim();
        if (value) return value;
    }
    return '';
}

function parseArgs(argv = []) {
    const options = {
        stores: [...STORE_NAMES],
        wipe: false,
    };

    for (let index = 0; index < argv.length; index += 1) {
        const current = String(argv[index] || '').trim();
        if (current === '--wipe') {
            options.wipe = true;
            continue;
        }
        if (current === '--stores') {
            const rawStores = String(argv[index + 1] || '').trim();
            index += 1;
            if (rawStores) {
                options.stores = rawStores
                    .split(',')
                    .map((value) => value.trim())
                    .filter(Boolean);
            }
        }
    }

    return options;
}

async function listAllKeys(store) {
    const keys = [];
    let cursor = null;

    do {
        const page = await store.list(cursor ? { cursor } : {});
        const blobs = Array.isArray(page?.blobs) ? page.blobs : [];
        blobs.forEach((blob) => {
            const key = String(blob?.key || '').trim();
            if (key) keys.push(key);
        });
        cursor = page?.cursor || null;
    } while (cursor);

    return [...new Set(keys)].sort((left, right) => left.localeCompare(right));
}

async function wipeTargetStore(storeName) {
    const targetStore = getFirebaseStore(storeName);
    const keys = await listAllKeys(targetStore);
    for (const key of keys) {
        await targetStore.delete(key);
    }
    return keys.length;
}

async function migrateStore(storeName, sourceOptions, options = {}) {
    const sourceStore = getNetlifyStore(storeName, sourceOptions);
    const targetStore = getFirebaseStore(storeName);
    const keys = await listAllKeys(sourceStore);

    let migrated = 0;
    for (const key of keys) {
        const value = await sourceStore.get(key, { type: 'json' });
        await targetStore.setJSON(key, value);
        migrated += 1;
    }

    return {
        storeName,
        migrated,
        wiped: options.wiped || 0,
    };
}

async function main() {
    const siteID = readFirstEnvValue(
        'BNI_NETLIFY_SITE_ID',
        'NETLIFY_BLOBS_SITE_ID',
        'NETLIFY_SITE_ID',
        'SITE_ID'
    );
    const token = readFirstEnvValue(
        'BNI_NETLIFY_AUTH_TOKEN',
        'BNI_NETLIFY_TOKEN',
        'NETLIFY_BLOBS_TOKEN',
        'NETLIFY_AUTH_TOKEN',
        'NETLIFY_TOKEN'
    );

    if (!siteID || !token) {
        throw new Error('NETLIFY_SITE_ID et NETLIFY_AUTH_TOKEN sont requis pour la migration.');
    }

    const options = parseArgs(process.argv.slice(2));
    const sourceOptions = { siteID, token };

    for (const storeName of options.stores) {
        const wiped = options.wipe ? await wipeTargetStore(storeName) : 0;
        const result = await migrateStore(storeName, sourceOptions, { wiped });
        process.stdout.write(
            `[migrate] ${result.storeName}: ${result.migrated} cles copiees`
            + (result.wiped ? `, ${result.wiped} cles supprimees avant import` : '')
            + '\n'
        );
    }
}

main().catch((error) => {
    process.stderr.write(`[migrate] failed: ${error?.message || error}\n`);
    process.exitCode = 1;
});
