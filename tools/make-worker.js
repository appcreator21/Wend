// Bundles the static site into one Cloudflare Pages worker (worker/_worker.js).
// Used when static asset upload isn't available (API-token-only deploys).
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const root = path.join(__dirname, '..');
const files = {};
const binary = {}; // path -> base64
const add = (rel) => {
  if (/\.png$/.test(rel)) binary['/' + rel] = fs.readFileSync(path.join(root, rel)).toString('base64');
  else files['/' + rel] = fs.readFileSync(path.join(root, rel), 'utf8');
};
add('index.html'); add('manifest.webmanifest');
for (const d of ['src', 'data', 'icons']) for (const f of fs.readdirSync(path.join(root, d))) add(d + '/' + f);
const types = { html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'application/javascript; charset=utf-8', png: 'image/png', webmanifest: 'application/manifest+json' };
const aliases = { '/apple-touch-icon.png': '/icons/apple-touch-icon.png', '/apple-touch-icon-precomposed.png': '/icons/apple-touch-icon.png', '/favicon.ico': '/icons/favicon-32.png' };
// Every file is served with an ETag and "no-cache" (always revalidate, cheap 304 when unchanged), so a phone can
// never run an old script against a new page (that mismatch once left the loading screen stuck forever).
const etags = {};
for (const [p, body] of Object.entries(files)) etags[p] = '"' + crypto.createHash('md5').update(body).digest('hex').slice(0, 16) + '"';
for (const [p, body] of Object.entries(binary)) etags[p] = '"' + crypto.createHash('md5').update(body).digest('hex').slice(0, 16) + '"';
const src = `const ETAGS = ${JSON.stringify(etags)};
const ALIASES = ${JSON.stringify(aliases)};
const FILES = ${JSON.stringify(files)};
const BIN = ${JSON.stringify(binary)};
const TYPES = ${JSON.stringify(types)};
export default {
  fetch(request) {
    let p = new URL(request.url).pathname;
    if (p === '/') p = '/index.html';
    if (ALIASES[p]) p = ALIASES[p];
    const etag = ETAGS[p];
    if (etag === undefined) return new Response('Not found', { status: 404 });
    const headers = { etag, 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' };
    if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
    let body = FILES[p];
    if (body === undefined) body = Uint8Array.from(atob(BIN[p]), (c) => c.charCodeAt(0));
    headers['content-type'] = TYPES[p.split('.').pop()] || 'text/plain';
    return new Response(body, { headers });
  },
};
`;
fs.mkdirSync(path.join(root, 'worker'), { recursive: true });
fs.writeFileSync(path.join(root, 'worker/_worker.js'), src);
console.log('worker/_worker.js', Math.round(src.length / 1024) + 'KB,', Object.keys(files).length + Object.keys(binary).length, 'files');
