import process from 'node:process';
import { WebSocket } from 'ws';

import {
    REALTIME_MSG_ERROR,
    REALTIME_MSG_HELLO,
    REALTIME_MSG_HELLO_ACK
} from '../shared/realtime/protocol.mjs';

function readArg(flag) {
    const exact = process.argv.find((value) => value === flag || value.startsWith(`${flag}=`));
    if (!exact) return '';
    if (exact === flag) {
        const index = process.argv.indexOf(flag);
        return String(process.argv[index + 1] || '').trim();
    }
    return String(exact.slice(flag.length + 1) || '').trim();
}

function joinUrl(base, path) {
    const safeBase = String(base || '').trim().replace(/\/+$/, '');
    const safePath = String(path || '').trim().replace(/^\/+/, '');
    return safeBase && safePath ? `${safeBase}/${safePath}` : safeBase || '';
}

function toHttpBase(value = '') {
    return String(value || '').trim().replace(/^ws:/i, 'http:').replace(/^wss:/i, 'https:').replace(/\/+$/, '');
}

function toWsBase(value = '') {
    return String(value || '').trim().replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:').replace(/\/+$/, '');
}

function printUsage() {
    console.error('Usage: npm run realtime:verify -- --site https://bni-linked.netlify.app [--realtime https://realtime.example.com] [--collabToken TOKEN --boardId BOARD --page point|map]');
}

async function fetchJson(url, options = {}) {
    const response = await fetch(url, options);
    let data = null;
    try {
        data = await response.json();
    } catch (error) {}
    return { response, data };
}

async function probeHealth(httpBase) {
    const healthUrl = joinUrl(httpBase, '/health');
    const { response, data } = await fetchJson(healthUrl);
    if (!data) {
        throw new Error(`Healthcheck echoue (${response.status}) sur ${healthUrl}`);
    }
    if (!response.ok || !data.ok) {
        throw new Error(`Healthcheck en erreur sur ${healthUrl}: ${JSON.stringify(data)}`);
    }
    return data;
}

function connectRealtimeSocket({ wsBase, boardId, page, token, timeoutMs }) {
    return new Promise((resolve, reject) => {
        const socketUrl = joinUrl(wsBase, '/ws');
        const socket = new WebSocket(socketUrl);
        const timer = setTimeout(() => {
            socket.close();
            reject(new Error(`Handshake websocket timeout apres ${timeoutMs}ms sur ${socketUrl}`));
        }, timeoutMs);

        function cleanup() {
            clearTimeout(timer);
            socket.removeAllListeners();
        }

        socket.on('open', () => {
            socket.send(JSON.stringify({
                type: REALTIME_MSG_HELLO,
                token,
                boardId,
                page
            }));
        });

        socket.on('message', (raw) => {
            let message = null;
            try {
                message = JSON.parse(String(raw || ''));
            } catch (error) {
                cleanup();
                socket.close();
                reject(new Error(`Message websocket invalide: ${error.message}`));
                return;
            }

            if (message?.type === REALTIME_MSG_HELLO_ACK) {
                cleanup();
                socket.close();
                resolve(message);
                return;
            }

            if (message?.type === REALTIME_MSG_ERROR) {
                cleanup();
                socket.close();
                reject(new Error(String(message.message || 'Erreur realtime.')));
            }
        });

        socket.on('error', (error) => {
            cleanup();
            reject(error);
        });

        socket.on('close', (code, reason) => {
            cleanup();
            reject(new Error(`Connexion websocket fermee trop tot (${code}) ${String(reason || '')}`.trim()));
        });
    });
}

async function main() {
    const siteBase = toHttpBase(readArg('--site') || process.env.BNI_SITE_URL || '');
    if (!siteBase) {
        printUsage();
        process.exitCode = 1;
        return;
    }

    const requestedRealtimeBase = toHttpBase(readArg('--realtime') || readArg('--httpBase') || process.env.BNI_REALTIME_HTTP_URL || '');
    const collabToken = String(readArg('--collabToken') || process.env.BNI_COLLAB_TOKEN || '').trim();
    const boardId = String(readArg('--boardId') || process.env.BNI_BOARD_ID || '').trim();
    const page = String(readArg('--page') || process.env.BNI_BOARD_PAGE || 'point').trim() || 'point';
    const timeoutMs = Math.max(1000, Number(readArg('--timeoutMs') || process.env.BNI_VERIFY_TIMEOUT_MS || 10000) || 10000);

    console.log(`[verify] site: ${siteBase}`);

    if (requestedRealtimeBase) {
        const health = await probeHealth(requestedRealtimeBase);
        console.log(`[verify] health ok: ${requestedRealtimeBase} -> ws ${health.wsPath}`);
    } else {
        console.log('[verify] health explicite saute: passe --realtime pour verifier un host websocket sans session cloud.');
    }

    if (!collabToken || !boardId) {
        console.log('[verify] verification authentifiee sautee: passe --collabToken et --boardId pour valider le token endpoint et le handshake websocket.');
        return;
    }

    const tokenUrl = joinUrl(siteBase, '/.netlify/functions/collab-realtime-token');
    const { response, data } = await fetchJson(tokenUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-collab-token': collabToken
        },
        body: JSON.stringify({
            boardId,
            page
        })
    });

    if (!response.ok || !data?.ok || !data?.token) {
        throw new Error(`Token realtime invalide (${response.status}): ${JSON.stringify(data || {})}`);
    }

    const resolvedHttpBase = toHttpBase(data.httpBase || requestedRealtimeBase);
    const resolvedWsBase = toWsBase(data.wsBase || resolvedHttpBase);
    if (!resolvedHttpBase || !resolvedWsBase) {
        throw new Error(`Configuration realtime incomplete: ${JSON.stringify({ httpBase: data.httpBase, wsBase: data.wsBase })}`);
    }

    if (requestedRealtimeBase && resolvedHttpBase !== requestedRealtimeBase) {
        throw new Error(`Le token endpoint renvoie ${resolvedHttpBase} au lieu de ${requestedRealtimeBase}.`);
    }

    const health = await probeHealth(resolvedHttpBase);
    console.log(`[verify] token ok: ${resolvedHttpBase} / ${resolvedWsBase}`);
    console.log(`[verify] health confirme: secret=${health.secretConfigured} store=${health.store?.reachable}`);

    const helloAck = await connectRealtimeSocket({
        wsBase: resolvedWsBase,
        boardId,
        page,
        token: data.token,
        timeoutMs
    });

    console.log(`[verify] websocket ok: client=${helloAck.clientId} role=${helloAck.role} board=${helloAck.boardId}`);
}

main().catch((error) => {
    console.error(`[verify] echec: ${error?.message || error}`);
    process.exitCode = 1;
});
