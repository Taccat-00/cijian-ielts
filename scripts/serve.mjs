import http from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PUBLIC_FILES } from './public-files.mjs';
const publicFiles = new Set(PUBLIC_FILES);
const mime = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml', '.jpg':'image/jpeg', '.png':'image/png', '.txt':'text/plain; charset=utf-8' };
export function createStaticServer(root, { local = false } = {}) {
  const allowed = new Set(publicFiles);
  if (local) allowed.add('data/vocabulary.local.json');
  return http.createServer(async (req, res) => {
    if (!['GET','HEAD'].includes(req.method)) { res.writeHead(405, { Allow:'GET, HEAD' }).end(); return; }
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
      // Exact paths reject NTFS aliases and unintended source/data files.
      if (!allowed.has(relative)) { res.writeHead(404).end('Not found'); return; }
      const base = await realpath(root), file = await realpath(resolve(base, relative));
      if (!file.startsWith(base + sep)) { res.writeHead(404).end('Not found'); return; }
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type':mime[extname(file)], 'Content-Length':body.length, 'Cache-Control':'no-cache', 'X-Content-Type-Options':'nosniff' });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch { res.writeHead(404).end('Not found'); }
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const project = fileURLToPath(new URL('../', import.meta.url));
  const isDist = process.argv.includes('--dist');
  const portIndex = process.argv.indexOf('--port');
  const port = Number(portIndex >= 0 ? process.argv[portIndex + 1] : 4173);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error('端口必须是 0–65535 之间的整数'); process.exitCode = 1;
  } else {
    const server = createStaticServer(resolve(project, isDist ? 'dist' : '.'), { local: !isDist });
    server.listen(port, '127.0.0.1', () => console.log('词间正在运行：http://127.0.0.1:' + server.address().port));
    server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? '端口已被使用。试试 npm start -- --port 4174' : error.message); process.exitCode = 1; });
  }
}
