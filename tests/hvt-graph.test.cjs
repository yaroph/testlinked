const test = require('node:test');
const assert = require('node:assert/strict');

function hexToRgb(hex) {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex || ''));
  return match
    ? { r: parseInt(match[1], 16), g: parseInt(match[2], 16), b: parseInt(match[3], 16) }
    : { r: 255, g: 255, b: 255 };
}

function rgbToHex(r, g, b) {
  const toHex = (value) => Math.max(0, Math.min(255, Math.round(Number(value) || 0))).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

test('calculateHvtScores ranks the densest active node first', async () => {
  const { calculateHvtScores, selectHvtTopIds } = await import('../shared/js/hvt-graph.mjs');

  const TYPES = { PERSON: 'person', COMPANY: 'company', GROUP: 'group' };
  const PERSON_STATUS = { ACTIVE: 'active', INACTIVE: 'inactive', MISSING: 'missing', DECEASED: 'deceased' };
  const nodes = [
    { id: 'seed', type: TYPES.PERSON, personStatus: PERSON_STATUS.ACTIVE },
    { id: 'bridge', type: TYPES.COMPANY, personStatus: PERSON_STATUS.ACTIVE },
    { id: 'cold', type: TYPES.PERSON, personStatus: PERSON_STATUS.DECEASED },
  ];
  const links = [
    { source: 'seed', target: 'bridge', kind: 'patron' },
    { source: 'seed', target: 'cold', kind: 'relation' },
  ];

  const scores = calculateHvtScores(nodes, links, {
    types: TYPES,
    personStatus: PERSON_STATUS,
    normalizePersonStatus: (status) => status,
  });

  const topIds = selectHvtTopIds(nodes, scores, 1);
  assert.deepEqual(topIds, ['seed']);
  assert.ok(scores.find((entry) => entry.id === 'seed').score > scores.find((entry) => entry.id === 'cold').score);
});

test('calculateHvtScores penalizes inactive nodes like deceased nodes', async () => {
  const { calculateHvtScores } = await import('../shared/js/hvt-graph.mjs');

  const TYPES = { PERSON: 'person', COMPANY: 'company', GROUP: 'group' };
  const PERSON_STATUS = { ACTIVE: 'active', INACTIVE: 'inactive', MISSING: 'missing', DECEASED: 'deceased' };
  const nodes = [
    { id: 'active', type: TYPES.PERSON, personStatus: PERSON_STATUS.ACTIVE },
    { id: 'inactive', type: TYPES.PERSON, personStatus: PERSON_STATUS.INACTIVE },
    { id: 'deceased', type: TYPES.PERSON, personStatus: PERSON_STATUS.DECEASED },
  ];
  const links = [
    { source: 'active', target: 'inactive', kind: 'relation' },
    { source: 'active', target: 'deceased', kind: 'relation' },
  ];

  const scores = calculateHvtScores(nodes, links, {
    types: TYPES,
    personStatus: PERSON_STATUS,
    normalizePersonStatus: (status) => status,
  });

  const activeScore = scores.find((entry) => entry.id === 'active').score;
  const inactiveScore = scores.find((entry) => entry.id === 'inactive').score;
  const deceasedScore = scores.find((entry) => entry.id === 'deceased').score;

  assert.ok(activeScore > inactiveScore);
  assert.ok(Math.abs(inactiveScore - deceasedScore) < 1e-9);
});

test('calculateHvtInfluence propagates important color through the graph', async () => {
  const { calculateHvtInfluence } = await import('../shared/js/hvt-graph.mjs');

  const nodes = [
    { id: 'seed', color: '#ff0000' },
    { id: 'relay', color: '#ffffff' },
    { id: 'tail', color: '#ffffff' },
  ];
  const links = [
    { source: 'seed', target: 'relay', kind: 'patron' },
    { source: 'relay', target: 'tail', kind: 'relation' },
  ];
  const scores = [
    { id: 'seed', score: 0.92 },
    { id: 'relay', score: 0.41 },
    { id: 'tail', score: 0.2 },
  ];

  const result = calculateHvtInfluence(nodes, links, {
    scores,
    topIds: ['seed'],
    sanitizeColor: (color) => String(color || '#66f3ff'),
    hexToRgb,
    rgbToHex,
  });

  assert.ok(result.nodes[1].influence > 0.3);
  assert.ok(result.nodes[2].influence > 0.1);
  assert.equal(result.nodes[1].tintColor, '#ff0000');
  assert.equal(result.nodes[2].tintColor, '#ff0000');
  assert.ok(result.links[0] > 0.5);
  assert.ok(result.links[1] > 0.1);
});
