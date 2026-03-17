const jwt = require('jsonwebtoken');

const {
  connectLambda,
  jsonResponse,
  preflightResponse,
  errorResponse,
  readBody,
  normalizePage,
  resolveAuth,
  boardKey,
  getRoleForUser,
} = require('../lib/collab');

const REALTIME_SECRET = String(process.env.BNI_REALTIME_SECRET || process.env.REALTIME_SECRET || 'bni-linked-dev-realtime-secret');
const TOKEN_TTL_SECONDS = 60 * 5;

function normalizeHttpBase(value = '') {
  return String(value || '')
    .trim()
    .replace(/^ws:/i, 'http:')
    .replace(/^wss:/i, 'https:')
    .replace(/\/+$/, '');
}

function normalizeWsBase(value = '') {
  return String(value || '')
    .trim()
    .replace(/^http:/i, 'ws:')
    .replace(/^https:/i, 'wss:')
    .replace(/\/+$/, '');
}

function resolveRequestOrigin(event) {
  const headers = event.headers || {};
  const proto = String(
    headers['x-forwarded-proto'] ||
    headers['X-Forwarded-Proto'] ||
    ''
  ).trim().toLowerCase();
  const host = String(
    headers['x-forwarded-host'] ||
    headers['X-Forwarded-Host'] ||
    headers.host ||
    headers.Host ||
    ''
  ).trim();

  if (!host) return '';

  const protocol = proto === 'http' || proto === 'https'
    ? `${proto}:`
    : 'https:';
  return `${protocol}//${host}`;
}

function resolveRealtimeHttpBase(event) {
  const explicit = String(
    process.env.BNI_REALTIME_HTTP_URL ||
    process.env.BNI_REALTIME_URL ||
    ''
  ).trim();
  if (explicit) return normalizeHttpBase(explicit);
  return normalizeHttpBase(resolveRequestOrigin(event));
}

function resolveRealtimeWsBase(event) {
  const explicit = String(
    process.env.BNI_REALTIME_WS_URL ||
    process.env.BNI_REALTIME_URL ||
    ''
  ).trim();
  if (explicit) return normalizeWsBase(explicit);
  return normalizeWsBase(resolveRequestOrigin(event));
}

exports.handler = async (event) => {
  connectLambda(event);

  if (event.httpMethod === 'OPTIONS') {
    return preflightResponse();
  }

  if (event.httpMethod !== 'POST') {
    return errorResponse(405, 'Method not allowed');
  }

  const body = readBody(event);
  if (!body) {
    return errorResponse(400, 'JSON invalide.');
  }

  const auth = await resolveAuth(event, body);
  if (!auth.ok) {
    return errorResponse(auth.statusCode || 401, auth.error || 'Session requise.');
  }

  const boardId = String(body.boardId || '').trim();
  const requestedPage = normalizePage(body.page || 'point');
  if (!boardId) {
    return errorResponse(400, 'Board manquant.');
  }

  const board = await auth.store.get(boardKey(boardId), { type: 'json' });
  if (!board) {
    return errorResponse(404, 'Tableau introuvable.');
  }

  const role = getRoleForUser(board, auth.user.id);
  if (!role) {
    return errorResponse(403, 'Acces refuse.');
  }

  const page = normalizePage(board.page || requestedPage);
  if (page !== requestedPage) {
    return errorResponse(400, 'Page realtime invalide pour ce board.');
  }

  const token = jwt.sign({
    sub: String(auth.user.id || ''),
    userId: String(auth.user.id || ''),
    username: String(auth.user.username || ''),
    boardId,
    page,
  }, REALTIME_SECRET, {
    algorithm: 'HS256',
    expiresIn: TOKEN_TTL_SECONDS,
  });

  return jsonResponse(200, {
    ok: true,
    token,
    boardId,
    page,
    role,
    httpBase: resolveRealtimeHttpBase(event),
    wsBase: resolveRealtimeWsBase(event),
    expiresIn: TOKEN_TTL_SECONDS,
  });
};
