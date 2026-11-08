const G = require('../src/generator.js');
global.window = {};
require('../data/words.js');
const answers = window.WEND_ANSWERS;
let fails = 0, t0 = Date.now();
for (const d of Object.keys(G.DIFFICULTIES)) {
  for (let s = 0; s < 25; s++) {
    const p = G.generate({ seed: d + s, difficulty: d, answers });
    const cells = new Set(), blocked = new Set(p.blocked);
    for (const { word, path } of p.solution) {
      if (word.length !== path.length) { fails++; console.log("len"); }
      path.forEach((c, k) => {
        if (cells.has(c) || blocked.has(c) || p.letters[c] !== word[k]) { fails++; if (fails<4) console.log("cell", cells.has(c), blocked.has(c), p.letters[c], word[k], d, s); }
        cells.add(c);
        if (k && !G.neighbours(path[k - 1], p.rows, p.cols).includes(c)) fails++;
      });
    }
    if (cells.size + blocked.size !== p.rows * p.cols) fails++;
    if (p.lengths.some((l, k) => l !== 4 + k)) fails++; // lengths must be 4,5,6,...
    if (p.solution.some((x) => G.longestRun(x.path, p.cols) > 3)) fails++; // no long straight runs
    if (p.solution.some((x) => x.word.endsWith('S'))) fails++; // no giveaway plurals
    const cands = G.traceableWords(p.letters, p.rows, p.cols, answers, p.lengths.at(-1));
    if (G.countSolutions(cands, p.letters, p.lengths, 2) !== 1) fails++; // unique solution
    const key = (q) => q.slice().sort((a, b) => a - b).join(',');
    const sol = new Map(p.solution.map((x) => [x.word.toLowerCase(), key(x.path)]));
    if (cands.some((c) => sol.has(c.word) && sol.get(c.word) !== key(c.path))) fails++; // no alternate route for an answer
    if (!p.solution.every(({ word }) => answers.includes(word.toLowerCase()))) fails++;
  }
}
console.log(fails ? 'FAIL ' + fails : 'ok', (Date.now() - t0) + 'ms for 900 puzzles');
const p = G.generate({ seed: 'demo', difficulty: 'hard', answers });
for (let r = 0; r < p.rows; r++) console.log(Array.from({ length: p.cols }, (_, c) => p.letters[r * p.cols + c] || '#').join(' '));
console.log(p.solution.map((s) => s.word).join(' '));
process.exit(fails ? 1 : 0);
