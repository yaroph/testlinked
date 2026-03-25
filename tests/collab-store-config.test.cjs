const test = require('node:test');
const assert = require('node:assert/strict');

const collabLib = require('../netlify/lib/collab.js');

const {
  resolveFirebaseOptions,
  describeStoreClientConfig,
} = collabLib.__test;

function withEnv(overrides, callback) {
  const previous = {};
  for (const [key, value] of Object.entries(overrides)) {
    previous[key] = process.env[key];
    if (value === undefined || value === null) {
      delete process.env[key];
    } else {
      process.env[key] = String(value);
    }
  }
  try {
    return callback();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test('resolveFirebaseOptions lit les variables Firebase standard', () => {
  withEnv({
    BNI_FIREBASE_DATABASE_URL: undefined,
    FIREBASE_DATABASE_URL: 'https://demo-default-rtdb.europe-west1.firebasedatabase.app',
    BNI_FIREBASE_PROJECT_ID: undefined,
    FIREBASE_PROJECT_ID: 'demo-project',
    GCLOUD_PROJECT: undefined,
    GOOGLE_CLOUD_PROJECT: undefined,
    BNI_FIREBASE_SERVICE_ACCOUNT_JSON: undefined,
    FIREBASE_SERVICE_ACCOUNT_JSON: undefined,
  }, () => {
    assert.deepEqual(resolveFirebaseOptions(), {
      databaseURL: 'https://demo-default-rtdb.europe-west1.firebasedatabase.app',
      projectId: 'demo-project',
      serviceAccount: null,
    });
  });
});

test('resolveFirebaseOptions privilegie les variables BNI dediees', () => {
  withEnv({
    BNI_FIREBASE_DATABASE_URL: 'https://bni-default-rtdb.europe-west1.firebasedatabase.app',
    FIREBASE_DATABASE_URL: 'https://generic-default-rtdb.europe-west1.firebasedatabase.app',
    BNI_FIREBASE_PROJECT_ID: 'bni-project',
    FIREBASE_PROJECT_ID: 'generic-project',
    BNI_FIREBASE_SERVICE_ACCOUNT_JSON: '{"project_id":"bni-project","private_key":"line1\\\\nline2","client_email":"demo@example.com"}',
    FIREBASE_SERVICE_ACCOUNT_JSON: '{"project_id":"generic-project","private_key":"ignored","client_email":"generic@example.com"}',
  }, () => {
    const options = resolveFirebaseOptions();
    assert.equal(options.databaseURL, 'https://bni-default-rtdb.europe-west1.firebasedatabase.app');
    assert.equal(options.projectId, 'bni-project');
    assert.equal(options.serviceAccount.project_id, 'bni-project');
    assert.equal(options.serviceAccount.private_key, 'line1\nline2');
  });
});

test('describeStoreClientConfig expose un etat incomplet si seule la database URL est presente', () => {
  withEnv({
    BNI_FIREBASE_DATABASE_URL: 'https://demo-default-rtdb.europe-west1.firebasedatabase.app',
    FIREBASE_DATABASE_URL: undefined,
    BNI_FIREBASE_PROJECT_ID: undefined,
    FIREBASE_PROJECT_ID: undefined,
    GCLOUD_PROJECT: undefined,
    GOOGLE_CLOUD_PROJECT: undefined,
    BNI_FIREBASE_SERVICE_ACCOUNT_JSON: undefined,
    FIREBASE_SERVICE_ACCOUNT_JSON: undefined,
  }, () => {
    assert.deepEqual(describeStoreClientConfig(), {
      provider: 'firebase',
      databaseURLPresent: true,
      projectIdPresent: false,
      serviceAccountPresent: false,
      applicationDefault: true,
    });
  });
});
