import * as Y from '../vendor/yjs.mjs';

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
    const onSelectionChange = typeof options.onSelectionChange === 'function' ? options.onSelectionChange : () => {};
    const initialValue = String(options.initialValue || '');
    const localSendDebounceMs = Math.max(40, Number(options.localSendDebounceMs) || 160);
    let { doc, text } = createYTextDoc('');
    let displayValue = initialValue;
    let hasServerState = false;
    let pendingRemoteUpdates = [];

    let activeField = null;
    let detachFieldListener = null;
    let suppressFieldEvent = false;
    let pendingRemoteSelection = null;
    let suppressRemoteHandleText = false;
    let localSendTimer = null;
    let lastFlushedStateVector = Y.encodeStateVector(doc);

    const clearLocalSendTimer = () => {
        if (!localSendTimer) return;
        clearTimeout(localSendTimer);
        localSendTimer = null;
    };

    const flushPendingLocalUpdates = () => {
        clearLocalSendTimer();
        if (!hasServerState || !(lastFlushedStateVector instanceof Uint8Array)) return false;
        const nextUpdate = Y.encodeStateAsUpdate(doc, lastFlushedStateVector);
        if (!(nextUpdate instanceof Uint8Array) || !nextUpdate.length) return false;
        lastFlushedStateVector = Y.encodeStateVector(doc);
        onSendUpdate(key, encodeYUpdate(nextUpdate));
        return true;
    };

    const queueLocalUpdate = () => {
        if (!hasServerState) return false;
        clearLocalSendTimer();
        localSendTimer = setTimeout(() => {
            localSendTimer = null;
            flushPendingLocalUpdates();
        }, localSendDebounceMs);
        return true;
    };

    const captureFieldSelection = (field) => {
        if (!field || document.activeElement !== field || !hasServerState) return null;
        const selectionStart = typeof field.selectionStart === 'number'
            ? field.selectionStart
            : displayValue.length;
        const selectionEnd = typeof field.selectionEnd === 'number'
            ? field.selectionEnd
            : selectionStart;
        return {
            start: Y.createRelativePositionFromTypeIndex(text, Math.max(0, selectionStart), -1),
            end: Y.createRelativePositionFromTypeIndex(text, Math.max(0, selectionEnd), -1),
            direction: field.selectionDirection || 'none'
        };
    };

    const resolveSelectionIndex = (relativePosition, fallback = 0) => {
        const absolute = relativePosition
            ? Y.createAbsolutePositionFromRelativePosition(relativePosition, doc)
            : null;
        if (!absolute || absolute.type !== text || !Number.isFinite(absolute.index)) {
            return Math.max(0, Math.min(displayValue.length, Number(fallback) || 0));
        }
        return Math.max(0, Math.min(displayValue.length, Number(absolute.index) || 0));
    };

    const syncFieldValue = (field, selection = null) => {
        if (!field) return;
        const nextValue = displayValue;
        const shouldRestoreSelection = document.activeElement === field;
        suppressFieldEvent = true;
        field.value = nextValue;
        field.readOnly = !hasServerState || !canEdit();
        suppressFieldEvent = false;
        if (shouldRestoreSelection && typeof field.setSelectionRange === 'function') {
            const nextPos = selection
                ? resolveSelectionIndex(selection.start, field.selectionStart ?? nextValue.length)
                : Math.min(nextValue.length, field.selectionStart ?? nextValue.length);
            const nextEnd = selection
                ? resolveSelectionIndex(selection.end, field.selectionEnd ?? nextPos)
                : Math.min(nextValue.length, field.selectionEnd ?? nextPos);
            const selectionDirection = selection?.direction || field.selectionDirection || 'none';
            try {
                field.setSelectionRange(nextPos, nextEnd, selectionDirection);
            } catch (error) {}
        }
    };

    const handleTextChange = (origin = 'remote', selection = null) => {
        const nextValue = text.toString();
        displayValue = nextValue;
        if (activeField) {
            if (origin === 'local') {
                activeField.readOnly = !hasServerState || !canEdit();
            } else {
                syncFieldValue(activeField, selection);
            }
        }
        onValueChange(nextValue, { origin });
    };

    const emitSelectionChange = (field, options = {}) => {
        if (!field) {
            onSelectionChange({
                key,
                active: false,
                selectionStart: null,
                selectionEnd: null,
                selectionDirection: 'none'
            });
            return;
        }
        const isActive = options.active !== false;
        const selectionStart = typeof field.selectionStart === 'number' ? field.selectionStart : null;
        const selectionEnd = typeof field.selectionEnd === 'number' ? field.selectionEnd : selectionStart;
        onSelectionChange({
            key,
            active: isActive,
            selectionStart,
            selectionEnd,
            selectionDirection: typeof field.selectionDirection === 'string' ? field.selectionDirection : 'none'
        });
    };

    const handleDocUpdate = (update, origin) => {
        if (origin === 'remote-text-update' || origin === 'remote-text-state') {
            if (suppressRemoteHandleText) return;
            const selection = pendingRemoteSelection;
            pendingRemoteSelection = null;
            handleTextChange('remote', selection);
            return;
        }
        if (origin === 'local-text-input') {
            queueLocalUpdate();
            handleTextChange('local');
            return;
        }
        handleTextChange('local');
    };

    doc.on('update', handleDocUpdate);

    const replaceDocState = (encodedUpdate) => {
        const selection = captureFieldSelection(activeField);
        const nextState = createYTextDoc('');
        const applied = applyYUpdate(nextState.doc, encodedUpdate, 'remote-text-state');
        if (!applied) {
            nextState.doc.destroy();
            return false;
        }
        doc.off('update', handleDocUpdate);
        doc.destroy();
        doc = nextState.doc;
        text = nextState.text;
        hasServerState = true;
        doc.on('update', handleDocUpdate);
        if (pendingRemoteUpdates.length) {
            const queuedUpdates = [...pendingRemoteUpdates];
            pendingRemoteUpdates = [];
            suppressRemoteHandleText = true;
            queuedUpdates.forEach((queuedUpdate) => {
                applyYUpdate(doc, queuedUpdate, 'remote-text-update');
            });
            suppressRemoteHandleText = false;
        }
        lastFlushedStateVector = Y.encodeStateVector(doc);
        handleTextChange('remote', selection);
        return true;
    };

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
            if (!hasServerState) {
                syncFieldValue(field);
                return;
            }
            doc.transact(() => {
                replaceYTextContent(text, field.value);
            }, 'local-text-input');
            emitSelectionChange(field, { active: true });
        };

        const onFocus = () => {
            onFocusChange({
                key,
                active: true
            });
            emitSelectionChange(field, { active: true });
        };

        const onBlur = () => {
            flushPendingLocalUpdates();
            onFocusChange({
                key,
                active: false
            });
            emitSelectionChange(field, { active: false });
        };

        const onSelectionEvent = () => {
            emitSelectionChange(field, { active: document.activeElement === field });
        };

        field.addEventListener('input', onInput);
        field.addEventListener('focus', onFocus);
        field.addEventListener('blur', onBlur);
        field.addEventListener('select', onSelectionEvent);
        field.addEventListener('keyup', onSelectionEvent);
        field.addEventListener('mouseup', onSelectionEvent);
        detachFieldListener = () => {
            field.removeEventListener('input', onInput);
            field.removeEventListener('focus', onFocus);
            field.removeEventListener('blur', onBlur);
            field.removeEventListener('select', onSelectionEvent);
            field.removeEventListener('keyup', onSelectionEvent);
            field.removeEventListener('mouseup', onSelectionEvent);
            if (activeField === field) {
                activeField = null;
            }
            detachFieldListener = null;
        };
        return detachFieldListener;
    };

    return {
        key,
        get doc() {
            return doc;
        },
        get text() {
            return text;
        },
        attachField,
        attachTextarea: attachField,
        stop() {
            flushPendingLocalUpdates();
            if (activeField) {
                onFocusChange({
                    key,
                    active: false
                });
                emitSelectionChange(activeField, { active: false });
            }
            if (detachFieldListener) detachFieldListener();
            doc.off('update', handleDocUpdate);
            doc.destroy();
        },
        applyRemoteUpdate(encodedUpdate, options = {}) {
            if (options.full) {
                return replaceDocState(encodedUpdate);
            }
            if (!hasServerState) {
                pendingRemoteUpdates.push(String(encodedUpdate || ''));
                if (pendingRemoteUpdates.length > 48) {
                    pendingRemoteUpdates = pendingRemoteUpdates.slice(-48);
                }
                return true;
            }
            pendingRemoteSelection = captureFieldSelection(activeField);
            return applyYUpdate(doc, encodedUpdate, 'remote-text-update');
        },
        replaceLocalValue(nextValue) {
            displayValue = String(nextValue || '');
            if (!hasServerState) return;
            doc.transact(() => {
                replaceYTextContent(text, displayValue);
            }, 'local-text-input');
        },
        getValue() {
            return displayValue;
        }
    };
}

export function createTextareaYTextBinding(options = {}) {
    return createTextFieldYBinding(options);
}
