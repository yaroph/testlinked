const test = require('node:test');
const assert = require('node:assert/strict');
const { createNetlifyFixture } = require('./helpers/memory-netlify.cjs');
const TEST_CODE = 'admin-test-code';
const headers = { 'x-staff-code': TEST_CODE };
function setEnv(t, values = {}) {
  const changes = { BNI_LINKED_STAFF_CODE: TEST_CODE, BNI_FIREBASE_DATABASE_URL: '', FIREBASE_DATABASE_URL: '', ...values };
  const previous = Object.fromEntries(Object.keys(changes).map((key) => [key, process.env[key]]));
  Object.assign(process.env, changes);
  t.after(() => { for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  } });
}
function board(id, page = 'point') {
  return { id, title: `Cloud ${id}`, ownerId: `owner-${id}`, ownerName: `user-${id}`, page,
    updatedAt: '2026-09-26T10:00:00.000Z', members: [],
    data: page === 'map' ? { groups: [], tacticalLinks: [] } : { nodes: [], links: [] } };
}

test('Netlify reads both old plain JSON clouds and new wrapped clouds from all owners', async (t) => {
  setEnv(t);
  const api = createNetlifyFixture();
  await api.getStore('bni-linked-collab').setJSON('boards/legacy', board('legacy'));
  await api.getLogicalStore('bni-linked-collab').setJSON('boards/wrapped', board('wrapped', 'map'));
  const res = await api.request('db-boards', { headers });
  assert.equal(res.statusCode, 200);
  assert.equal(res.data.totalFound, 2);
  assert.deepEqual(res.data.entries.map((entry) => entry.ownerName).sort(), ['user-legacy', 'user-wrapped']);
  const details = await api.request('db-boards', { method: 'POST', headers, body: { action: 'get_board_details', boardId: 'legacy' } });
  assert.equal(details.statusCode, 200);
  assert.deepEqual(details.data.board.data.nodes, []);
  const withMetadata = await api.getLogicalStore('bni-linked-collab').getWithMetadata('boards/legacy');
  assert.equal(withMetadata.data.id, 'legacy');
});

for (const provider of ['netlify', 'firebase']) {
  test(`${provider}: every cloud beyond 2000 is reachable across storage and UI pages`, async (t) => {
    setEnv(t, provider === 'firebase' ? { FIREBASE_DATABASE_URL: 'https://test.invalid' } : {});
    const api = createNetlifyFixture();
    const store = api.getLogicalStore('bni-linked-collab');
    for (let i = 0; i < 2005; i++) await store.setJSON(`boards/${i}`, board(String(i)));
    const first = await api.request('db-boards', { headers, query: { limit: '100' } });
    assert.equal(first.statusCode, 200);
    assert.equal(first.data.totalFound, 2005);
    assert.equal(first.data.count, 100);
    assert.equal(first.data.hasMore, true);
    const last = await api.request('db-boards', { headers, query: { limit: '100', offset: '2000' } });
    assert.equal(last.data.count, 5);
    assert.equal(last.data.hasMore, false);
    assert.equal(last.data.nextOffset, 2005);
  });
}

test('global clouds reject normal sessions, legacy staff and anonymous access even in public mode', async (t) => {
  setEnv(t, { BNI_LINKED_REQUIRE_AUTH: '0' });
  const api = createNetlifyFixture();
  for (const denied of [{}, { 'x-staff-code': 'wrong' }, { 'x-staff-code': 'staff' }, { 'x-collab-token': 'ordinary-user' }]) {
    assert.equal((await api.request('db-boards', { headers: denied })).statusCode, 401);
    assert.equal((await api.request('db-boards', { method: 'POST', headers: denied, body: { action: 'get_board_details', boardId: 'private' } })).statusCode, 401);
  }
  assert.equal((await api.request('db-boards', { headers })).statusCode, 200);
});

test('staff code validation and admin operations work without a cloud session', async (t) => {
  setEnv(t, { BNI_LINKED_KEY: 'test-api-key', BNI_LINKED_REQUIRE_AUTH: '1' });
  const api = createNetlifyFixture();
  for (const code of [TEST_CODE, 'staff']) {
    assert.equal((await api.request('alerts', { method: 'POST', body: { action: 'verify-staff', accessCode: code } })).statusCode, 200);
    assert.equal((await api.request('alerts', { method: 'POST', headers: { 'X-Staff-Code': code }, body: { action: 'list-admin' } })).statusCode, 200);
  }
  assert.equal((await api.request('alerts', { method: 'POST', body: { action: 'verify-staff', accessCode: 'wrong' } })).statusCode, 401);
  assert.equal((await api.request('alerts', { method: 'POST', body: { action: 'verify-staff', scope: 'database', accessCode: 'staff' } })).statusCode, 401);
  assert.equal((await api.request('db-boards', { headers: { 'x-api-key': 'test-api-key' } })).statusCode, 200);
});

test('permanent staff code remains valid when a custom code is configured', {
  skip: !process.env.BNI_TEST_PERMANENT_STAFF_CODE,
}, async (t) => {
  setEnv(t, { BNI_LINKED_KEY: 'test-api-key' });
  const api = createNetlifyFixture();
  const permanent = process.env.BNI_TEST_PERMANENT_STAFF_CODE;
  assert.equal((await api.request('alerts', { method: 'POST', body: { action: 'verify-staff', accessCode: permanent } })).statusCode, 200);
  assert.equal((await api.request('alerts', { method: 'POST', headers: { 'x-staff-code': permanent }, body: { action: 'list-admin' } })).statusCode, 200);
  assert.equal((await api.request('db-boards', { headers: { 'x-staff-code': permanent } })).statusCode, 200);
});

test('storage failures fail the whole list instead of silently hiding some clouds', async (t) => {
  setEnv(t);
  const api = createNetlifyFixture();
  const raw = api.getStore('bni-linked-collab');
  await raw.setJSON('boards/failed', board('failed'));
  raw.get = async () => { throw new Error('temporary test outage'); };
  const original = console.error;
  console.error = () => {};
  try { assert.equal((await api.request('db-boards', { headers })).statusCode, 500); }
  finally { console.error = original; }
});
