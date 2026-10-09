// 依存なしの簡易HTTPサーバー（Range対応）。使い方: node serve.js [ポート]
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const PORT = parseInt(process.argv[2] || '8080', 10);
const ROOT = __dirname;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.mp3': 'audio/mpeg' };

http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(ROOT, path.normalize(p));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('Not found'); }
    const type = TYPES[path.extname(file)] || 'application/octet-stream';
    const range = req.headers.range;
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      const start = m[1] ? parseInt(m[1], 10) : 0;
      const end = m[2] ? parseInt(m[2], 10) : st.size - 1;
      res.writeHead(206, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
      fs.createReadStream(file, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': st.size, 'Cache-Control': 'no-cache' });
      fs.createReadStream(file).pipe(res);
    }
  });
}).listen(PORT, '0.0.0.0', () => {
  console.log('サーバー起動: PC → http://localhost:' + PORT);
  Object.values(os.networkInterfaces()).flat().filter(i => i.family === 'IPv4' && !i.internal)
    .forEach(i => console.log('スマホ(同じWi-Fi) → http://' + i.address + ':' + PORT));
});
