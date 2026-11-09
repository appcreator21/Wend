// Bundles the static site into one Cloudflare Pages worker (worker/_worker.js).
// Used when static asset upload isn't available (API-token-only deploys).
const fs = require('fs'), path = require('path');
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
const src = `const ALIASES = ${JSON.stringify(aliases)};
const FILES = ${JSON.stringify(files)};
const BIN = ${JSON.stringify(binary)};
const TYPES = ${JSON.stringify(types)};
export default {
  fetch(request) {
    let p = new URL(request.url).pathname;
    if (p === '/') p = '/index.html';
    if (ALIASES[p]) p = ALIASES[p];
    let body = FILES[p];
    if (body === undefined && BIN[p] !== undefined) body = Uint8Array.from(atob(BIN[p]), (c) => c.charCodeAt(0));
    if (body === undefined) return new Response('Not found', { status: 404 });
    return new Response(body, { headers: {
      'content-type': TYPES[p.split('.').pop()] || 'text/plain',
      'cache-control': p === '/index.html' ? 'no-cache' : 'public, max-age=300',
      'x-content-type-options': 'nosniff',
    } });
  },
};
`;
fs.mkdirSync(path.join(root, 'worker'), { recursive: true });
fs.writeFileSync(path.join(root, 'worker/_worker.js'), src);
console.log('worker/_worker.js', Math.round(src.length / 1024) + 'KB,', Object.keys(files).length + Object.keys(binary).length, 'files');
