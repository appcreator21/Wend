// Verifies every pregenerated puzzle: valid paths, no alternate route for any answer, exactly one full solution.
const G = require('../src/generator.js');
global.window = {};
require('../data/words.js'); require('../data/puzzles.js');
const key = (q) => q.slice().sort((a, b) => a - b).join(',');
let fails = 0, total = 0;
for (const [d, list] of Object.entries(window.WEND_POOL)) {
  const diff = G.DIFFICULTIES[d];
  for (const e of list) {
    total++;
    const letters = e.l.split('').map((c) => (c === '#' ? null : c));
    const lengths = e.s.map((x) => x[0].length).sort((a, b) => a - b);
    if (e.r !== diff.rows || e.c !== diff.cols || lengths.join() !== diff.lengths.join()) fails++;
    const covered = new Set();
    for (const [word, path] of e.s) {
      path.forEach((c, k) => {
        if (covered.has(c) || letters[c] !== word[k]) fails++;
        covered.add(c);
        if (k && !G.neighbours(path[k - 1], e.r, e.c).includes(c)) fails++;
      });
    }
    if (covered.size !== letters.filter(Boolean).length) fails++;
    const cands = G.traceableWords(letters, e.r, e.c, window.WEND_ANSWERS, lengths.at(-1));
    const sol = new Map(e.s.map(([w, p]) => [w.toLowerCase(), key(p)]));
    if (cands.some((c) => sol.has(c.word) && sol.get(c.word) !== key(c.path))) fails++;
    if (G.countSolutions(cands, letters, lengths, 2) !== 1) fails++;
  }
}
console.log(fails ? 'FAIL ' + fails : 'ok', total, 'pooled puzzles checked');
process.exit(fails ? 1 : 0);
