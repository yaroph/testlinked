import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { Storage } from '@google-cloud/storage';

const require = createRequire(import.meta.url);
const { getFirebaseApp, getFirebaseDatabase } = require('../../netlify/lib/firebase-admin.js');

const gzipAsync = promisify(gzip);
const DEFAULT_BACKUP_PREFIX = 'rtdb';

function readFirstEnvValue(...names) {
    for (const name of names) {
        const value = String(process.env[name] || '').trim();
        if (value) return value;
    }
    return '';
}

function sanitizeSegment(value = '') {
    return String(value || '')
        .trim()
        .replace(/^\/+|\/+$/g, '')
        .replace(/[^a-zA-Z0-9/_-]/g, '-');
}

function buildBackupObjectName(prefix = DEFAULT_BACKUP_PREFIX, date = new Date()) {
    const safePrefix = sanitizeSegment(prefix);
    const iso = date.toISOString();
    const dayPath = iso.slice(0, 10).replace(/-/g, '/');
    const stamp = iso.replace(/[:.]/g, '-');
    return `${safePrefix}/${dayPath}/backup-${stamp}.json.gz`;
}

export async function runRealtimeDatabaseBackup(options = {}) {
    const app = getFirebaseApp();
    const database = getFirebaseDatabase();
    const projectId = String(
        options.projectId ||
        app?.options?.projectId ||
        process.env.GCLOUD_PROJECT ||
        process.env.GOOGLE_CLOUD_PROJECT ||
        ''
    ).trim();
    const bucketName = String(
        options.bucketName ||
        readFirstEnvValue('BNI_BACKUP_BUCKET', 'BACKUP_BUCKET')
    ).trim();
    const prefix = String(
        options.prefix ||
        readFirstEnvValue('BNI_BACKUP_PREFIX', 'BACKUP_PREFIX') ||
        DEFAULT_BACKUP_PREFIX
    ).trim();

    if (!bucketName) {
        throw new Error('Backup bucket manquant. Configure BNI_BACKUP_BUCKET.');
    }

    const snapshot = await database.ref('/').get();
    const exportedAt = new Date().toISOString();
    const payload = {
        exportedAt,
        projectId,
        databaseURL: String(app?.options?.databaseURL || ''),
        data: snapshot.exists() ? snapshot.val() : null,
    };
    const rawBuffer = Buffer.from(JSON.stringify(payload), 'utf8');
    const gzipBuffer = await gzipAsync(rawBuffer, { level: 9 });
    const storage = new Storage(projectId ? { projectId } : {});
    const objectName = buildBackupObjectName(prefix, new Date(exportedAt));
    const file = storage.bucket(bucketName).file(objectName);

    await file.save(gzipBuffer, {
        resumable: false,
        metadata: {
            contentType: 'application/json; charset=utf-8',
            contentEncoding: 'gzip',
            cacheControl: 'no-store',
            metadata: {
                exportedAt,
                projectId,
                databaseURL: String(app?.options?.databaseURL || ''),
                backupPrefix: sanitizeSegment(prefix),
            },
        },
    });

    return {
        ok: true,
        bucket: bucketName,
        object: objectName,
        exportedAt,
        bytesRaw: rawBuffer.byteLength,
        bytesGzip: gzipBuffer.byteLength,
    };
}
