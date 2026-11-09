// Wend puzzle generator. Works in the browser (window.WendGen) and Node (module.exports).
(function (root) {
  'use strict';

  // Word lengths always climb by one, starting at 4: 4 words on 5x5, 5 on 6x6, 6 on 7x7, 7 on 8x8.
  // Cells not covered by a word are blocked, so tiles = sum of the lengths.
  const DIFFICULTIES = {
    easy:   { rows: 5, cols: 5, lengths: [4, 5, 6, 7], minDecoys: 12 },
    medium: { rows: 6, cols: 6, lengths: [4, 5, 6, 7, 8], minDecoys: 20 },
    hard:   { rows: 7, cols: 7, lengths: [4, 5, 6, 7, 8, 9], minDecoys: 30 },
    expert: { rows: 8, cols: 8, lengths: [4, 5, 6, 7, 8, 9, 10], minDecoys: 40 },
  };

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hashString(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  function shuffle(arr, rnd) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function neighbours(i, rows, cols) {
    const r = Math.floor(i / cols), c = i % cols, out = [];
    if (r > 0) out.push(i - cols);
    if (r < rows - 1) out.push(i + cols);
    if (c > 0) out.push(i - 1);
    if (c < cols - 1) out.push(i + 1);
    return out;
  }

  // Remove `count` cells so the remaining cells stay one connected region.
  function pickBlocked(rows, cols, count, rnd) {
    const n = rows * cols;
    for (let attempt = 0; attempt < 200; attempt++) {
      const blocked = new Set(shuffle([...Array(n).keys()], rnd).slice(0, count));
      const open = [...Array(n).keys()].filter((i) => !blocked.has(i));
      const seen = new Set([open[0]]);
      const stack = [open[0]];
      while (stack.length) {
        const x = stack.pop();
        for (const y of neighbours(x, rows, cols)) {
          if (!blocked.has(y) && !seen.has(y)) { seen.add(y); stack.push(y); }
        }
      }
      if (seen.size === open.length) return blocked;
    }
    return new Set();
  }

  // Split the open cells into self-avoiding paths with the given lengths.
  function partition(rows, cols, blocked, lengths, rnd) {
    const n = rows * cols;
    const covered = new Array(n).fill(false);
    blocked.forEach((i) => (covered[i] = true));
    let budget = 30000;

    function freeDegree(i) {
      let d = 0;
      for (const j of neighbours(i, rows, cols)) if (!covered[j]) d++;
      return d;
    }

    // Up to `limit` random self-avoiding paths of `len` cells starting at `start`.
    function paths(start, len, limit) {
      const out = [], path = [start];
      covered[start] = true;
      (function walk() {
        if (out.length >= limit) return;
        if (path.length === len) { out.push(path.slice()); return; }
        const L = path.length;
        const straight = (j) => L >= 3 && j - path[L - 1] === path[L - 1] - path[L - 2] && path[L - 1] - path[L - 2] === path[L - 2] - path[L - 3];
        const opts = shuffle(neighbours(path[L - 1], rows, cols).filter((j) => !covered[j] && !straight(j)), rnd);
        for (const j of opts) {
          covered[j] = true; path.push(j);
          walk();
          path.pop(); covered[j] = false;
          if (out.length >= limit) return;
        }
      })();
      covered[start] = false;
      return out;
    }

    // Every connected block of uncovered cells must be fillable by some subset of the remaining words.
    function feasible(remaining) {
      let sums = new Set([0]);
      for (const l of remaining) sums = new Set([...sums, ...[...sums].map((x) => x + l)]);
      const seen = new Array(n).fill(false);
      for (let i = 0; i < n; i++) {
        if (covered[i] || seen[i]) continue;
        let size = 0;
        const stack = [i]; seen[i] = true;
        while (stack.length) {
          const x = stack.pop(); size++;
          for (const y of neighbours(x, rows, cols)) if (!covered[y] && !seen[y]) { seen[y] = true; stack.push(y); }
        }
        if (!sums.has(size)) return false;
      }
      return true;
    }

    function solve(remaining) {
      if (--budget < 0) return null;
      if (!remaining.length) return [];
      if (!feasible(remaining)) return null;
      // Most constrained uncovered cell first.
      let best = -1, bestDeg = 9, ties = 0;
      for (let i = 0; i < n; i++) {
        if (covered[i]) continue;
        const d = freeDegree(i);
        if (d < bestDeg) { best = i; bestDeg = d; ties = 1; }
        else if (d === bestDeg && rnd() < 1 / ++ties) best = i;
      }
      if (best < 0) return null;
      const lens = shuffle([...new Set(remaining)], rnd);
      for (const len of lens) {
        for (const p of paths(best, len, 12)) {
          p.forEach((i) => (covered[i] = true));
          const rest = remaining.slice();
          rest.splice(rest.indexOf(len), 1);
          const sub = solve(rest);
          if (sub) return [p, ...sub];
          p.forEach((i) => (covered[i] = false));
          if (budget < 0) return null;
        }
      }
      return null;
    }

    return solve(lengths.slice());
  }

  function turns(path, cols) {
    let t = 0;
    for (let i = 2; i < path.length; i++) {
      const d1 = path[i - 1] - path[i - 2], d2 = path[i] - path[i - 1];
      if (d1 !== d2) t++;
    }
    return t;
  }

  // ---- difficulty analysis -------------------------------------------------
  // A trie of the common words lets us list every word a player could trace in a finished
  // board, and count how many ways the board splits into one word per slot.
  const trieCache = new WeakMap();
  function trieFor(words) {
    let t = trieCache.get(words);
    if (t) return t;
    t = {};
    for (const w of words) {
      let n = t;
      for (const ch of w) n = n[ch] || (n[ch] = {});
      n.$ = w;
    }
    trieCache.set(words, t);
    return t;
  }

  // Every traceable common word (4+ letters, up to maxLen) in the board.
  function traceableWords(letters, rows, cols, words, maxLen) {
    const trie = trieFor(words), out = [], used = new Array(letters.length).fill(false), path = [];
    function walk(i, node) {
      const nx = node[letters[i].toLowerCase()];
      if (!nx) return;
      used[i] = true; path.push(i);
      if (nx.$ && path.length >= 4) out.push({ word: nx.$, path: path.slice() });
      if (path.length < maxLen) for (const j of neighbours(i, rows, cols)) if (letters[j] && !used[j]) walk(j, nx);
      used[i] = false; path.pop();
    }
    for (let i = 0; i < letters.length; i++) if (letters[i]) walk(i, trie);
    return out;
  }

  // Number of ways (capped at `limit`) to cover every open tile with one traceable word per slot length.
  function countSolutions(cands, letters, lengths, limit) {
    const byCell = letters.map(() => []);
    cands.forEach((c, k) => c.path.forEach((cell) => byCell[cell].push(k)));
    const covered = letters.map((l) => !l), lenUsed = new Set(), wordUsed = new Set();
    let count = 0;
    (function rec() {
      if (count >= limit) return;
      const first = covered.indexOf(false);
      if (first < 0) { count++; return; }
      for (const k of byCell[first]) {
        const c = cands[k];
        if (lenUsed.has(c.word.length) || wordUsed.has(c.word) || !lengths.includes(c.word.length)) continue;
        if (c.path.some((cell) => covered[cell])) continue;
        c.path.forEach((cell) => (covered[cell] = true)); lenUsed.add(c.word.length); wordUsed.add(c.word);
        rec();
        c.path.forEach((cell) => (covered[cell] = false)); lenUsed.delete(c.word.length); wordUsed.delete(c.word);
      }
    })();
    return count;
  }

  function longestRun(path, cols) {
    let best = 2, run = 2;
    for (let i = 2; i < path.length; i++) {
      if (path[i] - path[i - 1] === path[i - 1] - path[i - 2]) run++; else run = 2;
      best = Math.max(best, run);
    }
    return best;
  }

  /**
   * generate({ seed, difficulty, answers }) ->
   *   { rows, cols, blocked:[idx], letters:[char|null], lengths:[...], solution:[{word,path}] }
   */
  function generate(opts) {
    const diff = DIFFICULTIES[opts.difficulty || 'easy'];
    const rnd = mulberry32(hashString(String(opts.seed)));
    const byLen = {};
    for (const w of opts.answers) if (!w.endsWith('s')) (byLen[w.length] = byLen[w.length] || []).push(w);
    const total = diff.lengths.reduce((a, b) => a + b, 0);
    const n = diff.rows * diff.cols;

    const started = Date.now();
    for (let attempt = 0; attempt < 20000; attempt++) {
      if (opts.maxMs && Date.now() - started > opts.maxMs) throw new Error('puzzle generation timed out');
      const blocked = pickBlocked(diff.rows, diff.cols, n - total, rnd);
      if (blocked.size !== n - total) continue;
      const paths = partition(diff.rows, diff.cols, blocked, diff.lengths, rnd);
      if (!paths) continue;
      // Finding a layout is the slow part; trying words on it is cheap. So re-roll the words on this
      // layout many times (most boards fail only for lack of decoys, which depends on the letters).
      for (let reroll = 0; reroll < 60; reroll++) {
        const used = new Set();
        const letters = new Array(n).fill(null);
        const solution = [];
        for (const p of paths) {
          const pool = byLen[p.length];
          let w;
          do { w = pool[Math.floor(rnd() * pool.length)]; } while (used.has(w));
          used.add(w);
          p.forEach((cell, k) => (letters[cell] = w[k].toUpperCase()));
          solution.push({ word: w.toUpperCase(), path: p });
        }
        // Make it a real puzzle: exactly one way to split the board into common words,
        // and plenty of decoy words that look right but lead nowhere.
        const cands = traceableWords(letters, diff.rows, diff.cols, opts.answers, diff.lengths[diff.lengths.length - 1]);
        const decoys = cands.filter((c) => !used.has(c.word) && diff.lengths.includes(c.word.length)).length;
        if (decoys < diff.minDecoys) continue;
        // Every answer must be traceable only along its own tiles. Otherwise a player could trace the right
        // word through the wrong tiles, get a green check, and be left with a board that can't be finished.
        const tilesKey = (pth) => pth.slice().sort((a, b) => a - b).join(',');
        const answerTiles = new Map(solution.map((x) => [x.word.toLowerCase(), tilesKey(x.path)]));
        if (cands.some((c) => answerTiles.has(c.word) && answerTiles.get(c.word) !== tilesKey(c.path))) continue;
        if (countSolutions(cands, letters, diff.lengths, 2) !== 1) continue;
        return { rows: diff.rows, cols: diff.cols, blocked: [...blocked], letters, lengths: diff.lengths.slice(), solution };
      }
    }
    throw new Error('could not generate puzzle');
  }

  const api = { generate, neighbours, DIFFICULTIES, hashString, traceableWords, countSolutions, longestRun };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WendGen = api;
})(typeof window !== 'undefined' ? window : globalThis);
