(function () {
  'use strict';
  const { generate, neighbours } = window.WendGen;
  const $ = (id) => document.getElementById(id);
  const DAILY_BY_WEEKDAY = ['hard', 'easy', 'easy', 'medium', 'medium', 'hard', 'medium']; // Sun..Sat
  const COLORS = 6;

  const els = {
    board: $('board'), slots: $('slots'), current: $('current'), toast: $('toast'), timer: $('timer'),
    modes: $('modes'), submit: $('submitBtn'), clear: $('clearBtn'), hint: $('hintBtn'), newBtn: $('newBtn'),
    win: $('winDlg'), winStats: $('winStats'), share: $('shareText'), shareBtn: $('shareBtn'), help: $('helpDlg'),
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

  function buildBoard() {
    els.board.style.gridTemplateColumns = 'repeat(' + puzzle.cols + ', 1fr)';
    els.board.innerHTML = '';
    puzzle.letters.forEach((ch, i) => {
      const t = document.createElement('div');
      t.className = 'tile' + (ch ? '' : ' blocked');
      t.dataset.i = i;
      if (ch) {
        t.textContent = ch;
        t.setAttribute('role', 'gridcell');
        t.setAttribute('aria-label', ch + ', row ' + (Math.floor(i / puzzle.cols) + 1) + ' column ' + ((i % puzzle.cols) + 1));
      } else t.setAttribute('aria-hidden', 'true');
      els.board.appendChild(t);
    });
  }

  // ---------- rendering ----------
  const cellOwner = () => {
    const m = new Map();
    placed.forEach((p, k) => p.path.forEach((c) => m.set(c, k)));
    return m;
  };

  function render() {
    const owner = cellOwner();
    [...els.board.children].forEach((t, i) => {
      if (!puzzle.letters[i]) return;
      const k = owner.get(i);
      t.classList.toggle('used', k !== undefined);
      t.style.background = k !== undefined ? 'var(--w' + (placed[k].color % COLORS) + ')' : '';
      t.classList.toggle('trace', path.includes(i));
      t.classList.toggle('hint', i === hintCell);
    });
    els.current.textContent = path.map((i) => puzzle.letters[i]).join('') || ' ';

    els.slots.innerHTML = '';
    slotWords.forEach((s, idx) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'slot' + (s.placed ? ' filled' : '');
      b.setAttribute('aria-label', s.placed ? s.placed.word + ', tap to remove' : s.len + ' letter word, empty');
      for (let k = 0; k < s.len; k++) {
        const c = document.createElement('span');
        c.className = 'cell';
        if (s.placed) { c.textContent = s.placed.word[k]; c.style.background = 'var(--w' + (s.placed.color % COLORS) + ')'; }
        b.appendChild(c);
      }
      const l = document.createElement('span');
      l.className = 'len';
      l.textContent = s.len;
      b.appendChild(l);
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
    path.forEach((i) => {
      const t = els.board.children[i];
      t.classList.remove('shake'); void t.offsetWidth; t.classList.add('shake');
    });
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
    if (reason) { toast(reason); shake(); if (word.length >= 3) path = []; render(); return; }
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
    const el = document.elementFromPoint(x, y);
    const t = el && el.closest && el.closest('.tile');
    if (!t || t.classList.contains('blocked')) return -1;
    return +t.dataset.i;
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
    try { els.board.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
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

  els.board.addEventListener('pointerdown', onDown);
  els.board.addEventListener('pointermove', onMove);
  els.board.addEventListener('pointerup', onUp);
  els.board.addEventListener('pointercancel', () => { dragging = false; });
  els.submit.addEventListener('click', submit);
  els.clear.addEventListener('click', () => { path = []; hintCell = -1; render(); });
  els.hint.addEventListener('click', hint);
  els.newBtn.addEventListener('click', () => start());
  els.modes.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) start(b.dataset.mode); });
  $('helpBtn').addEventListener('click', () => els.help.showModal());
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

  if (!store.get('wend.seenHelp', false)) { store.set('wend.seenHelp', true); setTimeout(() => els.help.showModal && els.help.showModal(), 300); }

  // Test hook (used by tools/e2e.js)
  window.__wend = { get puzzle() { return puzzle; }, get solved() { return solved; } };
  start('daily');
})();
