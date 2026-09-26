const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Module = require('node:module');

class MemoryStore {
  constructor() { this.values = new Map(); }
  async get(key) { return this.values.has(key) ? structuredClone(this.values.get(key)) : null; }
  async setJSON(key, value) { this.values.set(key, structuredClone(value)); }
  async getWithMetadata(key) {
    const data = await this.get(key);
    return data === null ? null : { data, metadata: null, etag: 'test' };
  }
  async delete(key) { this.values.delete(key); }
  async list({ prefix = '' } = {}) {
    return { blobs: [...this.values.keys()].filter((key) => key.startsWith(prefix)).sort().map((key) => ({ key })) };
  }
}

function createNetlifyFixture() {
  const root = path.resolve(__dirname, '../../netlify');
  const modules = new Map();
  const stores = new Map();
  const firebaseValues = new Map();
  const firebaseDatabase = { ref(key) { return {
    async get() {
      let value = firebaseValues.get(key);
      if (value === undefined) {
        for (const [storedKey, storedValue] of firebaseValues) {
          if (!storedKey.startsWith(key + '/')) continue;
          value ||= {};
          const parts = storedKey.slice(key.length + 1).split('/');
          let target = value;
          for (const part of parts.slice(0, -1)) target = target[part] ||= {};
          target[parts.at(-1)] = structuredClone(storedValue);
        }
      }
      return { exists: () => value !== undefined, val: () => structuredClone(value) };
    },
    async set(value) { firebaseValues.set(key, structuredClone(value)); },
    async remove() { firebaseValues.delete(key); },
  }; } };
  function getStore(options) {
    const name = typeof options === 'string' ? options : options.name;
    if (!stores.has(name)) stores.set(name, new MemoryStore());
    return stores.get(name);
  }
  function load(filename) {
    if (modules.has(filename)) return modules.get(filename).exports;
    const mod = { exports: {} };
    modules.set(filename, mod);
    const localRequire = Module.createRequire(filename);
    const requireStub = (name) => {
      if (name === '@netlify/blobs') return { getStore, connectLambda() {} };
      if (name.startsWith('.')) {
        const resolved = localRequire.resolve(name);
        if (resolved === path.join(root, 'lib', 'firebase-admin.js')) return {
          getFirebaseDatabase: () => firebaseDatabase,
          describeFirebaseConfig: () => ({ provider: 'test' }),
          __test: { resolveFirebaseOptions: () => ({}) },
        };
        if (resolved.startsWith(root + path.sep)) return load(resolved);
      }
      return localRequire(name);
    };
    const run = vm.runInThisContext(Module.wrap(fs.readFileSync(filename, 'utf8')), { filename });
    run(mod.exports, requireStub, mod, filename, path.dirname(filename));
    return mod.exports;
  }
  function handler(name) { return load(path.join(root, 'functions', `${name}.js`)).handler; }
  async function request(name, options = {}) {
    const response = await handler(name)({
      httpMethod: options.method || 'GET', headers: options.headers || {},
      queryStringParameters: options.query || {}, body: JSON.stringify(options.body || {}),
    });
    return { ...response, data: response.body ? JSON.parse(response.body) : null };
  }
  const getLogicalStore = (name) => load(path.join(root, 'lib', 'blob-store.js')).getStore(name);
  return { getStore, getLogicalStore, handler, request };
}
module.exports = { MemoryStore, createNetlifyFixture };
