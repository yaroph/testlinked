const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function loadModule(relativePath) {
    const targetPath = path.resolve(__dirname, '..', relativePath);
    return import(pathToFileURL(targetPath).href);
}

test('point text keys normalize notes to description', async () => {
    const { makePointTextKey, parsePointTextKey } = await loadModule('shared/realtime/y-text.mjs');

    assert.equal(makePointTextKey('node-1', 'notes'), 'node:node-1:description');
    assert.deepStrictEqual(parsePointTextKey('node:node-1:notes'), {
        nodeId: 'node-1',
        fieldName: 'description'
    });
    assert.equal(makePointTextKey('node-1', 'name'), 'node:node-1:name');
    assert.deepStrictEqual(parsePointTextKey('node:node-1:citizenNumber'), {
        nodeId: 'node-1',
        fieldName: 'citizenNumber'
    });
});

test('map text keys round-trip for point and zone fields', async () => {
    const { makeMapTextKey, parseMapTextKey } = await loadModule('shared/realtime/y-text.mjs');

    assert.equal(makeMapTextKey('point', 'pt-1', 'notes'), 'map:point:pt-1:notes');
    assert.deepStrictEqual(parseMapTextKey('map:point:pt-1:notes'), {
        entityType: 'point',
        entityId: 'pt-1',
        fieldName: 'notes'
    });

    assert.equal(makeMapTextKey('zone', 'zn-7', 'name'), 'map:zone:zn-7:name');
    assert.deepStrictEqual(parseMapTextKey('map:zone:zn-7:name'), {
        entityType: 'zone',
        entityId: 'zn-7',
        fieldName: 'name'
    });
});

test('encoded Yjs updates sync text between two docs', async () => {
    const {
        createYTextDoc,
        replaceYTextContent,
        encodeYUpdate,
        encodeYState,
        applyYUpdate
    } = await loadModule('shared/realtime/y-text.mjs');

    const source = createYTextDoc('Bonjour');
    const target = createYTextDoc('');

    assert.equal(applyYUpdate(target.doc, encodeYState(source.doc), 'remote-text-state'), true);
    assert.equal(target.text.toString(), 'Bonjour');

    let encodedUpdate = '';
    source.doc.on('update', (update, origin) => {
        if (origin === 'local-text-input') {
            encodedUpdate = encodeYUpdate(update);
        }
    });

    source.doc.transact(() => {
        replaceYTextContent(source.text, 'Bonjour a tous');
    }, 'local-text-input');

    assert.ok(encodedUpdate);
    assert.equal(applyYUpdate(target.doc, encodedUpdate, 'remote-text-update'), true);
    assert.equal(target.text.toString(), 'Bonjour a tous');
});
