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
    cursorVisible: true,
    cursorWorldX: 12,
    cursorWorldY: 18,
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
    cursorVisible: true,
    cursorWorldX: 240.5,
    cursorWorldY: -18.25,
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
      cursorVisible: entry.cursorVisible,
      cursorWorldX: entry.cursorWorldX,
      cursorWorldY: entry.cursorWorldY,
    })),
    [
      {
        userId: 'user-1',
        username: 'alice',
        activeNodeId: 'node-b',
        activeNodeName: 'Bravo',
        cursorVisible: true,
        cursorWorldX: 240.5,
        cursorWorldY: -18.25,
      },
      {
        userId: 'user-2',
        username: 'bob',
        activeNodeId: '',
        activeNodeName: '',
        cursorVisible: false,
        cursorWorldX: 0,
        cursorWorldY: 0,
      },
    ]
  );
});

test('touchBoardPresence conserve les coordonnees de curseur partagees', async () => {
  const store = new MemoryStore();
  const board = { id: 'board_cursor' };
  const user = { id: 'user-9', username: 'charlie' };

  const presence = await __test.touchBoardPresence(store, board, user, 'editor', {
    activeNodeId: 'node-9',
    activeNodeName: 'Delta',
    cursorVisible: true,
    cursorWorldX: 88.5,
    cursorWorldY: -42.25,
    cursorMapX: 61.2,
    cursorMapY: 24.4,
  });

  assert.equal(presence.length, 1);
  assert.equal(presence[0].cursorVisible, true);
  assert.equal(presence[0].cursorWorldX, 88.5);
  assert.equal(presence[0].cursorWorldY, -42.25);
  assert.equal(presence[0].cursorMapX, 61.2);
  assert.equal(presence[0].cursorMapY, 24.4);
});
