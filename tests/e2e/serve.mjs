// static server with SPA fallback for the exported web build (local e2e only)
import http from 'node:http'; import { readFile } from 'node:fs/promises'; import { extname, join } from 'node:path';
const root = process.argv[2]; const types = { '.js': 'text/javascript', '.html': 'text/html', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.ttf': 'font/ttf', '.css': 'text/css' };
http.createServer(async (req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  try { const b = await readFile(join(root, p)); res.writeHead(200, { 'content-type': types[extname(p)] ?? 'application/octet-stream' }); res.end(b); }
  catch { res.writeHead(200, { 'content-type': 'text/html' }); res.end(await readFile(join(root, 'index.html'))); }
}).listen(8099, () => console.log('serving on 8099'));
