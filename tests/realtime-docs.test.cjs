const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function loadModule(relativePath) {
    const targetPath = path.resolve(__dirname, '..', relativePath);
    return import(pathToFileURL(targetPath).href);
}

test('point realtime ops rebuild the target snapshot', async () => {
    const {
        canonicalizePointPayload,
        diffPointOps,
        applyPointOps
    } = await loadModule('shared/realtime/point-doc.mjs');

    const previous = {
        meta: { projectName: 'Avant' },
        physicsSettings: { repulsion: 0.6 },
        nodes: [
            { id: 'n1', name: 'Alpha', type: 'person', x: 10, y: 20, description: 'old' },
            { id: 'n2', name: 'Bravo', type: 'company', x: 30, y: 40 }
        ],
        links: [
            { id: 'l1', source: 'n1', target: 'n2', kind: 'ami' }
        ]
    };
    const next = {
        meta: { projectName: 'Apres' },
        physicsSettings: { repulsion: 0.9 },
        nodes: [
            { id: 'n1', name: 'Alpha Prime', type: 'person', x: 11, y: 22, description: 'new' },
            { id: 'n3', name: 'Charlie', type: 'group', x: 50, y: 60, notes: 'note' }
        ],
        links: [
            { id: 'l2', source: 'n1', target: 'n3', kind: 'collegue' }
        ]
    };

    const ops = diffPointOps(previous, next);
    assert.ok(ops.length > 0);
    assert.deepStrictEqual(
        applyPointOps(previous, ops),
        canonicalizePointPayload(next)
    );
});

test('point realtime delete_node also removes dangling links', async () => {
    const { applyPointOps } = await loadModule('shared/realtime/point-doc.mjs');

    const previous = {
        nodes: [
            { id: 'n1', name: 'Alpha', type: 'person' },
            { id: 'n2', name: 'Bravo', type: 'person' }
        ],
        links: [
            { id: 'l1', source: 'n1', target: 'n2', kind: 'ami' }
        ]
    };

    const next = applyPointOps(previous, [{ type: 'delete_node', id: 'n2' }]);
    assert.equal(next.nodes.length, 1);
    assert.equal(next.links.length, 0);
});

test('map realtime ops rebuild the target snapshot', async () => {
    const {
        canonicalizeMapPayload,
        diffMapOps,
        applyMapOps
    } = await loadModule('shared/realtime/map-doc.mjs');

    const previous = {
        meta: { date: '2026-03-11T10:00:00.000Z', version: '2.5' },
        groups: [
            {
                id: 'g1',
                name: 'Allies',
                color: '#73fbf7',
                visible: true,
                points: [{ id: 'p1', name: 'A', x: 10, y: 20, type: 'unit', iconType: 'DEFAULT', notes: '', status: 'ACTIVE' }],
                zones: []
            }
        ],
        tacticalLinks: []
    };
    const next = {
        meta: { date: '2026-03-11T10:05:00.000Z', version: '2.5' },
        groups: [
            {
                id: 'g1',
                name: 'Allies',
                color: '#73fbf7',
                visible: true,
                points: [{ id: 'p1', name: 'A1', x: 15, y: 25, type: 'unit', iconType: 'DEFAULT', notes: 'moved', status: 'ACTIVE' }],
                zones: []
            },
            {
                id: 'g2',
                name: 'Hostiles',
                color: '#ff6b81',
                visible: true,
                points: [{ id: 'p2', name: 'B', x: 60, y: 70, type: 'unit', iconType: 'DEFAULT', notes: '', status: 'ACTIVE' }],
                zones: []
            }
        ],
        tacticalLinks: [
            { id: 'tl1', from: 'p1', to: 'p2', type: 'Standard', color: null }
        ]
    };

    const ops = diffMapOps(previous, next);
    assert.ok(ops.length > 0);
    assert.deepStrictEqual(
        applyMapOps(previous, ops),
        canonicalizeMapPayload(next)
    );
});
