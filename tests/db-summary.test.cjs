const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildArchiveSummary,
  summarizeBoardData,
} = require('../netlify/lib/db-summary.js');

test('db-summary resume correctement une archive point', () => {
  const summary = buildArchiveSummary('point', 'export-mission-alpha', {
    meta: {
      date: '2026-03-28T10:00:00.000Z',
      projectName: 'Mission Alpha',
    },
    nodes: [
      { id: 'n1', name: 'Alice', type: 'person' },
      { id: 'n2', name: '', type: 'company' },
      { id: 'n3', name: 'Group K', type: 'group' },
    ],
    links: [{ id: 'l1', source: 'n1', target: 'n2' }],
  }, {
    key: 'point/1_export-mission-alpha_uuid',
  });

  assert.equal(summary.title, 'Mission Alpha');
  assert.equal(summary.actionKind, 'export');
  assert.equal(summary.stats.nodes, 3);
  assert.equal(summary.stats.links, 1);
  assert.equal(summary.stats.unnamedNodes, 1);
  assert.match(summary.matchText, /mission alpha/);
});

test('db-summary resume correctement une archive map et un board map', () => {
  const payload = {
    meta: { date: '2026-03-28T12:00:00.000Z' },
    groups: [
      {
        id: 'g1',
        name: 'Allies',
        points: [{ id: 'p1' }, { id: 'p2' }],
        zones: [{ id: 'z1' }],
      },
      {
        id: 'g2',
        name: 'Hostiles',
        points: [{ id: 'p3' }],
        zones: [],
      },
    ],
    tacticalLinks: [{ id: 't1', from: 'p1', to: 'p2' }],
  };

  const summary = buildArchiveSummary('map', 'import-sitrep', payload);
  assert.equal(summary.actionKind, 'import');
  assert.equal(summary.stats.groups, 2);
  assert.equal(summary.stats.points, 3);
  assert.equal(summary.stats.zones, 1);
  assert.equal(summary.stats.tacticalLinks, 1);

  const boardSummary = summarizeBoardData('map', payload);
  assert.equal(boardSummary.page, 'map');
  assert.deepEqual(boardSummary.statLines, ['2 groupes', '3 points', '1 zones', '1 liaisons']);
});
