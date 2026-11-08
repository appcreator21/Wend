(function () {
  'use strict';
  const { generate, neighbours } = window.WendGen;
  const $ = (id) => document.getElementById(id);
  const DAILY_BY_WEEKDAY = ['hard', 'easy', 'easy', 'medium', 'medium', 'hard', 'medium']; // Sun..Sat
  const COLORS = 6;
  // Each slot (word length) keeps its own colour, in the same order as the original: pink, indigo, green, purple, cyan, orange.
  const SLOT_COLORS = [4, 5, 3, 2, 0, 1];

  const els = {
    board: $('board'), frame: $('frame'), slots: $('slots'), current: $('current'), toast: $('toast'), timer: $('timer'),
    modes: $('modes'), undo: $('undoBtn'), undoIcon: $('undoIcon'), hint: $('hintBtn'), newBtn: $('newBtn'), results: $('resultsBtn'),
    win: $('winDlg'), winStats: $('winStats'), share: $('shareText'), shareBtn: $('shareBtn'), settings: $('settingsDlg'),
  };

  let mode = 'daily';
  let puzzle, placed, slotWords, path, dragging, moved, startedAt, elapsed, timerId, solved, hints, hintCell, practiceN = 0;

  // ---------- persistence (all optional) ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
  };

  function todayKey() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // ---------- puzzle source ----------
  // Puzzles are pregenerated and verified at build time (tools/build-puzzles.js) so they load instantly.
  // Daily = the pool entry for today's date; practice = a random entry. Falls back to the live generator.
  function fromPool(difficulty) {
    const list = window.WEND_POOL && window.WEND_POOL[difficulty];
    if (!list || !list.length) return null;
    let idx;
    if (mode === 'daily') {
      const d = new Date();
      idx = Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000) % list.length;
    } else {
      idx = Math.floor(Math.random() * list.length);
    }
    const e = list[idx];
    const letters = e.l.split('').map((ch) => (ch === '#' ? null : ch));
    return {
      rows: e.r, cols: e.c, letters,
      blocked: letters.map((ch, i) => (ch ? -1 : i)).filter((i) => i >= 0),
      lengths: e.s.map((x) => x[0].length).sort((a, b) => a - b),
      solution: e.s.map(([word, path]) => ({ word, path })),
    };
  }

  // ---------- setup ----------
  function start(m) {
    mode = m || mode;
    clearInterval(timerId);
    let difficulty, seed;
    if (mode === 'daily') {
      difficulty = DAILY_BY_WEEKDAY[new Date().getDay()];
      seed = 'wend-daily-' + todayKey();
    } else {
      difficulty = mode;
      seed = 'wend-practice-' + mode + '-' + Date.now() + '-' + practiceN++;
    }
    puzzle = fromPool(difficulty) || generate({ seed, difficulty, answers: window.WEND_ANSWERS });
    puzzle.difficulty = difficulty;
    placed = [];
    path = [];
    dragging = false; moved = false; solved = false; hints = 0; hintCell = -1;
    startedAt = 0; elapsed = 0;
    slotWords = puzzle.lengths.map((len, k) => ({ len, color: SLOT_COLORS[k % COLORS], answer: puzzle.solution.find((x) => x.word.length === len).word, placed: null }));
    els.newBtn.hidden = mode === 'daily';
    [...els.modes.children].forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
    buildBoard();
    render();
    els.timer.textContent = '0:00';
  }

  const CELL = 100;
  const cx = (i) => (i % puzzle.cols) * CELL + CELL / 2;
  const cy = (i) => Math.floor(i / puzzle.cols) * CELL + CELL / 2;

  function buildBoard() {
    els.board.setAttribute('viewBox', '0 0 ' + puzzle.cols * CELL + ' ' + puzzle.rows * CELL);
  }

  const cellOwner = () => {
    const m = new Map();
    placed.forEach((p, k) => p.path.forEach((c) => m.set(c, k)));
    return m;
  };

  // While tracing, the path takes the colour of the slot a word this long would fill.
  const traceColor = () => { const s = slotWords.find((x) => x.len === path.length); return s ? 'var(--c' + s.color + ')' : 'var(--muted)'; };
  const pts = (p) => p.map((i) => cx(i) + ',' + cy(i)).join(' ');

  // Direction chevrons sitting on the boundary between consecutive tiles.
  function chevrons(p) {
    let out = '';
    for (let k = 1; k < p.length; k++) {
      const mx = (cx(p[k - 1]) + cx(p[k])) / 2, my = (cy(p[k - 1]) + cy(p[k])) / 2;
      const dx = Math.sign(cx(p[k]) - cx(p[k - 1])), dy = Math.sign(cy(p[k]) - cy(p[k - 1]));
      const px = -dy, py = dx; // perpendicular
      const tip = [mx + dx * 7, my + dy * 7], a = [mx - dx * 5 + px * 11, my - dy * 5 + py * 11], b = [mx - dx * 5 - px * 11, my - dy * 5 - py * 11];
      out += '<polyline class="chev" points="' + a + ' ' + tip + ' ' + b + '"/>';
    }
    return out;
  }

  function snake(p, color, cls) {
    if (p.length === 1) return '<circle class="pill-dot ' + cls + '" cx="' + cx(p[0]) + '" cy="' + cy(p[0]) + '" r="32" fill="' + color + '"/>';
    return '<polyline class="pill-path ' + cls + '" points="' + pts(p) + '" stroke="' + color + '"/>';
  }

  const CHECK = (x, y, color) => '<circle class="badge-bg" cx="' + x + '" cy="' + y + '" r="15" stroke="var(--c' + color + ')"/>' +
    '<path class="badge-check" d="M' + (x - 7) + ' ' + y + ' l5 5 l9 -10"/>';

  function render() {
    const owner = cellOwner();
    let svg = '';
    // 1. cell backgrounds. Neighbouring cells of the same word merge; different regions are
    //    separated by a thin gap that shows the light frame, like the original.
    const key = (i) => (i < 0 ? null : !puzzle.letters[i] ? 'b' : owner.has(i) ? 'w' + owner.get(i) : 'u');
    const inset = 2;
    puzzle.letters.forEach((ch, i) => {
      const r = Math.floor(i / puzzle.cols), c = i % puzzle.cols, x = c * CELL, y = r * CELL;
      const my = key(i);
      const diff = (rr, cc) => rr >= 0 && rr < puzzle.rows && cc >= 0 && cc < puzzle.cols && key(rr * puzzle.cols + cc) !== my;
      const l = diff(r, c - 1) ? inset : 0, rt = diff(r, c + 1) ? inset : 0, t = diff(r - 1, c) ? inset : 0, bm = diff(r + 1, c) ? inset : 0;
      const k = owner.get(i);
      const fill = !ch ? 'var(--blocked)' : k !== undefined ? 'var(--t' + placed[k].color + ')' : 'var(--cell)';
      svg += '<rect class="tile' + (ch ? '' : ' blocked') + '" data-i="' + i + '" x="' + (x + l) + '" y="' + (y + t) + '" width="' + (CELL - l - rt) + '" height="' + (CELL - t - bm) + '" fill="' + fill + '"/>';
    });
    if (hintCell >= 0) svg += '<rect class="hint-ring" x="' + (cx(hintCell) - 44) + '" y="' + (cy(hintCell) - 44) + '" width="88" height="88" rx="14"/>';
    // 2. word snakes, chevrons and badges
    placed.forEach((p) => {
      svg += snake(p.path, 'var(--c' + p.color + ')', '');
      svg += '<circle class="ring" cx="' + cx(p.path[0]) + '" cy="' + cy(p.path[0]) + '" r="33" stroke="color-mix(in srgb, var(--c' + p.color + ') 65%, #000)"/>';
    });
    placed.forEach((p) => { svg += chevrons(p.path); });
    if (path.length) {
      svg += '<g id="trace" class="trace">' + snake(path, traceColor(), '') + chevrons(path) + '</g>';
    }
    placed.filter((p) => p.correct).forEach((p) => {
      // Badge sits on the side of the first tile opposite to where the word heads.
      const dx = Math.sign(cx(p.path[1]) - cx(p.path[0])), dy = Math.sign(cy(p.path[1]) - cy(p.path[0]));
      const bx = dx ? -dx * 30 : 30, by = dx ? -30 : -dy * 30;
      svg += CHECK(cx(p.path[0]) + bx, cy(p.path[0]) + by, p.color);
    });
    // 3. letters on top
    puzzle.letters.forEach((ch, i) => {
      if (!ch) return;
      const on = owner.has(i) || path.includes(i);
      svg += '<text class="letter' + (on ? ' on' : '') + '" x="' + cx(i) + '" y="' + (cy(i) + 2) + '">' + ch + '</text>';
    });
    els.board.innerHTML = svg;

    els.current.textContent = path.map((i) => puzzle.letters[i]).join('') || ' ';
    els.results.disabled = !solved;
    els.undo.disabled = solved;
    els.undoIcon.disabled = solved || (!path.length && !placed.length);
    els.hint.disabled = solved;

    els.slots.innerHTML = '';
    slotWords.forEach((s) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'slot' + (s.placed ? ' filled' : '');
      b.setAttribute('aria-label', s.placed ? s.placed.word + (s.placed.correct ? ', correct' : ', not correct, tap to remove') : s.len + ' letter word, empty');
      for (let k = 0; k < s.len; k++) {
        const c = document.createElement('span');
        c.className = 'cell';
        if (s.placed) { c.textContent = s.placed.word[k]; c.style.background = 'var(--c' + s.color + ')'; }
        b.appendChild(c);
      }
      if (s.placed && s.placed.correct) {
        b.insertAdjacentHTML('beforeend', '<svg class="check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7"/></svg>');
      }
      b.addEventListener('click', () => { if (s.placed && !s.placed.correct && !solved) removeWord(s.placed); });
      els.slots.appendChild(b);
    });
  }

  let toastTimer;
  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), 1600);
  }

  function shake() {
    const g = document.getElementById('trace');
    if (g) { g.classList.remove('shake'); void g.getBoundingClientRect(); g.classList.add('shake'); }
  }

  // ---------- game logic ----------
  // Tiles of correct words are locked; tiles of wrong words can be traced over (that replaces the wrong word).
  function lockedSet() { const s = new Set(); placed.forEach((p) => { if (p.correct) p.path.forEach((c) => s.add(c)); }); return s; }

  function tick() {
    elapsed = Math.floor((Date.now() - startedAt) / 1000);
    els.timer.textContent = Math.floor(elapsed / 60) + ':' + String(elapsed % 60).padStart(2, '0');
  }
  function ensureTimer() {
    if (!startedAt) { startedAt = Date.now(); timerId = setInterval(tick, 500); }
  }

  function submit() {
    if (solved || !path.length) return;
    const word = path.map((i) => puzzle.letters[i]).join('');
    const clearSoon = () => setTimeout(() => { path = []; render(); }, 280);
    // The word goes into the slot with that many letters: an empty one first, else one holding a wrong word.
    const slots = slotWords.filter((x) => x.len === word.length);
    const slot = slots.find((x) => !x.placed) || slots.find((x) => !x.placed.correct);
    if (!slot) {
      toast(slots.length ? 'You already found the ' + word.length + '-letter word' : 'No ' + word.length + '-letter word in this puzzle');
      shake(); clearSoon(); return;
    }
    // Replace the slot's previous (wrong) word and any wrong words this path runs over.
    const mine = new Set(path);
    placed = placed.filter((p) => {
      const evict = p === slot.placed || p.path.some((c) => mine.has(c));
      if (evict) slotWords.forEach((x) => { if (x.placed === p) x.placed = null; });
      return !evict;
    });
    // Correct means the right word on the right tiles (the generator guarantees no other route spells it).
    const tiles = (p) => p.slice().sort((a, b) => a - b).join(',');
    const answerPath = puzzle.solution.find((x) => x.word === slot.answer).path;
    const entry = { word, path: path.slice(), color: slot.color, correct: word === slot.answer && tiles(path) === tiles(answerPath) };
    slot.placed = entry;
    placed.push(entry);
    path = []; hintCell = -1;
    if (entry.correct) toast('Correct!');
    checkWin();
    render();
  }

  function removeWord(entry) {
    placed = placed.filter((p) => p !== entry);
    slotWords.forEach((s) => { if (s.placed === entry) s.placed = null; });
    path = [];
    render();
  }

  function checkWin() {
    if (!slotWords.every((x) => x.placed && x.placed.correct)) return;
    solved = true;
    clearInterval(timerId); tick();
    let streakLine = '';
    if (mode === 'daily') {
      const st = store.get('wend.stats', { played: 0, streak: 0, best: 0, last: '' });
      const today = todayKey();
      if (st.last !== today) {
        const y = new Date(); y.setDate(y.getDate() - 1);
        const yk = y.getFullYear() + '-' + String(y.getMonth() + 1).padStart(2, '0') + '-' + String(y.getDate()).padStart(2, '0');
        st.streak = st.last === yk ? st.streak + 1 : 1;
        st.best = Math.max(st.best, st.streak);
        st.played++; st.last = today;
        store.set('wend.stats', st);
      }
      streakLine = ' · Streak ' + st.streak + ' (best ' + st.best + ')';
    }
    const time = els.timer.textContent;
    els.winStats.textContent = 'Solved in ' + time + (hints ? ' with ' + hints + ' hint' + (hints > 1 ? 's' : '') : '') + streakLine;
    els.share.textContent = shareText(time);
    setTimeout(() => (els.win.showModal ? els.win.showModal() : alert(els.share.textContent)), 350);
  }

  function shareText(time) {
    const grid = [];
    for (let r = 0; r < puzzle.rows; r++) {
      let line = '';
      for (let c = 0; c < puzzle.cols; c++) {
        const i = r * puzzle.cols + c;
        if (!puzzle.letters[i]) { line += '⬛'; continue; }
        const p = placed.find((q) => q.path.includes(i));
        line += ['🟦', '🟧', '🟪', '🟩', '🟥', '🟦'][p.color % 6];
      }
      grid.push(line);
    }
    const label = mode === 'daily' ? 'Wend ' + todayKey() : 'Wend (' + puzzle.difficulty + ')';
    return label + '\n' + time + (hints ? ' · ' + hints + ' hint' + (hints > 1 ? 's' : '') : '') + '\n' + grid.join('\n');
  }

  function hint() {
    if (solved) return;
    const cand = puzzle.solution.find((x) => !slotWords.some((sl) => sl.placed && sl.placed.correct && sl.answer === x.word));
    if (!cand) return;
    ensureTimer();
    hints++;
    hintCell = cand.path[0];
    path = [];
    render();
    toast('Start here — a ' + cand.path.length + '-letter word');
  }

  // ---------- input ----------
  function tileAt(x, y) {
    const r = els.board.getBoundingClientRect();
    const c = Math.floor(((x - r.left) / r.width) * puzzle.cols), row = Math.floor(((y - r.top) / r.height) * puzzle.rows);
    if (c < 0 || c >= puzzle.cols || row < 0 || row >= puzzle.rows) return -1;
    const i = row * puzzle.cols + c;
    return puzzle.letters[i] ? i : -1;
  }

  function onDown(e) {
    if (solved) return;
    const i = tileAt(e.clientX, e.clientY);
    if (i < 0 || lockedSet().has(i)) return;
    ensureTimer();
    e.preventDefault();
    hintCell = -1;
    dragging = true; moved = false;
    const last = path[path.length - 1];
    if (path.length && i === last) { dragging = 'maybeSubmit'; }
    else if (path.includes(i)) { path = path.slice(0, path.indexOf(i) + 1); }
    else if (path.length && neighbours(last, puzzle.rows, puzzle.cols).includes(i)) { path.push(i); }
    else { path = [i]; }
    try { els.frame.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    render();
  }

  function onMove(e) {
    if (!dragging) return;
    const i = tileAt(e.clientX, e.clientY);
    if (i < 0 || lockedSet().has(i)) return;
    const last = path[path.length - 1];
    if (i === last) return;
    if (path.length > 1 && i === path[path.length - 2]) { path.pop(); moved = true; render(); return; }
    if (!path.includes(i) && neighbours(last, puzzle.rows, puzzle.cols).includes(i)) {
      path.push(i); moved = true; dragging = true; render();
    }
  }

  function onUp() {
    if (!dragging) return;
    const wasSubmitTap = dragging === 'maybeSubmit' && !moved;
    dragging = false;
    if (moved || wasSubmitTap) submit();
  }

  els.frame.addEventListener('pointerdown', onDown);
  els.frame.addEventListener('pointermove', onMove);
  els.frame.addEventListener('pointerup', onUp);
  els.frame.addEventListener('pointercancel', () => { dragging = false; });
  const undo = () => {
    if (solved) return;
    if (path.length) { path = []; hintCell = -1; render(); }
    else if (placed.length) removeWord(placed[placed.length - 1]);
  };
  els.undo.addEventListener('click', undo);
  els.undoIcon.addEventListener('click', undo);
  $('backBtn').addEventListener('click', () => els.settings.showModal());
  els.hint.addEventListener('click', hint);
  els.results.addEventListener('click', () => els.win.showModal && els.win.showModal());
  els.newBtn.addEventListener('click', () => { els.settings.close(); start(); });
  els.modes.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { els.settings.close(); start(b.dataset.mode); } });
  $('settingsBtn').addEventListener('click', () => els.settings.showModal());
  els.shareBtn.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(els.share.textContent); els.shareBtn.textContent = 'Copied!'; }
    catch (e) { els.shareBtn.textContent = 'Select & copy above'; }
  });
  document.addEventListener('keydown', (e) => {
    if (document.querySelector('dialog[open]')) return;
    if (e.key === 'Enter') submit();
    else if (e.key === 'Escape') { path = []; render(); }
    else if (e.key === 'Backspace') { path.pop(); render(); }
  });


  // Test hook (used by tools/e2e.js)
  window.__wend = { get puzzle() { return puzzle; }, get solved() { return solved; } };
  start('daily');
})();
