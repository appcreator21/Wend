// Background puzzle generator, so building a fresh board never freezes the loading animation.
// Protocol: postMessage({ id, difficulty, seed })  ->  { id, puzzle } | { id, error }
self.window = self; // data/words.js and generator.js attach to `window`
importScripts('../data/words.js', 'generator.js');
self.onmessage = (e) => {
  const { id, difficulty, seed } = e.data;
  try {
    self.postMessage({ id, puzzle: self.WendGen.generate({ seed, difficulty, answers: self.WEND_ANSWERS }) });
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
