// Merges data/puzzles-*.json into data/puzzles.js (window.WEND_POOL = {easy:[...], medium:[...], hard:[...]}).
const fs = require('fs'), path = require('path');
const pool = {};
for (const d of ['easy', 'medium', 'hard']) pool[d] = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/puzzles-' + d + '.json'), 'utf8'));
fs.writeFileSync(path.join(__dirname, '../data/puzzles.js'), 'window.WEND_POOL = ' + JSON.stringify(pool) + ';\n');
for (const d in pool) fs.unlinkSync(path.join(__dirname, '../data/puzzles-' + d + '.json'));
console.log('packed', Object.fromEntries(Object.entries(pool).map(([k, v]) => [k, v.length])));
