export const REALTIME_PAGE_POINT = 'point';
export const REALTIME_PAGE_MAP = 'map';

export const REALTIME_MSG_HELLO = 'hello';
export const REALTIME_MSG_HELLO_ACK = 'hello_ack';
export const REALTIME_MSG_OPS = 'ops';
export const REALTIME_MSG_PRESENCE = 'presence';
export const REALTIME_MSG_ERROR = 'error';
export const REALTIME_MSG_SNAPSHOT_REQUEST = 'snapshot_request';
export const REALTIME_MSG_Y_SUBSCRIBE = 'y_subscribe';
export const REALTIME_MSG_Y_UPDATE = 'y_update';

export const REALTIME_STATUS_IDLE = 'idle';
export const REALTIME_STATUS_CONNECTING = 'connecting';
export const REALTIME_STATUS_CONNECTED = 'connected';
export const REALTIME_STATUS_CLOSED = 'closed';
export const REALTIME_STATUS_ERROR = 'error';

export function makeRealtimeEnvelope(type, payload = {}) {
    return {
        type: String(type || '').trim(),
        ...payload
    };
}
