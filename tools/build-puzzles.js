// Pregenerates verified puzzles into data/puzzles-<difficulty>.json (compact form).
//   node tools/build-puzzles.js <easy|medium|hard> <count>
// tools/pack-puzzles.js then merges them into data/puzzles.js.
const fs = require('fs'), path = require('path');
global.window = {};
require('../data/words.js');
const G = require('../src/generator.js');
const [difficulty, count] = [process.argv[2], +process.argv[3] || 100];
const out = [];
for (let i = 0; i < count; i++) {
  const p = G.generate({ seed: 'pool-' + difficulty + '-' + i, difficulty, answers: window.WEND_ANSWERS });
  out.push({ r: p.rows, c: p.cols, l: p.letters.map((x) => x || '#').join(''), s: p.solution.map((x) => [x.word, x.path]) });
}
fs.writeFileSync(path.join(__dirname, '../data/puzzles-' + difficulty + '.json'), JSON.stringify(out));
console.log(difficulty, out.length);
