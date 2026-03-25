const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const API_TARGET = process.env.BNI_LOCAL_API_BASE || 'http://127.0.0.1:8787';
const argPortIndex = process.argv.indexOf('--port');
const cliPort = argPortIndex >= 0 ? Number(process.argv[argPortIndex + 1]) : NaN;
const PORT = Number.isFinite(cliPort) ? cliPort : Number(process.env.PORT || 4173);

const MIME_TYPES = {
    '.css': 'text/css; charset=utf-8',
    '.gif': 'image/gif',
    '.html': 'text/html; charset=utf-8',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.txt': 'text/plain; charset=utf-8',
    '.webp': 'image/webp',
};

function sendJson(res, statusCode, payload) {
    res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(payload));
}

function sendFile(res, filePath) {
    const extension = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[extension] || 'application/octet-stream';
    fs.createReadStream(filePath)
        .on('open', () => {
            res.writeHead(200, { 'Content-Type': contentType });
        })
        .on('error', () => {
            sendJson(res, 500, { ok: false, error: 'read_error' });
        })
        .pipe(res);
}

function proxyRequest(req, res, requestUrl) {
    const target = new URL(requestUrl.pathname + requestUrl.search, API_TARGET);
    const transport = target.protocol === 'https:' ? https : http;
    const proxyReq = transport.request(target, {
        method: req.method,
        headers: req.headers,
    }, (proxyRes) => {
        res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
        proxyRes.pipe(res);
    });

    proxyReq.on('error', () => {
        sendJson(res, 502, { ok: false, error: 'proxy_error' });
    });

    req.pipe(proxyReq);
}

function resolvePath(urlPath) {
    const safePath = decodeURIComponent(urlPath.split('?')[0] || '/');
    const relativePath = safePath === '/' ? '/index.html' : safePath;
    let targetPath = path.join(ROOT_DIR, relativePath);

    if (relativePath.endsWith('/')) {
        targetPath = path.join(targetPath, 'index.html');
    }

    return path.resolve(targetPath);
}

const server = http.createServer((req, res) => {
    try {
        const requestUrl = new URL(req.url, `http://${req.headers.host}`);

        if (
            requestUrl.pathname.startsWith('/.netlify/functions/')
            || requestUrl.pathname.startsWith('/api/')
            || requestUrl.pathname === '/health'
        ) {
            proxyRequest(req, res, requestUrl);
            return;
        }

        const resolvedPath = resolvePath(requestUrl.pathname);

        if (!resolvedPath.startsWith(ROOT_DIR)) {
            sendJson(res, 403, { ok: false, error: 'forbidden' });
            return;
        }

        fs.stat(resolvedPath, (error, stats) => {
            if (!error && stats.isFile()) {
                sendFile(res, resolvedPath);
                return;
            }

            const htmlFallback = path.resolve(`${resolvedPath}.html`);
            if (htmlFallback.startsWith(ROOT_DIR) && fs.existsSync(htmlFallback)) {
                sendFile(res, htmlFallback);
                return;
            }

            sendJson(res, 404, { ok: false, error: 'not_found' });
        });
    } catch (error) {
        sendJson(res, 500, { ok: false, error: 'server_error' });
    }
});

server.listen(PORT, '127.0.0.1', () => {
    process.stdout.write(`smoke-server listening on ${PORT}\n`);
});
