// Removes the words in tools/word-blocklist.txt from the game:
//   - data/words.js: the answer pool (these words can no longer be an answer or a decoy a player could trace)
//   - data/puzzles.js: pre-built boards (any board with one of these words as an answer is dropped)
// Run it again after rebuilding either file: node tools/apply-blocklist.js
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const block = new Set(fs.readFileSync(path.join(__dirname, 'word-blocklist.txt'), 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')));

const wordsPath = path.join(root, 'data', 'words.js');
const wordsSrc = fs.readFileSync(wordsPath, 'utf8');
const m = /window\.WEND_ANSWERS\s*=\s*"([^"]*)"\.split\(" "\);/.exec(wordsSrc);
if (!m) throw new Error('data/words.js is not in the expected format');
const words = m[1].split(' '), kept = words.filter((w) => !block.has(w));
fs.writeFileSync(wordsPath, 'window.WEND_ANSWERS = ' + JSON.stringify(kept.join(' ')) + '.split(" ");\n');
console.log('words:', words.length, '->', kept.length, '(removed ' + (words.length - kept.length) + ')');

const poolPath = path.join(root, 'data', 'puzzles.js');
const poolSrc = fs.readFileSync(poolPath, 'utf8');
const pm = /^window\.WEND_POOL = (\{.*\});\s*$/s.exec(poolSrc);
if (!pm) throw new Error('data/puzzles.js is not in the expected format');
const pool = JSON.parse(pm[1]), before = {}, after = {};
for (const d of Object.keys(pool)) {
  before[d] = pool[d].length;
  pool[d] = pool[d].filter((p) => !p.s.some(([w]) => block.has(w.toLowerCase())));
  after[d] = pool[d].length;
}
fs.writeFileSync(poolPath, 'window.WEND_POOL = ' + JSON.stringify(pool) + ';\n');
console.log('boards before:', before);
console.log('boards after: ', after);
// Nothing in the pool may still hold a blocked word as an answer.
for (const d of Object.keys(pool)) for (const p of pool[d]) for (const [w] of p.s) if (block.has(w.toLowerCase())) throw new Error('blocked word left in pool: ' + w);
