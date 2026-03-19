const test = require('node:test');
const assert = require('node:assert/strict');

const { hashPassword } = require('../netlify/lib/collab.js');
const { __test } = require('../netlify/functions/collab-auth.js');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class MemoryStore {
  constructor() {
    this.values = new Map();
  }

  async setJSON(key, value) {
    this.values.set(String(key), clone(value));
  }

  async get(key) {
    if (!this.values.has(String(key))) return null;
    return clone(this.values.get(String(key)));
  }

  async delete(key) {
    this.values.delete(String(key));
  }
}

test('updateUserProfile renomme le compte et propage le pseudo dans les boards', async () => {
  const store = new MemoryStore();
  const user = {
    id: 'usr_alpha',
    username: 'alpha.team',
    passwordHash: hashPassword('secret-1'),
    createdAt: '2026-03-19T10:00:00.000Z',
  };

  await store.setJSON(`users/${user.id}`, user);
  await store.setJSON('users/by-name/alpha.team', { userId: user.id, username: 'alpha.team' });
  await store.setJSON(`user-boards/${user.id}`, {
    boardIds: ['board_owner', 'board_member'],
    hydrated: true,
  });
  await store.setJSON('boards/board_owner', {
    id: 'board_owner',
    ownerId: user.id,
    ownerName: 'alpha.team',
    members: [
      { userId: user.id, username: 'alpha.team', role: 'owner' },
      { userId: 'usr_bravo', username: 'bravo.ops', role: 'editor' },
    ],
    lastEditedBy: {
      userId: user.id,
      username: 'alpha.team',
      at: '2026-03-19T10:05:00.000Z',
    },
  });
  await store.setJSON('boards/board_member', {
    id: 'board_member',
    ownerId: 'usr_bravo',
    ownerName: 'bravo.ops',
    members: [
      { userId: user.id, username: 'alpha.team', role: 'editor' },
      { userId: 'usr_bravo', username: 'bravo.ops', role: 'owner' },
    ],
    lastEditedBy: {
      userId: 'usr_bravo',
      username: 'bravo.ops',
      at: '2026-03-19T10:04:00.000Z',
    },
  });

  const result = await __test.updateUserProfile(store, user, {
    currentPassword: 'secret-1',
    nextUsername: 'alpha.north',
  });

  assert.equal(result.usernameChanged, true);
  assert.equal(result.passwordChanged, false);
  assert.equal(result.user.username, 'alpha.north');

  assert.equal(await store.get('users/by-name/alpha.team'), null);
  assert.deepEqual(await store.get('users/by-name/alpha.north'), {
    userId: user.id,
    username: 'alpha.north',
  });

  const savedUser = await store.get(`users/${user.id}`);
  assert.equal(savedUser.username, 'alpha.north');

  const ownerBoard = await store.get('boards/board_owner');
  assert.equal(ownerBoard.ownerName, 'alpha.north');
  assert.equal(ownerBoard.members[0].username, 'alpha.north');
  assert.equal(ownerBoard.lastEditedBy.username, 'alpha.north');

  const memberBoard = await store.get('boards/board_member');
  assert.equal(memberBoard.ownerName, 'bravo.ops');
  assert.equal(memberBoard.members[0].username, 'alpha.north');
});

test('updateUserProfile change le mot de passe et rejette un mot de passe actuel invalide', async () => {
  const store = new MemoryStore();
  const user = {
    id: 'usr_delta',
    username: 'delta.ops',
    passwordHash: hashPassword('old-secret'),
    createdAt: '2026-03-19T10:00:00.000Z',
  };

  await store.setJSON(`users/${user.id}`, user);
  await store.setJSON('users/by-name/delta.ops', { userId: user.id, username: 'delta.ops' });

  await assert.rejects(
    () => __test.updateUserProfile(store, user, {
      currentPassword: 'bad-secret',
      nextPassword: 'new-secret',
    }),
    (error) => error?.statusCode === 401 && /Mot de passe actuel invalide/i.test(String(error.message || ''))
  );

  const result = await __test.updateUserProfile(store, user, {
    currentPassword: 'old-secret',
    nextPassword: 'new-secret',
  });

  assert.equal(result.usernameChanged, false);
  assert.equal(result.passwordChanged, true);

  const savedUser = await store.get(`users/${user.id}`);
  assert.equal(savedUser.passwordHash, hashPassword('new-secret'));
});
