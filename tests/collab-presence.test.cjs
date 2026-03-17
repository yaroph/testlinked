const test = require('node:test');
const assert = require('node:assert/strict');

const { __test } = require('../netlify/functions/collab-board.js');

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

  async list(options = {}) {
    const prefix = String(options?.prefix || '');
    const blobs = [...this.values.keys()]
      .filter((key) => key.startsWith(prefix))
      .sort()
      .map((key) => ({ key }));
    return { blobs, cursor: null };
  }
}

test('listBoardPresence garde une presence active si le meme user a plusieurs clients', async () => {
  const store = new MemoryStore();
  const boardId = 'board_alpha';
  const older = new Date(Date.now() - 1000).toISOString();
  const latest = new Date().toISOString();

  await store.setJSON(`presence/${boardId}/user-1/client-a`, {
    userId: 'user-1',
    username: 'alice',
    role: 'editor',
    boardId,
    activeNodeId: 'node-a',
    activeNodeName: 'Alpha',
    mode: 'editing',
    lastAt: older,
  });
  await store.setJSON(`presence/${boardId}/user-1/client-b`, {
    userId: 'user-1',
    username: 'alice',
    role: 'editor',
    boardId,
    activeNodeId: 'node-b',
    activeNodeName: 'Bravo',
    mode: 'editing',
    lastAt: latest,
  });
  await store.setJSON(`presence/${boardId}/user-2`, {
    userId: 'user-2',
    username: 'bob',
    role: 'viewer',
    boardId,
    activeNodeId: '',
    activeNodeName: '',
    mode: 'viewing',
    lastAt: latest,
  });

  const presence = await __test.listBoardPresence(store, boardId);

  assert.equal(presence.length, 2);
  assert.deepEqual(
    presence.map((entry) => ({
      userId: entry.userId,
      username: entry.username,
      activeNodeId: entry.activeNodeId,
      activeNodeName: entry.activeNodeName,
    })),
    [
      {
        userId: 'user-1',
        username: 'alice',
        activeNodeId: 'node-b',
        activeNodeName: 'Bravo',
      },
      {
        userId: 'user-2',
        username: 'bob',
        activeNodeId: '',
        activeNodeName: '',
      },
    ]
  );
});
