const test = require('node:test');
const assert = require('node:assert/strict');

test('smart search covers descriptive and numeric fields while quick search stays name-only', async () => {
  const { findPointSearchMatches } = await import('../shared/js/point-search.mjs');

  const nodes = [
    {
      id: 'n-alpha',
      name: 'Alpha',
      type: 'person',
      num: '555-1200',
      accountNumber: 'AC-42',
      citizenNumber: 'CIT-900',
      linkedMapPointId: 'MAP-7',
      description: 'Operateur du reseau nord',
      notes: 'Lien direct avec Atlas',
    },
    {
      id: 'n-atlas',
      name: 'Atlas Proxy',
      type: 'group',
      num: '',
      accountNumber: '',
      citizenNumber: '',
      linkedMapPointId: '',
      description: 'Cellule de relais',
      notes: '',
    },
  ];

  const options = {
    typeLabel: (node) => String(node?.type || ''),
    statusLabel: () => 'actif',
  };

  const smartDescription = findPointSearchMatches(nodes, 'reseau nord', { ...options, mode: 'smart' });
  assert.equal(smartDescription[0]?.id, 'n-alpha');

  const smartDigits = findPointSearchMatches(nodes, '1200', { ...options, mode: 'smart' });
  assert.equal(smartDigits[0]?.id, 'n-alpha');

  const quickDescription = findPointSearchMatches(nodes, 'reseau nord', { ...options, mode: 'name' });
  assert.deepEqual(quickDescription, []);

  const quickName = findPointSearchMatches(nodes, 'atlas', { ...options, mode: 'name' });
  assert.equal(quickName[0]?.id, 'n-atlas');
});

test('text search matches token starts but not inner substrings', async () => {
  const { findPointSearchMatches } = await import('../shared/js/point-search.mjs');

  const nodes = [
    {
      id: 'n-good',
      name: 'Corpo West',
      type: 'group',
      num: '',
      accountNumber: '',
      citizenNumber: '',
      linkedMapPointId: '',
      description: 'Equipe corpo secteur sud',
      notes: '',
    },
    {
      id: 'n-bad',
      name: 'Anticorpo Cell',
      type: 'group',
      num: '',
      accountNumber: '',
      citizenNumber: '',
      linkedMapPointId: '',
      description: 'Unite specialisee',
      notes: '',
    },
  ];

  const options = {
    typeLabel: (node) => String(node?.type || ''),
    statusLabel: () => 'actif',
  };

  const matches = findPointSearchMatches(nodes, 'corpo', { ...options, mode: 'smart' });

  assert.deepEqual(matches.map((node) => node.id), ['n-good']);
});
