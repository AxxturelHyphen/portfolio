/// <reference types="node" />
import { createServer, type Server } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { extname, join, normalize, resolve } from 'node:path';

// Tiny static server over dist/ that gzips text types like a real static host does, so measured transfer sizes
// and Lighthouse timings are honest. No dependencies; used by budgets, perf and stills.

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.wasm': 'application/wasm',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.avif': 'image/avif', '.webp': 'image/webp', '.woff2': 'font/woff2',
  '.ktx2': 'image/ktx2', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8',
};
export const GZIP_EXT = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.wasm', '.txt']);

export interface StaticServer {
  url: string;
  close(): Promise<void>;
}

export async function serveDist(dir = resolve('dist'), port = 0): Promise<StaticServer> {
  const cache = new Map<string, Buffer>();
  const server: Server = createServer((req, res) => {
    const path = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/');
    let file = normalize(join(dir, path));
    if (!file.startsWith(dir)) {
      res.writeHead(403).end();
      return;
    }
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!existsSync(file)) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
      return;
    }
    const ext = extname(file);
    const headers: Record<string, string | number> = { 'content-type': TYPES[ext] ?? 'application/octet-stream', 'cache-control': 'no-store' };
    let body: Buffer = readFileSync(file);
    if (GZIP_EXT.has(ext) && String(req.headers['accept-encoding'] ?? '').includes('gzip')) {
      let z = cache.get(file);
      if (z === undefined) {
        z = gzipSync(body, { level: 9 });
        cache.set(file, z);
      }
      body = z;
      headers['content-encoding'] = 'gzip';
    }
    headers['content-length'] = body.length;
    res.writeHead(200, headers).end(body);
  });
  await new Promise<void>((ok) => server.listen(port, '127.0.0.1', ok));
  const addr = server.address();
  const p = typeof addr === 'object' && addr !== null ? addr.port : port;
  return { url: `http://127.0.0.1:${p}/`, close: () => new Promise<void>((ok) => { server.close(() => ok()); server.closeAllConnections(); }) };
}
