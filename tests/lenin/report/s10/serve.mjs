import http from 'http'; import fs from 'fs'; import path from 'path';
const root = process.argv[2], port = +process.argv[3];
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.mp4': 'video/mp4', '.webm': 'video/webm', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.txt': 'text/plain' };
http.createServer((q, r) => {
  let f = path.join(root, decodeURIComponent(q.url.split('?')[0]));
  try { if (fs.statSync(f).isDirectory()) f = path.join(f, 'index.html'); } catch (e) {}
  fs.stat(f, (e, st) => {
    if (e) { r.writeHead(404); return r.end('nf'); }
    const h = { 'Content-Type': T[path.extname(f)] || 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
    const m = /bytes=(\d*)-(\d*)/.exec(q.headers.range || '');
    if (m) { const s = m[1] ? +m[1] : 0, en = m[2] ? +m[2] : st.size - 1; r.writeHead(206, { ...h, 'Content-Range': `bytes ${s}-${en}/${st.size}`, 'Content-Length': en - s + 1 }); fs.createReadStream(f, { start: s, end: en }).pipe(r); }
    else { r.writeHead(200, { ...h, 'Content-Length': st.size }); fs.createReadStream(f).pipe(r); }
  });
}).listen(port, '127.0.0.1');
