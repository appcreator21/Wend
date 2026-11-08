// Builds data/words.js (the pool of puzzle answers) from two plain word lists.
//   node tools/build-words.js <common.txt> <all-words.txt>
// common.txt : frequency-ordered common words (used as puzzle answers)
// all-words.txt : big dictionary (only used to drop junk from the common list)
const fs = require('fs');
const [commonPath, allPath] = process.argv.slice(2);
const ok = (w) => /^[a-z]{4,9}$/.test(w);
const all = new Set(fs.readFileSync(allPath, 'utf8').split(/\s+/).filter(ok));
const seen = new Set();
const common = [];
for (const w of fs.readFileSync(commonPath, 'utf8').split(/\s+/)) {
  if (ok(w) && all.has(w) && !seen.has(w)) { seen.add(w); common.push(w); }
}
const answers = common; // every common word of 4-9 letters
const out = 'window.WEND_ANSWERS = ' + JSON.stringify(answers.join(' ')) + '.split(" ");\n';
fs.writeFileSync(__dirname + '/../data/words.js', out);
console.log('answers', answers.length);
