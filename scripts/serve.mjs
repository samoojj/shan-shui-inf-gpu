import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const publicPath = /^(?:examples\/[\w./-]+|dist\/[\w./-]+|index\.html)$/;
export function serve(port = 4173) {
  return createServer(async (req, res) => {
    try {
      let path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).slice(1);
      if (!path || path.endsWith('/')) path += 'index.html';
      const file = resolve(root, path);
      if (!publicPath.test(path) || path.split('/').some(part => part.startsWith('.')) || !file.startsWith(root + sep)) {
        res.writeHead(404).end('Not found');
        return;
      }
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(body);
    } catch {
      res.writeHead(404).end('Not found');
    }
  }).listen(port, '127.0.0.1');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4173);
  serve(port).on('listening', () => console.log(`Landscape demo: http://localhost:${port}/examples/`));
}
