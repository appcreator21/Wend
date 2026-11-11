// Serves the game the way the app bundle does: every file flat in one folder.
//   node coil/tools/serve.js [port]   ->  http://localhost:8200/index.html
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..', '..');
const FILES = {
  'index.html': 'coil/Web/index.html', 'coil.css': 'coil/Web/coil.css', 'coil.js': 'coil/Web/coil.js',
  'generator.js': 'src/generator.js', 'words.js': 'data/words.js', 'puzzles.js': 'data/puzzles.js',
};
const TYPES = { html: 'text/html', css: 'text/css', js: 'text/javascript' };
const server = http.createServer((req, res) => {
  const name = path.basename(req.url.split('?')[0]) || 'index.html';
  if (!FILES[name]) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[name.split('.').pop()] + '; charset=utf-8', 'Cache-Control': 'no-cache' });
  fs.createReadStream(path.join(root, FILES[name])).pipe(res);
});
server.listen(Number(process.argv[2]) || 8200, () => console.log('http://localhost:' + server.address().port + '/index.html'));
module.exports = server;
