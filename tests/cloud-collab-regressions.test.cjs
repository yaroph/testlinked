const test = require('node:test');
const assert = require('node:assert/strict');

const { __test } = require('../netlify/functions/collab-board.js');

function createMockLockStore() {
  const values = new Map();
  const etags = new Map();
  let etagSeq = 1;

  return {
    async get(key) {
      return values.has(key) ? JSON.parse(JSON.stringify(values.get(key))) : null;
    },
    async getWithMetadata(key) {
      if (!values.has(key)) return null;
      return {
        data: JSON.parse(JSON.stringify(values.get(key))),
        etag: etags.get(key) || '',
        metadata: null,
      };
    },
    async setJSON(key, value, options = {}) {
      if (options.onlyIfNew && values.has(key)) {
        return { modified: false, etag: etags.get(key) || '', value: null };
      }
      if (options.onlyIfMatch && String(etags.get(key) || '') !== String(options.onlyIfMatch || '')) {
        return { modified: false, etag: etags.get(key) || '', value: null };
      }
      values.set(key, JSON.parse(JSON.stringify(value)));
      const etag = `etag-${etagSeq++}`;
      etags.set(key, etag);
      return { modified: true, etag, value };
    },
    async delete(key) {
      values.delete(key);
      etags.delete(key);
      return true;
    },
  };
}

test('canonicalizeBoardPayloadByPage ignore les differences de meta volatile et l ordre pour point', () => {
  const left = {
    meta: { projectName: 'Alpha', date: '2026-03-11T09:00:00.000Z' },
    physicsSettings: { repulsion: 1200 },
    nodes: [
      {
        id: 'n2',
        name: 'Bravo',
        type: 'person',
        color: '#ffffff',
        manualColor: false,
        personStatus: 'active',
        num: '',
        accountNumber: '',
        citizenNumber: '',
        description: 'B',
        notes: 'B',
        x: 40,
        y: 50,
        fixed: false,
        linkedMapPointId: '',
        _collab: {
          updatedAt: '2026-03-11T09:01:00.000Z',
          updatedBy: 'user-a',
        },
      },
      {
        id: 'n1',
        name: 'Alpha',
        type: 'person',
        color: '#ffffff',
        manualColor: false,
        personStatus: 'active',
        num: '',
        accountNumber: '',
        citizenNumber: '',
        description: 'A',
        notes: 'A',
        x: 10,
        y: 20,
        fixed: false,
        linkedMapPointId: '',
        _collab: {
          updatedAt: '2026-03-11T09:02:00.000Z',
          updatedBy: 'user-a',
        },
      },
    ],
    links: [
      {
        id: 'l2',
        source: 'n2',
        target: 'n1',
        kind: 'relation',
        _collab: { updatedAt: '2026-03-11T09:03:00.000Z', updatedBy: 'user-a' },
      },
    ],
    deletedNodes: [],
    deletedLinks: [],
  };

  const right = {
    meta: { projectName: 'Alpha', date: '2026-03-11T11:00:00.000Z' },
    physicsSettings: { repulsion: 1200 },
    nodes: [
      {
        id: 'n1',
        name: 'Alpha',
        type: 'person',
        color: '#ffffff',
        manualColor: false,
        personStatus: 'active',
        num: '',
        accountNumber: '',
        citizenNumber: '',
        description: 'A',
        notes: 'A',
        x: 10,
        y: 20,
        fixed: false,
        linkedMapPointId: '',
        _collab: {
          updatedAt: '2026-03-11T12:02:00.000Z',
          updatedBy: 'user-b',
        },
      },
      {
        id: 'n2',
        name: 'Bravo',
        type: 'person',
        color: '#ffffff',
        manualColor: false,
        personStatus: 'active',
        num: '',
        accountNumber: '',
        citizenNumber: '',
        description: 'B',
        notes: 'B',
        x: 40,
        y: 50,
        fixed: false,
        linkedMapPointId: '',
        _collab: {
          updatedAt: '2026-03-11T12:01:00.000Z',
          updatedBy: 'user-b',
        },
      },
    ],
    links: [
      {
        id: 'l2',
        source: 'n2',
        target: 'n1',
        kind: 'relation',
        _collab: { updatedAt: '2026-03-11T12:03:00.000Z', updatedBy: 'user-b' },
      },
    ],
    deletedNodes: [],
    deletedLinks: [],
  };

  const leftCanonical = __test.canonicalizeBoardPayloadByPage('point', left);
  const rightCanonical = __test.canonicalizeBoardPayloadByPage('point', right);

  assert.deepEqual(leftCanonical, rightCanonical);
});

test('canonicalizeBoardPayloadByPage ignore meta.date pour map', () => {
  const left = {
    meta: { date: '2026-03-11T09:00:00.000Z' },
    groups: [
      {
        id: 'grp_a',
        name: 'Allies',
        color: '#73fbf7',
        visible: true,
        points: [
          { id: 'pt_a', name: 'Alpha', x: 10, y: 20, type: '', iconType: 'DEFAULT', notes: '', status: 'ACTIVE' },
        ],
        zones: [],
      },
    ],
    tacticalLinks: [],
  };

  const right = {
    meta: { date: '2026-03-11T15:00:00.000Z' },
    groups: [
      {
        id: 'grp_a',
        name: 'Allies',
        color: '#73fbf7',
        visible: true,
        points: [
          { id: 'pt_a', name: 'Alpha', x: 10, y: 20, type: '', iconType: 'DEFAULT', notes: '', status: 'ACTIVE' },
        ],
        zones: [],
      },
    ],
    tacticalLinks: [],
  };

  const leftCanonical = __test.canonicalizeBoardPayloadByPage('map', left);
  const rightCanonical = __test.canonicalizeBoardPayloadByPage('map', right);

  assert.deepEqual(leftCanonical, rightCanonical);
});

test('sanitizeShareRole degrade owner en editor pour le partage standard', () => {
  assert.equal(__test.sanitizeShareRole('owner'), 'editor');
  assert.equal(__test.sanitizeShareRole('viewer'), 'viewer');
  assert.equal(__test.sanitizeShareRole('editor'), 'editor');
});

test('getUnsupportedShareRoleMessage force le transfert pour un nouveau lead', () => {
  assert.equal(
    __test.getUnsupportedShareRoleMessage(
      'owner',
      { ownerId: 'u-owner' },
      { id: 'u-target' }
    ),
    'Utilise "Donner lead" pour changer le lead.'
  );
  assert.equal(
    __test.getUnsupportedShareRoleMessage(
      'owner',
      { ownerId: 'u-owner' },
      { id: 'u-owner' }
    ),
    ''
  );
  assert.equal(
    __test.getUnsupportedShareRoleMessage(
      'viewer',
      { ownerId: 'u-owner' },
      { id: 'u-target' }
    ),
    ''
  );
});

test('buildBoardSaveActivityEntriesByPage detaille les changements metier sur un board point', () => {
  const previous = {
    meta: {},
    physicsSettings: {},
    nodes: [
      {
        id: 'n1',
        name: 'Alice',
        type: 'person',
        description: 'Ancienne description',
        notes: '',
        personStatus: 'active',
        num: '',
        accountNumber: '',
        citizenNumber: '',
        x: 0,
        y: 0,
        fixed: false,
        linkedMapPointId: '',
      },
      {
        id: 'n2',
        name: 'Bob',
        type: 'person',
        description: '',
        notes: '',
        personStatus: 'active',
        num: '',
        accountNumber: '',
        citizenNumber: '',
        x: 8,
        y: 0,
        fixed: false,
        linkedMapPointId: '',
      },
    ],
    links: [
      { id: 'l1', source: 'n1', target: 'n2', kind: 'relation' },
    ],
    deletedNodes: [],
    deletedLinks: [],
    _collab: { updatedAt: '2026-03-28T10:00:00.000Z', updatedBy: 'eric' },
  };

  const next = {
    meta: {},
    physicsSettings: {},
    nodes: [
      {
        id: 'n1',
        name: 'Alicia',
        type: 'person',
        description: 'Nouvelle description',
        notes: '',
        personStatus: 'active',
        num: '',
        accountNumber: '',
        citizenNumber: '',
        x: 0,
        y: 0,
        fixed: false,
        linkedMapPointId: '',
      },
      {
        id: 'n2',
        name: 'Bob',
        type: 'person',
        description: '',
        notes: '',
        personStatus: 'active',
        num: '',
        accountNumber: '',
        citizenNumber: '',
        x: 0,
        y: 0,
        fixed: false,
        linkedMapPointId: '',
      },
      {
        id: 'n3',
        name: 'Charlie',
        type: 'person',
        description: '',
        notes: '',
        personStatus: 'active',
        num: '',
        accountNumber: '',
        citizenNumber: '',
        x: 0,
        y: 0,
        fixed: false,
        linkedMapPointId: '',
      },
    ],
    links: [
      { id: 'l1', source: 'n1', target: 'n2', kind: 'ami' },
      { id: 'l2', source: 'n2', target: 'n3', kind: 'relation' },
    ],
    deletedNodes: [],
    deletedLinks: [],
    _collab: { updatedAt: '2026-03-28T10:05:00.000Z', updatedBy: 'eric' },
  };

  const entries = __test.buildBoardSaveActivityEntriesByPage('point', previous, next);
  const texts = entries.map((entry) => entry.text);

  assert.ok(texts.includes('a ajoute la fiche Charlie'));
  assert.ok(texts.includes('a modifie le nom de Alice en Alicia'));
  assert.ok(texts.includes('a modifie la description de Alicia'));
  assert.ok(texts.includes('a modifie la relation entre Alicia et Bob (relation -> ami)'));
  assert.ok(texts.includes('a ajoute une relation entre Bob et Charlie'));
  assert.ok(texts.includes('a repositionne Bob'));
});

test('acquireBoardEditLock reserve l edition au premier utilisateur et bloque le second', async () => {
  const store = createMockLockStore();
  const board = { id: 'brd_alpha' };

  const first = await __test.acquireBoardEditLock(store, board, {
    id: 'u_a',
    username: 'alpha',
  }, 'editor');

  assert.equal(first.ok, true);
  assert.equal(first.lock.isSelf, true);
  assert.equal(first.lock.heldByOther, false);

  const second = await __test.acquireBoardEditLock(store, board, {
    id: 'u_b',
    username: 'bravo',
  }, 'editor');

  assert.equal(second.ok, false);
  assert.equal(second.statusCode, 423);
  assert.equal(second.lock.username, 'alpha');
  assert.equal(second.lock.heldByOther, true);
});

test('releaseBoardEditLock libere le board et permet une reprise d edition', async () => {
  const store = createMockLockStore();
  const board = { id: 'brd_beta' };

  const first = await __test.acquireBoardEditLock(store, board, {
    id: 'u_a',
    username: 'alpha',
  }, 'owner');

  assert.equal(first.ok, true);

  await __test.releaseBoardEditLock(store, board.id, 'u_a');

  const second = await __test.acquireBoardEditLock(store, board, {
    id: 'u_b',
    username: 'bravo',
  }, 'editor');

  assert.equal(second.ok, true);
  assert.equal(second.lock.username, 'bravo');
  assert.equal(second.lock.isSelf, true);
});
