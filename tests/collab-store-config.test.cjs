const test = require('node:test');
const assert = require('node:assert/strict');

const collabLib = require('../netlify/lib/collab.js');

const {
  resolveStoreClientEnvOptions,
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

test('resolveStoreClientEnvOptions lit les variables externes Netlify standard', () => {
  withEnv({
    BNI_NETLIFY_SITE_ID: undefined,
    NETLIFY_BLOBS_SITE_ID: undefined,
    NETLIFY_SITE_ID: 'site_standard',
    SITE_ID: undefined,
    BNI_NETLIFY_AUTH_TOKEN: undefined,
    BNI_NETLIFY_TOKEN: undefined,
    NETLIFY_BLOBS_TOKEN: undefined,
    NETLIFY_AUTH_TOKEN: 'token_standard',
    NETLIFY_TOKEN: undefined,
  }, () => {
    assert.deepEqual(resolveStoreClientEnvOptions(), {
      siteID: 'site_standard',
      token: 'token_standard',
    });
  });
});

test('resolveStoreClientEnvOptions privilegie les variables BNI dediees', () => {
  withEnv({
    BNI_NETLIFY_SITE_ID: 'site_bni',
    NETLIFY_SITE_ID: 'site_generic',
    BNI_NETLIFY_AUTH_TOKEN: 'token_bni',
    NETLIFY_AUTH_TOKEN: 'token_generic',
  }, () => {
    assert.deepEqual(resolveStoreClientEnvOptions(), {
      siteID: 'site_bni',
      token: 'token_bni',
    });
  });
});

test('describeStoreClientConfig expose un etat incomplet si un seul secret est present', () => {
  withEnv({
    BNI_NETLIFY_SITE_ID: 'site_only',
    NETLIFY_SITE_ID: undefined,
    SITE_ID: undefined,
    BNI_NETLIFY_AUTH_TOKEN: undefined,
    BNI_NETLIFY_TOKEN: undefined,
    NETLIFY_BLOBS_TOKEN: undefined,
    NETLIFY_AUTH_TOKEN: undefined,
    NETLIFY_TOKEN: undefined,
  }, () => {
    assert.deepEqual(describeStoreClientConfig(), {
      external: false,
      siteIDPresent: true,
      tokenPresent: false,
    });
  });
});
