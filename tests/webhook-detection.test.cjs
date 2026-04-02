const test = require('node:test');
const assert = require('node:assert/strict');

const {
  listDetections,
  normalizeIncomingDetection,
  saveDetection,
  __test,
} = require('../netlify/lib/webhook-detection-store.js');

class MemoryStore {
  constructor() {
    this.values = new Map();
  }

  async get(key) {
    if (!this.values.has(String(key))) return null;
    return JSON.parse(JSON.stringify(this.values.get(String(key))));
  }

  async setJSON(key, value) {
    this.values.set(String(key), JSON.parse(JSON.stringify(value)));
    return value;
  }

  async list(options = {}) {
    const prefix = String(options.prefix || '');
    const blobs = [...this.values.keys()]
      .filter((key) => key.startsWith(prefix))
      .sort((left, right) => left.localeCompare(right))
      .map((key) => ({ key }));
    return { blobs, cursor: null };
  }
}

test('normalizeIncomingDetection accepte un timestamp unix en secondes et ajoute receivedAt', () => {
  const detection = normalizeIncomingDetection({
    player: 'Atlas',
    x: 120.55555,
    y: 88.33333,
    z: 19.12345,
    timestamp: 1710000000,
    type: 'Detection',
  }, {
    receivedAtMs: Date.parse('2026-04-02T08:15:00.000Z'),
  });

  assert.equal(detection.player, 'Atlas');
  assert.equal(detection.type, 'detection');
  assert.equal(detection.timestamp, 1710000000);
  assert.equal(detection.timestampMs, 1710000000000);
  assert.equal(detection.detectedAt, '2024-03-09T16:00:00.000Z');
  assert.equal(detection.receivedAt, '2026-04-02T08:15:00.000Z');
  assert.equal(detection.x, 120.556);
});

test('saveDetection ignore un doublon strict sur les dernieres entrees', async () => {
  const store = new MemoryStore();
  const payload = {
    player: 'NomDuJoueur',
    x: 123.45,
    y: 678.9,
    z: 21,
    timestamp: 1710000000,
    type: 'detection',
  };

  const first = await saveDetection(store, payload, {
    receivedAtMs: Date.parse('2026-04-02T10:00:00.000Z'),
  });
  const second = await saveDetection(store, payload, {
    receivedAtMs: Date.parse('2026-04-02T10:00:05.000Z'),
  });

  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(second.item.id, first.item.id);
});

test('listDetections renvoie les plus recentes en premier avec une limite', async () => {
  const store = new MemoryStore();

  await saveDetection(store, {
    player: 'Alpha',
    x: 10,
    y: 20,
    z: 5,
    timestamp: 1710000000,
    type: 'detection',
  }, {
    receivedAtMs: Date.parse('2026-04-02T10:00:00.000Z'),
  });

  await saveDetection(store, {
    player: 'Bravo',
    x: 15,
    y: 25,
    z: 6,
    timestamp: 1710000100,
    type: 'prediction',
  }, {
    receivedAtMs: Date.parse('2026-04-02T10:01:00.000Z'),
  });

  await saveDetection(store, {
    player: 'Charlie',
    x: 18,
    y: 28,
    z: 7,
    timestamp: 1710000200,
    type: 'staff_prediction',
  }, {
    receivedAtMs: Date.parse('2026-04-02T10:02:00.000Z'),
  });

  const items = await listDetections(store, { limit: 2 });

  assert.equal(items.length, 2);
  assert.deepEqual(items.map((entry) => entry.player), ['Charlie', 'Bravo']);
});

test('sanitizeLimit borne la pagination webhook', () => {
  assert.equal(__test.sanitizeLimit('0'), 100);
  assert.equal(__test.sanitizeLimit('9999'), 500);
  assert.equal(__test.sanitizeLimit('25'), 25);
});
