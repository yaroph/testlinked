import * as Y from '../../node_modules/yjs/dist/yjs.mjs';

const POINT_TEXT_FIELD_ALIASES = {
    name: 'name',
    num: 'num',
    accountnumber: 'accountNumber',
    citizennumber: 'citizenNumber',
    linkedmappointid: 'linkedMapPointId',
    description: 'description',
    notes: 'description'
};

const MAP_TEXT_FIELDS = {
    group: new Set(['name']),
    point: new Set(['name', 'type', 'notes']),
    zone: new Set(['name'])
};

function toBase64(bytes) {
    if (!(bytes instanceof Uint8Array)) return '';
    if (typeof Buffer !== 'undefined') {
        return Buffer.from(bytes).toString('base64');
    }
    let binary = '';
    bytes.forEach((value) => {
        binary += String.fromCharCode(value);
    });
    return btoa(binary);
}

function fromBase64(value) {
    const encoded = String(value || '').trim();
    if (!encoded) return new Uint8Array();
    if (typeof Buffer !== 'undefined') {
        return new Uint8Array(Buffer.from(encoded, 'base64'));
    }
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
}

function normalizePointTextFieldName(fieldName) {
    const normalized = String(fieldName || 'description').trim().toLowerCase();
    if (!normalized) return 'description';
    return String(POINT_TEXT_FIELD_ALIASES[normalized] || '').trim();
}

function normalizeMapEntityType(entityType) {
    const normalized = String(entityType || '').trim().toLowerCase();
    if (normalized === 'group' || normalized === 'point' || normalized === 'zone') return normalized;
    return '';
}

function normalizeMapTextFieldName(entityType, fieldName) {
    const type = normalizeMapEntityType(entityType);
    if (!type) return '';
    const normalized = String(fieldName || '').trim().toLowerCase();
    if (!normalized) return '';
    return MAP_TEXT_FIELDS[type]?.has(normalized) ? normalized : '';
}

export function makePointTextKey(nodeId, fieldName = 'description') {
    const cleanNodeId = String(nodeId || '').trim();
    const normalizedField = normalizePointTextFieldName(fieldName);
    if (!cleanNodeId || !normalizedField) return '';
    return `node:${cleanNodeId}:${normalizedField}`;
}

export function parsePointTextKey(key) {
    const match = String(key || '').trim().match(/^node:([^:]+):([^:]+)$/);
    if (!match) return null;
    const nodeId = String(match[1] || '').trim();
    const fieldName = normalizePointTextFieldName(match[2] || 'description');
    if (!nodeId || !fieldName) return null;
    return {
        nodeId,
        fieldName
    };
}

export function makeMapTextKey(entityType, entityId, fieldName) {
    const cleanEntityType = normalizeMapEntityType(entityType);
    const cleanEntityId = String(entityId || '').trim();
    const cleanFieldName = normalizeMapTextFieldName(cleanEntityType, fieldName);
    if (!cleanEntityType || !cleanEntityId || !cleanFieldName) return '';
    return `map:${cleanEntityType}:${cleanEntityId}:${cleanFieldName}`;
}

export function parseMapTextKey(key) {
    const match = String(key || '').trim().match(/^map:(group|point|zone):([^:]+):([^:]+)$/);
    if (!match) return null;
    const entityType = normalizeMapEntityType(match[1] || '');
    const entityId = String(match[2] || '').trim();
    const fieldName = normalizeMapTextFieldName(entityType, match[3] || '');
    if (!entityType || !entityId || !fieldName) return null;
    return {
        entityType,
        entityId,
        fieldName
    };
}

export function encodeYUpdate(update) {
    return toBase64(update instanceof Uint8Array ? update : new Uint8Array());
}

export function decodeYUpdate(encodedUpdate) {
    return fromBase64(encodedUpdate);
}

export function createYTextDoc(initialValue = '') {
    const doc = new Y.Doc();
    const text = doc.getText('content');
    const value = String(initialValue || '');
    if (value) {
        text.insert(0, value);
    }
    return {
        doc,
        text
    };
}

export function replaceYTextContent(ytext, nextValue = '') {
    if (!ytext || typeof ytext.toString !== 'function') return false;
    const currentValue = ytext.toString();
    const targetValue = String(nextValue || '');
    if (currentValue === targetValue) return false;

    let start = 0;
    while (start < currentValue.length && start < targetValue.length && currentValue[start] === targetValue[start]) {
        start += 1;
    }

    let currentEnd = currentValue.length;
    let targetEnd = targetValue.length;
    while (
        currentEnd > start &&
        targetEnd > start &&
        currentValue[currentEnd - 1] === targetValue[targetEnd - 1]
    ) {
        currentEnd -= 1;
        targetEnd -= 1;
    }

    if (currentEnd > start) {
        ytext.delete(start, currentEnd - start);
    }
    if (targetEnd > start) {
        ytext.insert(start, targetValue.slice(start, targetEnd));
    }
    return true;
}

export function applyYUpdate(doc, encodedUpdate, origin = 'remote-text-update') {
    const update = decodeYUpdate(encodedUpdate);
    if (!update.length) return false;
    Y.applyUpdate(doc, update, origin);
    return true;
}

export function encodeYState(doc) {
    return encodeYUpdate(Y.encodeStateAsUpdate(doc));
}

export function createTextFieldYBinding(options = {}) {
    const key = String(options.key || '').trim();
    const onSendUpdate = typeof options.onSendUpdate === 'function' ? options.onSendUpdate : () => {};
    const onValueChange = typeof options.onValueChange === 'function' ? options.onValueChange : () => {};
    const canEdit = typeof options.canEdit === 'function' ? options.canEdit : () => true;
    const onFocusChange = typeof options.onFocusChange === 'function' ? options.onFocusChange : () => {};
    const initialValue = String(options.initialValue || '');
    const { doc, text } = createYTextDoc(initialValue);

    let activeField = null;
    let detachFieldListener = null;
    let suppressFieldEvent = false;

    const syncFieldValue = (field) => {
        if (!field) return;
        const nextValue = text.toString();
        const shouldRestoreSelection = document.activeElement === field;
        const selectionStart = shouldRestoreSelection && typeof field.selectionStart === 'number'
            ? field.selectionStart
            : null;
        const selectionEnd = shouldRestoreSelection && typeof field.selectionEnd === 'number'
            ? field.selectionEnd
            : null;
        const selectionDirection = shouldRestoreSelection ? field.selectionDirection || 'none' : 'none';
        suppressFieldEvent = true;
        field.value = nextValue;
        field.readOnly = !canEdit();
        suppressFieldEvent = false;
        if (shouldRestoreSelection && typeof field.setSelectionRange === 'function') {
            const nextPos = Math.min(nextValue.length, selectionStart ?? nextValue.length);
            const nextEnd = Math.min(nextValue.length, selectionEnd ?? nextPos);
            try {
                field.setSelectionRange(nextPos, nextEnd, selectionDirection);
            } catch (error) {}
        }
    };

    const handleTextChange = (origin = 'remote') => {
        const nextValue = text.toString();
        if (activeField) syncFieldValue(activeField);
        onValueChange(nextValue, { origin });
    };

    doc.on('update', (update, origin) => {
        if (origin === 'remote-text-update' || origin === 'remote-text-state') {
            handleTextChange('remote');
            return;
        }
        if (origin === 'local-text-input') {
            onSendUpdate(key, encodeYUpdate(update));
            handleTextChange('local');
            return;
        }
        handleTextChange('local');
    });

    const attachField = (field) => {
        if (!field) return () => {};
        if (detachFieldListener) detachFieldListener();
        activeField = field;
        syncFieldValue(field);

        const onInput = () => {
            if (suppressFieldEvent) return;
            if (!canEdit()) {
                syncFieldValue(field);
                return;
            }
            doc.transact(() => {
                replaceYTextContent(text, field.value);
            }, 'local-text-input');
        };

        const onFocus = () => {
            onFocusChange({
                key,
                active: true
            });
        };

        const onBlur = () => {
            onFocusChange({
                key,
                active: false
            });
        };

        field.addEventListener('input', onInput);
        field.addEventListener('focus', onFocus);
        field.addEventListener('blur', onBlur);
        detachFieldListener = () => {
            field.removeEventListener('input', onInput);
            field.removeEventListener('focus', onFocus);
            field.removeEventListener('blur', onBlur);
            if (activeField === field) {
                activeField = null;
            }
            detachFieldListener = null;
        };
        return detachFieldListener;
    };

    return {
        key,
        doc,
        text,
        attachField,
        attachTextarea: attachField,
        stop() {
            if (activeField) {
                onFocusChange({
                    key,
                    active: false
                });
            }
            if (detachFieldListener) detachFieldListener();
        },
        applyRemoteUpdate(encodedUpdate, options = {}) {
            const origin = options.full ? 'remote-text-state' : 'remote-text-update';
            return applyYUpdate(doc, encodedUpdate, origin);
        },
        replaceLocalValue(nextValue) {
            doc.transact(() => {
                replaceYTextContent(text, nextValue);
            }, 'local-text-input');
        },
        getValue() {
            return text.toString();
        }
    };
}

export function createTextareaYTextBinding(options = {}) {
    return createTextFieldYBinding(options);
}
