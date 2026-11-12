// Draws every icon from one drawing: the snake mascot coiled from the ground over a faint 2x2 glass COIL grid on black.
// Square for the home-screen app icon (default, dark and tinted) and the web apple-touch icons, wide for Messages,
// and a bare transparent snake for the logo spot inside the app. render-svg.swift (WebKit, no installs) turns each
// SVG into a PNG, then resize-icons.py builds the catalogs:
//   node coil/tools/make-icons.js && python3 coil/tools/resize-icons.py
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const FONT = "font-family=\"ui-rounded, 'SF Pro Rounded', 'Arial Rounded MT Bold', -apple-system, sans-serif\"";

// The mascot: a snake coiled from the ground, body rising out of the coil, head up top. The body is a run of circles
// along a helix, drawn back to front so the coils overlap properly; it grows from a thin tail to a thick body and
// narrows into the neck. `kind` picks the canvas: square (the web apple-touch icon) or wide (Messages).
function snake(kind) {
  const bare = kind === 'mark', square = kind === 'square' || bare, w = 1024, h = square ? 1024 : 768, cx = 512;   // 'mark': just the snake, no backdrop, for the app's logo spot
  const baseY = 790, ry = 78, pitch = 128, turns = 2.8, phi0 = 0.9 * Math.PI;
  const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  const dark = [168, 92, 0], light = [255, 222, 92], hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
  const body = [];
  // The coil on the ground.
  const N = 420;
  for (let i = 0; i <= N; i++) {
    const t = i / N, phi = phi0 + t * turns * 2 * Math.PI, R = 318 - 62 * t, z = Math.sin(phi);
    const d = t < 0.22 ? 26 + (118 - 26) * Math.pow(t / 0.22, 0.85) : 118 - 14 * Math.max(0, (t - 0.85) / 0.15);
    body.push({ x: cx + R * Math.cos(phi), y: baseY - (phi - phi0) / (2 * Math.PI) * pitch + ry * z, d, z, band: i % 21 < 3 });
  }
  body.sort((p, q) => p.z - q.z);                                   // back first, front last
  // The neck: an S-curve from the front of the top coil up to the head.
  const E = { x: cx, y: baseY - turns * pitch + ry }, head = { x: 604, y: 236 };
  const P = [E, { x: cx + 150, y: E.y - 70 }, { x: cx - 120, y: head.y + 150 }, { x: head.x - 64, y: head.y + 36 }];
  const neck = [];
  for (let i = 0; i <= 60; i++) {
    const t = i / 60, u = 1 - t, x = u ** 3 * P[0].x + 3 * u * u * t * P[1].x + 3 * u * t * t * P[2].x + t ** 3 * P[3].x;
    const y = u ** 3 * P[0].y + 3 * u * u * t * P[1].y + 3 * u * t * t * P[2].y + t ** 3 * P[3].y;
    neck.push({ x, y, d: 104 - 14 * t, z: 0.55 + 0.25 * Math.sin(t * Math.PI), band: i % 12 < 3 });
  }
  const all = [...body, ...neck];
  const draw = (p) => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${(p.d / 2).toFixed(1)}" fill="${hex(mix(mix(dark, light, (p.z + 1) / 2.2), [120, 62, 0], p.band ? 0.24 : 0))}"/>` ;
  const hx = head.x, hy = head.y;
  const headPath = `M${hx - 100} ${hy - 12} C${hx - 70} ${hy - 72} ${hx + 40} ${hy - 80} ${hx + 112} ${hy - 30} C${hx + 138} ${hy - 12} ${hx + 140} ${hy + 14} ${hx + 118} ${hy + 28} C${hx + 62} ${hy + 62} ${hx - 22} ${hy + 76} ${hx - 88} ${hy + 50} C${hx - 116} ${hy + 30} ${hx - 120} ${hy + 6} ${hx - 100} ${hy - 12} Z`;
  // Fit the whole snake (shadow, coil, tongue) to the canvas: centred, as large as the margins allow.
  const bx0 = Math.min(...all.map((p) => p.x - p.d / 2)), bx1 = Math.max(hx + 215, ...all.map((p) => p.x + p.d / 2));
  const by0 = hy - 86, by1 = baseY + ry + 50;
  const alone = bare || kind === 'wide';   // no tiles behind it, so it can fill more of the canvas
  const fit = Math.min((w * (bare ? 0.96 : alone ? 0.82 : 0.7)) / (bx1 - bx0), (h * (bare ? 0.96 : alone ? 0.9 : 0.74)) / (by1 - by0));
  const place = `translate(${cx - fit * (bx0 + bx1) / 2} ${h / 2 - fit * (by0 + by1) / 2}) scale(${fit})`;
  // The COIL letters sit behind the snake in a 2x2 grid that fills the icon: faint glass blocks, fainter glass letters.
  const gw = square ? 384 : 470, gh = square ? 384 : 346, gg = 22, gx0 = (w - (2 * gw + gg)) / 2, gy0 = (h - (2 * gh + gg)) / 2, rx = Math.min(gw, gh) * 0.26;
  const tileSet = 'COIL'.split('').map((ch, i) => { const x = gx0 + (i % 2) * (gw + gg), y = gy0 + Math.floor(i / 2) * (gh + gg), mx = x + gw / 2, my = y + gh / 2, size = gh * 0.78;
    return `<rect x="${x}" y="${y}" width="${gw}" height="${gh}" rx="${rx}" fill="url(#clr)"/>
      <rect x="${x + 1.5}" y="${y + 1.5}" width="${gw - 3}" height="${gh - 3}" rx="${rx - 1}" fill="none" stroke="url(#rim)" stroke-width="3"/>
      <text x="${mx}" y="${my + size * 0.355}" ${FONT} font-weight="900" font-size="${size}" fill="url(#gl)" stroke="#fff" stroke-opacity=".24" stroke-width="3" text-anchor="middle">${ch}</text>`; }).join('');
  const tileDefs = `<linearGradient id="clr" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".09"/><stop offset="1" stop-color="#fff" stop-opacity=".03"/></linearGradient>` +
    `<linearGradient id="rim" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".6"/><stop offset=".5" stop-color="#fff" stop-opacity=".1"/><stop offset="1" stop-color="#fff" stop-opacity=".32"/></linearGradient>` +
    `<linearGradient id="gl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".15"/><stop offset="1" stop-color="#fff" stop-opacity=".06"/></linearGradient>` +
    `<filter id="tsh" filterUnits="userSpaceOnUse" x="-100" y="-100" width="${w + 200}" height="${h + 200}"><feDropShadow dx="0" dy="14" stdDeviation="14" flood-color="#000" flood-opacity=".6"/></filter>` +
    `<filter id="lsh" filterUnits="userSpaceOnUse" x="-100" y="-100" width="${w + 200}" height="${h + 200}"><feDropShadow dx="0" dy="6" stdDeviation="5" flood-color="#000" flood-opacity=".45"/></filter>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs>
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#15151f"/><stop offset="1" stop-color="#000"/></linearGradient>
  <radialGradient id="glow" cx=".5" cy=".38" r=".5"><stop offset="0" stop-color="#ffc21a" stop-opacity=".2"/><stop offset="1" stop-color="#ffc21a" stop-opacity="0"/></radialGradient>${tileDefs}
  <linearGradient id="hd" gradientUnits="userSpaceOnUse" x1="0" y1="${hy - 80}" x2="0" y2="${hy + 76}"><stop offset="0" stop-color="#ffe89a"/><stop offset=".6" stop-color="#ffc93a"/><stop offset="1" stop-color="#e08400"/></linearGradient>
  <filter id="blur" filterUnits="userSpaceOnUse" x="-300" y="-300" width="${w + 600}" height="${h + 600}"><feGaussianBlur stdDeviation="22"/></filter>
</defs>
  ${bare ? '' : `<rect width="${w}" height="${h}" fill="url(#bg)"/><rect width="${w}" height="${h}" fill="url(#glow)"/>`}
  ${bare || kind === 'wide' ? '' : tileSet}   <!-- the wide Messages icon is the snake alone -->
  <g transform="${place}">
    ${bare ? '' : `<ellipse cx="${cx}" cy="${baseY + ry + 14}" rx="${350}" ry="${44}" fill="#000" fill-opacity=".55" filter="url(#blur)"/>`}
    ${all.map(draw).join('')}
    <path d="${headPath}" fill="url(#hd)" stroke="#a85c00" stroke-opacity=".6" stroke-width="3"/>
    <path d="M${hx - 70} ${hy - 44} C${hx - 20} ${hy - 66} ${hx + 50} ${hy - 62} ${hx + 100} ${hy - 30}" fill="none" stroke="#fff" stroke-opacity=".3" stroke-width="12" stroke-linecap="round"/>
    <path d="M${hx + 116} ${hy + 22} C${hx + 60} ${hy + 50} ${hx - 10} ${hy + 56} ${hx - 80} ${hy + 40}" fill="none" stroke="#7a3c00" stroke-opacity=".7" stroke-width="6" stroke-linecap="round"/>
    <ellipse cx="${hx + 108}" cy="${hy - 6}" rx="7" ry="5" fill="#5a2c00" transform="rotate(-20 ${hx + 108} ${hy - 6})"/>
    <path d="M${hx + 10} ${hy - 36} Q${hx + 46} ${hy - 58} ${hx + 84} ${hy - 34}" fill="none" stroke="#7a3c00" stroke-width="10" stroke-linecap="round"/>
    <ellipse cx="${hx + 48}" cy="${hy - 22}" rx="31" ry="23" fill="#fff0a0"/>
    <ellipse cx="${hx + 48}" cy="${hy - 22}" rx="31" ry="23" fill="none" stroke="#7a3c00" stroke-width="4"/>
    <ellipse cx="${hx + 50}" cy="${hy - 22}" rx="8" ry="21" fill="#140a1e"/>
    <circle cx="${hx + 42}" cy="${hy - 31}" r="6" fill="#fff"/>
    <path d="M${hx + 120} ${hy + 30} C${hx + 150} ${hy + 40} ${hx + 176} ${hy + 40} ${hx + 196} ${hy + 52} M${hx + 196} ${hy + 52} l24 -8 M${hx + 196} ${hy + 52} l22 14" fill="none" stroke="#ff3d57" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
</svg>`;
}

const jobs = [
  // The home-screen icon is the snake logo in all three looks: it is already dark, so default and dark match,
  // and resize-icons.py turns the tinted one grey (iOS colours it).
  ['icon-1024.png', snake('square')],
  ['icon-1024-dark.png', snake('square')],
  ['icon-1024-tinted.png', snake('square')],
  // Messages: a 4:3 canvas, the snake alone (the app name already sits beside the icon).
  ['icon-1024x768.png', snake('wide')],
  ['snake-1024.png', snake('square')],
  ['snake-mark.png', snake('mark'), true],
];
for (const [name, svg, transparent] of jobs) {
  const svgPath = path.join(__dirname, name.replace('.png', '.svg'));
  fs.writeFileSync(svgPath, svg);
  const m = /width="(\d+)" height="(\d+)"/.exec(svg);
  execFileSync('swift', [path.join(__dirname, 'render-svg.swift'), svgPath, path.join(__dirname, name), m[1], m[2], ...(transparent ? ['transparent'] : [])], { stdio: 'inherit' });
}
