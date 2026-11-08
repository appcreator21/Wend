// Wend puzzle generator. Works in the browser (window.WendGen) and Node (module.exports).
(function (root) {
  'use strict';

  const DIFFICULTIES = {
    easy:   { rows: 4, cols: 4, blocked: 0, sets: [[3, 4, 4, 5], [4, 4, 4, 4], [3, 3, 5, 5], [3, 3, 4, 6], [3, 4, 4, 5]] },
    medium: { rows: 4, cols: 5, blocked: 0, sets: [[4, 4, 6, 6], [3, 5, 6, 6], [4, 4, 4, 4, 4], [3, 4, 5, 4, 4], [3, 3, 4, 5, 5]] },
    hard:   { rows: 5, cols: 5, blocked: 3, sets: [[3, 4, 5, 5, 5], [4, 4, 4, 5, 5], [3, 3, 5, 5, 6], [3, 4, 4, 5, 6]] },
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
        const opts = shuffle(neighbours(path[path.length - 1], rows, cols).filter((j) => !covered[j]), rnd);
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

    function solve(remaining) {
      if (--budget < 0) return null;
      if (!remaining.length) return [];
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

  /**
   * generate({ seed, difficulty, answers }) ->
   *   { rows, cols, blocked:[idx], letters:[char|null], lengths:[...], solution:[{word,path}] }
   */
  function generate(opts) {
    const diff = DIFFICULTIES[opts.difficulty || 'easy'];
    const rnd = mulberry32(hashString(String(opts.seed)));
    const byLen = {};
    for (const w of opts.answers) (byLen[w.length] = byLen[w.length] || []).push(w);

    for (let attempt = 0; attempt < 500; attempt++) {
      const lengths = diff.sets[Math.floor(rnd() * diff.sets.length)];
      const blocked = diff.blocked ? pickBlocked(diff.rows, diff.cols, diff.blocked, rnd) : new Set();
      const open = diff.rows * diff.cols - blocked.size;
      if (lengths.reduce((a, b) => a + b, 0) !== open) continue;
      const paths = partition(diff.rows, diff.cols, blocked, lengths, rnd);
      if (!paths) continue;
      // Skip boards that are mostly straight lines: too easy to read off.
      const bendy = paths.filter((p) => p.length < 4 || turns(p, diff.cols) >= 1).length;
      if (bendy < paths.length) continue;

      const used = new Set();
      const letters = new Array(diff.rows * diff.cols).fill(null);
      const solution = [];
      for (const p of paths) {
        const pool = byLen[p.length];
        let w;
        do { w = pool[Math.floor(rnd() * pool.length)]; } while (used.has(w));
        used.add(w);
        p.forEach((cell, k) => (letters[cell] = w[k].toUpperCase()));
        solution.push({ word: w.toUpperCase(), path: p });
      }
      return {
        rows: diff.rows, cols: diff.cols, blocked: [...blocked],
        letters, lengths: lengths.slice().sort((a, b) => a - b), solution,
      };
    }
    throw new Error('could not generate puzzle');
  }

  const api = { generate, neighbours, DIFFICULTIES, hashString };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WendGen = api;
})(typeof window !== 'undefined' ? window : globalThis);
