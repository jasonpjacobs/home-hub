import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createApiHandler } from './app.js';
import { loadEnv } from './env.js';
import { SheetDatabase } from './storage.js';

loadEnv();

if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
  console.warn(
    '[Home Hub Warning] SESSION_SECRET is not set! Set a strong random SESSION_SECRET in production so user sessions stay secure.',
  );
}

const PORT = Number(process.env.PORT || 3001);
const DIST_DIR = path.resolve(process.cwd(), 'dist');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
};

const db = new SheetDatabase();
const handleApi = createApiHandler(db);

function serveStatic(req, res) {
  if (!fs.existsSync(DIST_DIR)) {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Home Hub API is running. Start the Vite dev server on http://localhost:5173 or run `npm run build`.');
    return;
  }

  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  let reqPath = decodeURIComponent(url.pathname);
  if (reqPath === '/') reqPath = '/index.html';

  const safePath = path.normalize(reqPath).replace(/^(\.\.(\/|\\|$))+/, '');
  let fullPath = path.join(DIST_DIR, safePath);

  if (!fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
    fullPath = path.join(DIST_DIR, 'index.html');
  }

  const ext = path.extname(fullPath);
  res.writeHead(200, {
    'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
  });
  fs.createReadStream(fullPath).pipe(res);
}

const server = http.createServer((req, res) => {
  if ((req.url || '').startsWith('/api/')) {
    return handleApi(req, res);
  }
  return serveStatic(req, res);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Home Hub server listening on http://localhost:${PORT} [${db.getStatus().label}]`);
});
