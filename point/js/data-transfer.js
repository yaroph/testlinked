import { state } from './state.js';

function sanitizeFilenameStem(value) {
    const cleaned = String(value || '')
        .trim()
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
        .replace(/\s+/g, '_')
        .replace(/\.+$/g, '')
        .slice(0, 80);

    return cleaned;
}

export function getAutoProjectName(now = new Date()) {
    const date = now.toISOString().split('T')[0];
    return `reseau_${date}`;
}

export function generateExportData() {
    const nameToSave = state.projectName || getAutoProjectName();
    return {
        meta: {
            date: new Date().toISOString(),
            projectName: nameToSave,
            version: "2.1"
        },
        nodes: state.nodes.map(n => ({
            id: n.id,
            name: n.name,
            type: n.type,
            color: n.color,
            manualColor: Boolean(n.manualColor),
            personStatus: n.personStatus,
            num: n.num,
            accountNumber: n.accountNumber,
            citizenNumber: n.citizenNumber,
            linkedMapPointId: String(n.linkedMapPointId || ''),
            description: n.description,
            notes: n.notes,
            x: n.x,
            y: n.y,
            fixed: n.fixed
        })),
        links: state.links.map(l => ({
            id: l.id,
            source: (typeof l.source === 'object') ? l.source.id : l.source,
            target: (typeof l.target === 'object') ? l.target.id : l.target,
            kind: l.kind
        })),
        physicsSettings: state.physicsSettings
    };
}

export function buildExportFilename(projectName = state.projectName, now = new Date()) {
    const stem = sanitizeFilenameStem(projectName) || getAutoProjectName(now);
    return stem.toLowerCase().endsWith('.json') ? stem : `${stem}.json`;
}

export function downloadExportData(data, fileName = buildExportFilename()) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
}
