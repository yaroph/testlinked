const test = require('node:test');
const assert = require('node:assert/strict');

const {
  appendIndexEntry,
  removeIndexEntry,
  readIndexSnapshot,
  parseKey,
} = require('../netlify/lib/db-index.js');

class MemoryStore {
  constructor() {
    this.values = new Map();
  }

  async get(key) {
    if (!this.values.has(key)) return null;
    return JSON.parse(JSON.stringify(this.values.get(key)));
  }

  async setJSON(key, value) {
    this.values.set(key, JSON.parse(JSON.stringify(value)));
  }

  async delete(key) {
    this.values.delete(key);
  }

  async list(options = {}) {
    const prefix = String(options.prefix || '');
    const blobs = [...this.values.keys()]
      .filter((key) => key.startsWith(prefix))
      .sort()
      .map((key) => ({ key }));

    return {
      blobs,
      cursor: null,
    };
  }
}

test('db-index append et remove gardent un index trie et dedup', async () => {
  const store = new MemoryStore();

  await appendIndexEntry(store, 'map', { key: 'map/1700000000000_export-alpha_uuid-a' });
  await appendIndexEntry(store, 'map', { key: 'map/1700000001000_export-beta_uuid-b' });
  await appendIndexEntry(store, 'map', { key: 'map/1700000001000_export-beta_uuid-b' });

  const snapshot = await readIndexSnapshot(store, 'map');
  assert.equal(snapshot.exists, true);
  assert.equal(snapshot.entries.length, 2);
  assert.equal(snapshot.entries[0].action, 'export-beta');
  assert.equal(snapshot.entries[1].action, 'export-alpha');

  await removeIndexEntry(store, 'map', 'map/1700000001000_export-beta_uuid-b');

  const afterDelete = await readIndexSnapshot(store, 'map');
  assert.equal(afterDelete.entries.length, 1);
  assert.equal(afterDelete.entries[0].action, 'export-alpha');
});

test('db-index parseKey ignore les cles invalides', () => {
  assert.equal(parseKey('bad-key'), null);
  assert.equal(parseKey('map/not-a-timestamp_export_uuid'), null);
  assert.equal(parseKey('map/1700000000000_sync_uuid'), null);

  const parsed = parseKey('point/1700000000000_import-case_uuid-z');
  assert.equal(parsed.page, 'point');
  assert.equal(parsed.action, 'import-case');
  assert.equal(parsed.ts, 1700000000000);
});
