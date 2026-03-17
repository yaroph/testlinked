const test = require('node:test');
const assert = require('node:assert/strict');

const { __test } = require('../netlify/functions/collab-board.js');

test('mergeMapBoardPayload conserve un groupe unique par id stable et applique le renommage', () => {
  const base = {
    groups: [
      {
        id: 'grp_sector_north',
        name: 'Secteur nord',
        color: '#73fbf7',
        visible: true,
        points: [
          { id: 'pt_alpha', name: 'Alpha', x: 10, y: 20, type: '', iconType: 'DEFAULT', notes: '', status: 'ACTIVE' },
        ],
        zones: [],
      },
    ],
    tacticalLinks: [],
  };

  const existing = {
    groups: [
      {
        id: 'grp_sector_north',
        name: 'Secteur nord',
        color: '#73fbf7',
        visible: true,
        points: [
          { id: 'pt_alpha', name: 'Alpha', x: 10, y: 20, type: '', iconType: 'DEFAULT', notes: '', status: 'ACTIVE' },
        ],
        zones: [],
      },
    ],
    tacticalLinks: [],
  };

  const incoming = {
    groups: [
      {
        id: 'grp_sector_north',
        name: 'Secteur nord renomme',
        color: '#ff6b81',
        visible: true,
        points: [
          { id: 'pt_alpha', name: 'Alpha', x: 10, y: 20, type: '', iconType: 'DEFAULT', notes: '', status: 'ACTIVE' },
          { id: 'pt_bravo', name: 'Bravo', x: 30, y: 40, type: '', iconType: 'DEFAULT', notes: '', status: 'ACTIVE' },
        ],
        zones: [],
      },
    ],
    tacticalLinks: [
      { id: 'ln_alpha_bravo', from: 'pt_alpha', to: 'pt_bravo', type: 'Standard' },
    ],
  };

  const merged = __test.mergeMapBoardPayload(existing, incoming, base);

  assert.equal(merged.groups.length, 1);
  assert.equal(merged.groups[0].id, 'grp_sector_north');
  assert.equal(merged.groups[0].name, 'Secteur nord renomme');
  assert.equal(merged.groups[0].color, '#ff6b81');
  assert.deepEqual(
    merged.groups[0].points.map((point) => point.id).sort(),
    ['pt_alpha', 'pt_bravo']
  );
  assert.equal(merged.tacticalLinks.length, 1);
  assert.equal(merged.tacticalLinks[0].from, 'pt_alpha');
  assert.equal(merged.tacticalLinks[0].to, 'pt_bravo');
});
