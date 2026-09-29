import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
const root = resolve('dist');
const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let path = decodeURIComponent(url.pathname).replace(/^\/Resolve(?=\/)/, '');
  if (path.endsWith('/')) path += 'index.html';
  const filename = resolve(root, '.' + path);
  if (!filename.startsWith(root + '/')) { res.writeHead(403).end(); return; }
  try { const data = await readFile(filename); res.writeHead(200, { 'Content-Type': types[extname(filename)] ?? 'application/octet-stream' }).end(data); }
  catch { res.writeHead(404).end(); }
}).listen(4175, '127.0.0.1');
