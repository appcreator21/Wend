(function () {
  'use strict';
  const { generate, neighbours } = window.WendGen;
  const $ = (id) => document.getElementById(id);
  const DAILY_BY_WEEKDAY = ['hard', 'easy', 'easy', 'medium', 'medium', 'hard', 'medium']; // Sun..Sat
  const COLORS = 6;

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
    puzzle = generate({ seed, difficulty, answers: window.WEND_ANSWERS });
    puzzle.difficulty = difficulty;
    placed = [];
    path = [];
    dragging = false; moved = false; solved = false; hints = 0; hintCell = -1;
    startedAt = 0; elapsed = 0;
    slotWords = puzzle.lengths.map((len) => ({ len, placed: null }));
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

  const nextColor = () => { const u = new Set(placed.map((p) => p.color)); let c = 0; while (u.has(c)) c++; return c % COLORS; };
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
    if (p.length === 1) return '<circle class="pill-dot ' + cls + '" cx="' + cx(p[0]) + '" cy="' + cy(p[0]) + '" r="32" fill="var(--c' + color + ')"/>';
    return '<polyline class="pill-path ' + cls + '" points="' + pts(p) + '" stroke="var(--c' + color + ')"/>';
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
      const fill = !ch ? 'var(--blocked)' : k !== undefined ? 'var(--t' + placed[k].color % COLORS + ')' : 'var(--cell)';
      svg += '<rect class="tile' + (ch ? '' : ' blocked') + '" data-i="' + i + '" x="' + (x + l) + '" y="' + (y + t) + '" width="' + (CELL - l - rt) + '" height="' + (CELL - t - bm) + '" fill="' + fill + '"/>';
    });
    if (hintCell >= 0) svg += '<rect class="hint-ring" x="' + (cx(hintCell) - 44) + '" y="' + (cy(hintCell) - 44) + '" width="88" height="88" rx="14"/>';
    // 2. word snakes, chevrons and badges
    placed.forEach((p) => {
      svg += snake(p.path, p.color % COLORS, '');
      svg += '<circle class="ring" cx="' + cx(p.path[0]) + '" cy="' + cy(p.path[0]) + '" r="33" stroke="color-mix(in srgb, var(--c' + (p.color % COLORS) + ') 65%, #000)"/>';
    });
    placed.forEach((p) => { svg += chevrons(p.path); });
    if (path.length) {
      svg += '<g id="trace" class="trace">' + snake(path, nextColor(), '') + chevrons(path) + '</g>';
    }
    placed.forEach((p) => {
      // Badge sits on the side of the first tile opposite to where the word heads.
      const dx = Math.sign(cx(p.path[1]) - cx(p.path[0])), dy = Math.sign(cy(p.path[1]) - cy(p.path[0]));
      const bx = dx ? -dx * 30 : 30, by = dx ? -30 : -dy * 30;
      svg += CHECK(cx(p.path[0]) + bx, cy(p.path[0]) + by, p.color % COLORS);
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
      b.setAttribute('aria-label', s.placed ? s.placed.word + ', tap to remove' : s.len + ' letter word, empty');
      for (let k = 0; k < s.len; k++) {
        const c = document.createElement('span');
        c.className = 'cell';
        if (s.placed) { c.textContent = s.placed.word[k]; c.style.background = 'var(--c' + (s.placed.color % COLORS) + ')'; }
        b.appendChild(c);
      }
      if (s.placed) {
        b.insertAdjacentHTML('beforeend', '<svg class="check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7"/></svg>');
      }
      b.addEventListener('click', () => { if (s.placed && !solved) removeWord(s.placed); });
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
  function usedSet() { const s = new Set(); placed.forEach((p) => p.path.forEach((c) => s.add(c))); return s; }

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
    const reason = (() => {
      if (word.length < 3) return 'Words need at least 3 letters';
      const slot = slotWords.find((s) => !s.placed && s.len === word.length);
      if (!slot) return slotWords.some((s) => s.len === word.length) ? 'Already placed a ' + word.length + '-letter word' : 'No ' + word.length + '-letter word needed';
      if (!window.WEND_DICT.has(word.toLowerCase())) return 'Not in word list';
      return null;
    })();
    if (reason) { toast(reason); shake(); if (word.length >= 3) setTimeout(() => { path = []; render(); }, 280); return; }
    const slot = slotWords.find((s) => !s.placed && s.len === word.length);
    const used = new Set(placed.map((p) => p.color));
    let color = 0; while (used.has(color)) color++;
    const entry = { word, path: path.slice(), color };
    slot.placed = entry;
    placed.push(entry);
    path = []; hintCell = -1;
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
    const open = puzzle.letters.filter(Boolean).length;
    if (usedSet().size !== open) return;
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
        line += ['🟦', '🟪', '🟩', '🟧', '🟨', '🟫'][p.color % 6];
      }
      grid.push(line);
    }
    const label = mode === 'daily' ? 'Wend ' + todayKey() : 'Wend (' + puzzle.difficulty + ')';
    return label + '\n' + time + (hints ? ' · ' + hints + ' hint' + (hints > 1 ? 's' : '') : '') + '\n' + grid.join('\n');
  }

  function hint() {
    if (solved) return;
    const used = usedSet();
    const openLens = slotWords.filter((s) => !s.placed).map((s) => s.len);
    const cand = puzzle.solution.find((s) => s.path.every((c) => !used.has(c)) && openLens.includes(s.path.length));
    if (!cand) { toast('Remove a word to get a hint'); return; }
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
    if (i < 0 || usedSet().has(i)) return;
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
    if (i < 0 || usedSet().has(i)) return;
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
