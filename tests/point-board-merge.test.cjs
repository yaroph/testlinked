const test = require('node:test');
const assert = require('node:assert/strict');

const { __test } = require('../netlify/functions/collab-board.js');

test('mergeBoardPayload fusionne champ par champ selon les metadonnees _collab', () => {
  const existing = {
    meta: {},
    physicsSettings: { repulsion: 1200 },
    nodes: [
      {
        id: 'n1',
        name: 'Alice Martin',
        type: 'person',
        color: '#ffffff',
        manualColor: false,
        personStatus: 'active',
        num: '111',
        accountNumber: '',
        citizenNumber: '',
        description: 'ancienne description',
        notes: 'ancienne description',
        x: 10,
        y: 20,
        fixed: false,
        linkedMapPointId: '',
        _collab: {
          updatedAt: '2026-03-10T08:00:00.000Z',
          updatedBy: 'old-user',
          fieldTimes: {
            name: '2026-03-10T08:00:00.000Z',
            type: '2026-03-10T08:00:00.000Z',
            color: '2026-03-10T08:00:00.000Z',
            manualColor: '2026-03-10T08:00:00.000Z',
            personStatus: '2026-03-10T08:00:00.000Z',
            num: '2026-03-10T09:00:00.000Z',
            accountNumber: '2026-03-10T08:00:00.000Z',
            citizenNumber: '2026-03-10T08:00:00.000Z',
            description: '2026-03-10T08:00:00.000Z',
            notes: '2026-03-10T08:00:00.000Z',
            x: '2026-03-10T08:00:00.000Z',
            y: '2026-03-10T08:00:00.000Z',
            fixed: '2026-03-10T08:00:00.000Z',
            linkedMapPointId: '2026-03-10T08:00:00.000Z',
          },
        },
      },
    ],
    links: [],
    deletedNodes: [],
    deletedLinks: [],
    _collab: {
      updatedAt: '2026-03-10T08:00:00.000Z',
      updatedBy: 'old-user',
      fieldTimes: {
        physicsSettings: '2026-03-10T08:00:00.000Z',
      },
    },
  };

  const incoming = {
    meta: {},
    physicsSettings: { repulsion: 1800 },
    nodes: [
      {
        id: 'n1',
        name: 'Alice M.',
        type: 'person',
        color: '#ffffff',
        manualColor: false,
        personStatus: 'active',
        num: '222',
        accountNumber: '',
        citizenNumber: '',
        description: 'nouvelle description',
        notes: 'nouvelle description',
        x: 10,
        y: 20,
        fixed: false,
        linkedMapPointId: '',
        _collab: {
          updatedAt: '2026-03-10T10:00:00.000Z',
          updatedBy: 'new-user',
          fieldTimes: {
            name: '2026-03-10T10:00:00.000Z',
            type: '2026-03-10T10:00:00.000Z',
            color: '2026-03-10T10:00:00.000Z',
            manualColor: '2026-03-10T10:00:00.000Z',
            personStatus: '2026-03-10T10:00:00.000Z',
            num: '2026-03-10T07:00:00.000Z',
            accountNumber: '2026-03-10T10:00:00.000Z',
            citizenNumber: '2026-03-10T10:00:00.000Z',
            description: '2026-03-10T10:00:00.000Z',
            notes: '2026-03-10T10:00:00.000Z',
            x: '2026-03-10T10:00:00.000Z',
            y: '2026-03-10T10:00:00.000Z',
            fixed: '2026-03-10T10:00:00.000Z',
            linkedMapPointId: '2026-03-10T10:00:00.000Z',
          },
        },
      },
    ],
    links: [],
    deletedNodes: [],
    deletedLinks: [],
    _collab: {
      updatedAt: '2026-03-10T10:00:00.000Z',
      updatedBy: 'new-user',
      fieldTimes: {
        physicsSettings: '2026-03-10T10:00:00.000Z',
      },
    },
  };

  const merged = __test.mergeBoardPayload(existing, incoming, {
    existingUpdatedAt: '2026-03-10T08:00:00.000Z',
    incomingUpdatedAt: '2026-03-10T10:00:00.000Z',
    existingUser: 'old-user',
    incomingUser: 'new-user',
  });

  assert.equal(merged.nodes.length, 1);
  assert.equal(merged.nodes[0].name, 'Alice M.');
  assert.equal(merged.nodes[0].num, '111');
  assert.equal(merged.nodes[0].description, 'nouvelle description');
  assert.equal(merged.physicsSettings.repulsion, 1800);
  assert.equal(merged._collab.updatedBy, 'new-user');
});
