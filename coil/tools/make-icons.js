// Draws the app icon: the game's own mark, a 2x2 letter board with the yellow word path running C-O-I-L.
// Writes the artwork as SVG, then render-svg.swift (WebKit, so no extra installs) turns it into PNGs:
//   node coil/tools/make-icons.js && python3 coil/tools/resize-icons.py
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const art = (w, h) => { const k = h < 1000 ? 1 : 1.12; return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${(1024 - w) / 2} ${(1024 - h) / 2} ${w} ${h}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6a56ff"/><stop offset=".5" stop-color="#3426b4"/><stop offset="1" stop-color="#150e4d"/></linearGradient>
    <radialGradient id="glow" cx=".28" cy=".12" r=".85"><stop offset="0" stop-color="#fff" stop-opacity=".34"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
    <linearGradient id="tile" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#dfe2ff"/></linearGradient>
    <linearGradient id="pill" gradientUnits="userSpaceOnUse" x1="0" y1="262" x2="0" y2="762"><stop offset="0" stop-color="#ffe680"/><stop offset="1" stop-color="#ffb02e"/></linearGradient>
    <filter id="drop" filterUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024"><feDropShadow dx="0" dy="26" stdDeviation="30" flood-color="#06031f" flood-opacity=".55"/></filter>
    <filter id="lift" filterUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024"><feDropShadow dx="0" dy="10" stdDeviation="10" flood-color="#7a3d00" flood-opacity=".38"/></filter>
  </defs>
  <rect x="-200" y="-200" width="1424" height="1424" fill="url(#bg)"/>
  <rect x="-200" y="-200" width="1424" height="1424" fill="url(#glow)"/>
  <g transform="translate(512 512) scale(${k}) translate(-512 -512)">
  <rect x="192" y="192" width="640" height="640" rx="124" fill="#ffffff" fill-opacity=".2" stroke="#ffffff" stroke-opacity=".38" stroke-width="3" filter="url(#drop)"/>
  <g fill="url(#tile)">
    <rect x="220" y="220" width="280" height="280" rx="64"/><rect x="524" y="220" width="280" height="280" rx="64"/>
    <rect x="220" y="524" width="280" height="280" rx="64"/><rect x="524" y="524" width="280" height="280" rx="64"/>
  </g>
  <polyline points="360,360 664,360 664,664 360,664" fill="none" stroke="url(#pill)" stroke-width="204" stroke-linecap="round" stroke-linejoin="round" filter="url(#lift)"/>
  <g font-family="ui-rounded, 'SF Pro Rounded', 'Arial Rounded MT Bold', -apple-system, sans-serif" font-weight="800" font-size="196" fill="#2a1b6e" text-anchor="middle">
    <text x="360" y="431">C</text><text x="664" y="431">O</text><text x="664" y="735">I</text><text x="360" y="735">L</text>
  </g>
  </g>
</svg>`; };

const jobs = [['icon-1024.png', 1024, 1024], ['icon-1024x768.png', 1024, 768]];
for (const [name, w, h] of jobs) fs.writeFileSync(path.join(__dirname, name.replace('.png', '.svg')), art(w, h));
for (const [name, w, h] of jobs) {
  execFileSync('swift', [path.join(__dirname, 'render-svg.swift'), path.join(__dirname, name.replace('.png', '.svg')), path.join(__dirname, name), String(w), String(h)], { stdio: 'inherit' });
}
