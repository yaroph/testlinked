const test = require('node:test');
const assert = require('node:assert/strict');

const { __test } = require('../netlify/functions/collab-board.js');

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
