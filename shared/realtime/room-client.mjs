import {
    REALTIME_MSG_ERROR,
    REALTIME_MSG_HELLO,
    REALTIME_MSG_HELLO_ACK,
    REALTIME_MSG_OPS,
    REALTIME_MSG_PRESENCE,
    REALTIME_MSG_SNAPSHOT_REQUEST,
    REALTIME_MSG_Y_SUBSCRIBE,
    REALTIME_MSG_Y_UPDATE,
    REALTIME_STATUS_CLOSED,
    REALTIME_STATUS_CONNECTED,
    REALTIME_STATUS_CONNECTING,
    REALTIME_STATUS_ERROR,
    REALTIME_STATUS_IDLE,
    makeRealtimeEnvelope
} from './protocol.mjs';

export class RealtimeRoomClient {
    constructor(options = {}) {
        this.boardId = String(options.boardId || '').trim();
        this.page = String(options.page || '').trim();
        this.token = String(options.token || '').trim();
        this.url = String(options.url || '').trim();
        this.onSnapshot = typeof options.onSnapshot === 'function' ? options.onSnapshot : () => {};
        this.onRemoteOps = typeof options.onRemoteOps === 'function' ? options.onRemoteOps : () => {};
        this.onPresence = typeof options.onPresence === 'function' ? options.onPresence : () => {};
        this.onStatus = typeof options.onStatus === 'function' ? options.onStatus : () => {};
        this.onError = typeof options.onError === 'function' ? options.onError : () => {};
        this.onClose = typeof options.onClose === 'function' ? options.onClose : () => {};
        this.onTextUpdate = typeof options.onTextUpdate === 'function' ? options.onTextUpdate : () => {};

        this.socket = null;
        this.status = REALTIME_STATUS_IDLE;
        this.serverSeq = 0;
        this.clientId = '';
        this.pendingMessages = [];
    }

    setStatus(nextStatus, detail = '') {
        this.status = nextStatus;
        this.onStatus(nextStatus, detail);
    }

    isConnected() {
        return this.status === REALTIME_STATUS_CONNECTED && this.socket && this.socket.readyState === WebSocket.OPEN;
    }

    send(message) {
        const payload = JSON.stringify(message);
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(payload);
            return true;
        }
        this.pendingMessages.push(payload);
        return false;
    }

    flushPendingMessages() {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN || !this.pendingMessages.length) return;
        const queued = [...this.pendingMessages];
        this.pendingMessages = [];
        queued.forEach((message) => this.socket.send(message));
    }

    connect() {
        if (!this.url || !this.token || !this.boardId || !this.page) {
            throw new Error('Configuration realtime incomplete.');
        }
        if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
            return this;
        }

        this.setStatus(REALTIME_STATUS_CONNECTING);
        this.socket = new WebSocket(this.url);

        this.socket.addEventListener('open', () => {
            this.send(makeRealtimeEnvelope(REALTIME_MSG_HELLO, {
                token: this.token,
                boardId: this.boardId,
                page: this.page,
                lastServerSeq: this.serverSeq
            }));
        });

        this.socket.addEventListener('message', (event) => {
            let message = null;
            try {
                message = JSON.parse(event.data);
            } catch (error) {
                this.onError(new Error('Message realtime invalide.'));
                return;
            }

            const type = String(message?.type || '');
            if (type === REALTIME_MSG_HELLO_ACK) {
                this.clientId = String(message.clientId || '');
                this.serverSeq = Number(message.serverSeq || 0);
                this.setStatus(REALTIME_STATUS_CONNECTED);
                this.onSnapshot(message.snapshot || null, {
                    serverSeq: this.serverSeq,
                    role: String(message.role || ''),
                    initial: true
                });
                this.onPresence(Array.isArray(message.presence) ? message.presence : []);
                this.flushPendingMessages();
                return;
            }

            if (type === REALTIME_MSG_OPS) {
                this.serverSeq = Math.max(this.serverSeq, Number(message.serverSeq || 0));
                this.onRemoteOps(Array.isArray(message.ops) ? message.ops : [], {
                    serverSeq: this.serverSeq,
                    senderClientId: String(message.senderClientId || ''),
                    actor: message.actor || null
                });
                return;
            }

            if (type === REALTIME_MSG_PRESENCE) {
                this.onPresence(Array.isArray(message.presence) ? message.presence : []);
                return;
            }

            if (type === REALTIME_MSG_ERROR) {
                const error = new Error(String(message.message || 'Erreur realtime.'));
                this.onError(error);
                return;
            }

            if (type === REALTIME_MSG_Y_UPDATE) {
                this.onTextUpdate({
                    key: String(message.key || ''),
                    update: String(message.update || ''),
                    full: Boolean(message.full),
                    actor: message.actor || null
                });
            }
        });

        this.socket.addEventListener('close', (event) => {
            const wasConnected = this.status === REALTIME_STATUS_CONNECTED;
            this.socket = null;
            this.setStatus(REALTIME_STATUS_CLOSED, event?.reason || '');
            this.onClose({
                code: Number(event?.code || 0),
                reason: String(event?.reason || ''),
                wasConnected
            });
        });

        this.socket.addEventListener('error', () => {
            this.setStatus(REALTIME_STATUS_ERROR);
        });

        return this;
    }

    disconnect(code = 1000, reason = 'client-close') {
        if (this.socket) {
            this.socket.close(code, reason);
        }
        this.socket = null;
        this.pendingMessages = [];
        this.setStatus(REALTIME_STATUS_CLOSED, reason);
    }

    requestSnapshot() {
        this.send(makeRealtimeEnvelope(REALTIME_MSG_SNAPSHOT_REQUEST));
    }

    sendOps(ops = [], metadata = {}) {
        if (!Array.isArray(ops) || !ops.length) return false;
        return this.send(makeRealtimeEnvelope(REALTIME_MSG_OPS, {
            ops,
            clientSeq: Number(metadata.clientSeq || 0)
        }));
    }

    updatePresence(presence = {}) {
        return this.send(makeRealtimeEnvelope(REALTIME_MSG_PRESENCE, {
            presence: presence && typeof presence === 'object' ? presence : {}
        }));
    }

    subscribeText(key) {
        const cleanKey = String(key || '').trim();
        if (!cleanKey) return false;
        return this.send(makeRealtimeEnvelope(REALTIME_MSG_Y_SUBSCRIBE, {
            key: cleanKey
        }));
    }

    sendTextUpdate(key, update) {
        const cleanKey = String(key || '').trim();
        const cleanUpdate = String(update || '').trim();
        if (!cleanKey || !cleanUpdate) return false;
        return this.send(makeRealtimeEnvelope(REALTIME_MSG_Y_UPDATE, {
            key: cleanKey,
            update: cleanUpdate
        }));
    }
}
