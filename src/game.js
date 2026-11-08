(function () {
  'use strict';
  const { generate, neighbours } = window.WendGen;
  const $ = (id) => document.getElementById(id);
  const DAILY_BY_WEEKDAY = ['hard', 'easy', 'easy', 'medium', 'medium', 'hard', 'medium']; // Sun..Sat
  const COLORS = 6;
  // Each slot (word length) keeps its own colour, in the same order as the original: pink, indigo, green, purple, cyan, orange.
  const SLOT_COLORS = [4, 5, 3, 2, 0, 1];
  const FAST = /[?&]fast\b/.test(location.search); // tests: skip the loading screen's minimum time
  const CELL = 100;

  const els = {
    board: $('board'), frame: $('frame'), slots: $('slots'), current: $('current'), toast: $('toast'), timer: $('timer'),
    modes: $('modes'), undo: $('undoBtn'), undoIcon: $('undoIcon'), hint: $('hintBtn'), newBtn: $('newBtn'), results: $('resultsBtn'),
    win: $('winDlg'), winStats: $('winStats'), share: $('shareText'), shareBtn: $('shareBtn'), settings: $('settingsDlg'),
    clearChip: $('clearChip'), progBar: $('progBar'), progText: $('progText'), loader: $('loader'), confetti: $('confetti'),
    sound: $('soundToggle'), haptic: $('hapticToggle'),
  };

  let mode = 'daily';
  let puzzle, placed, slotWords, path, dragging, moved, tapWrong, lastPt, enterTile, startedAt, elapsed, timerId, solved, hints, hintCell, practiceN = 0;

  // ---------- persistence (all optional) ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
  };
  const prefs = Object.assign({ sound: true, haptics: true }, store.get('wend.prefs', {}));
  els.sound.checked = prefs.sound; els.haptic.checked = prefs.haptics;
  els.sound.addEventListener('change', () => { prefs.sound = els.sound.checked; store.set('wend.prefs', prefs); });
  els.haptic.addEventListener('change', () => { prefs.haptics = els.haptic.checked; store.set('wend.prefs', prefs); });

  function todayKey() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // ---------- feedback: vibration + sound ----------
  const buzz = (p) => { if (prefs.haptics && navigator.vibrate) try { navigator.vibrate(p); } catch (e) { /* ignore */ } };
  let actx;
  function tone(freq, dur, type, gain, delay) {
    if (!prefs.sound) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      const t = actx.currentTime + (delay || 0), o = actx.createOscillator(), g = actx.createGain();
      o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain || 0.06, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(actx.destination); o.start(t); o.stop(t + dur + 0.02);
    } catch (e) { /* audio is optional */ }
  }
  const sfx = {
    step: (n) => tone(300 * Math.pow(2, Math.min(n, 12) / 12), 0.07, 'triangle', 0.05),
    back: () => tone(240, 0.05, 'triangle', 0.035),
    right: () => { [523, 659, 784].forEach((f, k) => tone(f, 0.18, 'sine', 0.07, k * 0.07)); },
    wrong: () => { tone(170, 0.16, 'sawtooth', 0.04); tone(140, 0.2, 'sawtooth', 0.035, 0.08); },
    win: () => { [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, k) => tone(f, 0.22, 'sine', 0.07, k * 0.09)); },
  };

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

  // ---------- loading screen ----------
  let loaderTimer;
  function showLoader() {
    clearTimeout(loaderTimer);
    els.loader.hidden = false;
    els.loader.classList.remove('hide');
  }
  function hideLoader(afterMs) {
    clearTimeout(loaderTimer);
    loaderTimer = setTimeout(() => {
      els.loader.classList.add('hide');
      loaderTimer = setTimeout(() => { els.loader.hidden = true; }, 520);
    }, FAST ? 0 : afterMs);
  }

  // ---------- setup ----------
  function start(m, first) {
    mode = m || mode;
    clearInterval(timerId);
    if (!first) showLoader();
    const t0 = Date.now();
    let difficulty, seed;
    if (mode === 'daily') {
      difficulty = DAILY_BY_WEEKDAY[new Date().getDay()];
      seed = 'wend-daily-' + todayKey();
    } else {
      difficulty = mode;
      seed = 'wend-practice-' + mode + '-' + Date.now() + '-' + practiceN++;
    }
    // A fresh board can take a moment to generate (if the pool is missing); the loading screen covers it.
    setTimeout(() => {
      puzzle = fromPool(difficulty) || generate({ seed, difficulty, answers: window.WEND_ANSWERS });
      puzzle.difficulty = difficulty;
      placed = []; path = [];
      dragging = false; moved = false; tapWrong = null; solved = false; hints = 0; hintCell = -1; enterTile = -1; lastPt = null;
      startedAt = 0; elapsed = 0;
      slotWords = puzzle.lengths.map((len, k) => ({ len, color: SLOT_COLORS[k % COLORS], answer: puzzle.solution.find((x) => x.word.length === len).word, placed: null }));
      els.newBtn.hidden = mode === 'daily';
      [...els.modes.children].forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
      els.board.classList.remove('win');
      els.board.setAttribute('viewBox', '0 0 ' + puzzle.cols * CELL + ' ' + puzzle.rows * CELL);
      els.timer.textContent = '0:00';
      render();
      hideLoader(Math.max(0, (first ? 3000 : 1800) - (Date.now() - t0)));
    }, 30);
  }

  const cx = (i) => (i % puzzle.cols) * CELL + CELL / 2;
  const cy = (i) => Math.floor(i / puzzle.cols) * CELL + CELL / 2;
  const cellOwner = () => { const m = new Map(); placed.forEach((p, k) => p.path.forEach((c) => m.set(c, k))); return m; };
  const pts = (p) => p.map((i) => cx(i) + ',' + cy(i)).join(' ');
  const slotFor = (len) => slotWords.find((s) => s.len === len && (!s.placed || !s.placed.correct));

  // Direction chevrons sitting on the boundary between consecutive tiles.
  function chevrons(p) {
    let out = '';
    for (let k = 1; k < p.length; k++) {
      const mx = (cx(p[k - 1]) + cx(p[k])) / 2, my = (cy(p[k - 1]) + cy(p[k])) / 2;
      const dx = Math.sign(cx(p[k]) - cx(p[k - 1])), dy = Math.sign(cy(p[k]) - cy(p[k - 1]));
      const px = -dy, py = dx;
      const tip = [mx + dx * 7, my + dy * 7], a = [mx - dx * 5 + px * 11, my - dy * 5 + py * 11], b = [mx - dx * 5 - px * 11, my - dy * 5 - py * 11];
      out += '<polyline class="chev" points="' + a + ' ' + tip + ' ' + b + '"/>';
    }
    return out;
  }
  function snake(p, color, cls) {
    if (p.length === 1) return '<circle class="pill-dot ' + cls + '" cx="' + cx(p[0]) + '" cy="' + cy(p[0]) + '" r="32" fill="' + color + '"/>';
    return '<polyline class="pill-path ' + cls + '" points="' + pts(p) + '" stroke="' + color + '"/>';
  }
  const CHECK = (x, y, color, cls) => '<g class="' + cls + '"><circle class="badge-bg" cx="' + x + '" cy="' + y + '" r="15" stroke="var(--c' + color + ')"/>' +
    '<path class="badge-check" d="M' + (x - 7) + ' ' + y + ' l5 5 l9 -10"/></g>';

  // ---------- rendering ----------
  function render() {
    const owner = cellOwner();
    let svg = '';
    // 1. cell backgrounds: tiles of the same word merge; different regions are separated by a thin gap showing the frame.
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
      svg += snake(p.path, 'var(--c' + p.color + ')', p.fresh ? 'pop' : '');
      svg += '<circle class="ring" cx="' + cx(p.path[0]) + '" cy="' + cy(p.path[0]) + '" r="33" stroke="color-mix(in srgb, var(--c' + p.color + ') 65%, #000)"/>';
    });
    placed.forEach((p) => { svg += chevrons(p.path); });
    if (path.length) {
      const s = slotFor(path.length);
      svg += '<g id="trace" class="trace">' + snake(path, s ? 'var(--c' + s.color + ')' : 'var(--muted)', '') + chevrons(path) + '</g>';
      if (enterTile >= 0) svg += '<circle class="ripple" cx="' + cx(enterTile) + '" cy="' + cy(enterTile) + '" r="40" stroke="' + (s ? 'var(--c' + s.color + ')' : 'var(--muted)') + '"/>';
    }
    placed.filter((p) => p.correct).forEach((p) => {
      // Badge sits on the side of the first tile opposite to where the word heads.
      const dx = Math.sign(cx(p.path[1]) - cx(p.path[0])), dy = Math.sign(cy(p.path[1]) - cy(p.path[0]));
      const bx = dx ? -dx * 30 : 30, by = dx ? -30 : -dy * 30;
      svg += CHECK(cx(p.path[0]) + bx, cy(p.path[0]) + by, p.color, p.fresh ? 'enter' : '');
    });
    // 3. letters on top
    const freshCells = new Set(); placed.forEach((p) => { if (p.fresh) p.path.forEach((c) => freshCells.add(c)); });
    puzzle.letters.forEach((ch, i) => {
      if (!ch) return;
      const on = owner.has(i) || path.includes(i);
      const bounce = i === enterTile || freshCells.has(i);
      svg += '<text class="letter' + (on ? ' on' : '') + (bounce ? ' bounce' : '') + '" style="--d:' + i * 22 + 'ms" x="' + cx(i) + '" y="' + (cy(i) + 2) + '">' + ch + '</text>';
    });
    els.board.innerHTML = svg;

    // Live word chip (takes the colour of the slot it would fill) + clear button
    const word = path.map((i) => puzzle.letters[i]).join('');
    const target = path.length ? slotFor(path.length) : null;
    els.current.className = 'current' + (path.length ? ' active' : '') + (target ? ' fits' : '');
    els.current.style.setProperty('--chip', target ? 'var(--c' + target.color + ')' : 'var(--pill)');
    els.current.style.setProperty('--chip-text', target ? '#14181c' : 'var(--text)');
    els.current.textContent = path.length ? word : solved ? 'Puzzle solved!' : placed.length ? 'Tap a wrong word to remove it' : 'Drag across tiles to spell a word';
    els.clearChip.hidden = !path.length;

    els.results.disabled = !solved;
    els.results.classList.toggle('ready', solved);
    els.undo.disabled = solved;
    els.undoIcon.disabled = solved || (!path.length && !placed.length);
    els.hint.disabled = solved;
    els.board.classList.toggle('win', solved);

    // Progress: one segment per word
    els.progBar.innerHTML = slotWords.map((s) => '<i class="' + (s.placed && s.placed.correct ? 'on' : '') + '" style="' + (s.placed && s.placed.correct ? 'background:var(--c' + s.color + ')' : '') + '"></i>').join('');
    const found = slotWords.filter((s) => s.placed && s.placed.correct).length;
    els.progText.textContent = found + ' of ' + slotWords.length + ' words';

    els.slots.innerHTML = '';
    slotWords.forEach((s) => {
      const b = document.createElement('button');
      const wrong = s.placed && !s.placed.correct;
      b.type = 'button';
      b.className = 'slot' + (s.placed ? ' filled' : '') + (wrong ? ' wrong' : '') + (s.placed && s.placed.fresh ? ' fresh' : '') +
        (target === s ? ' target' : '');
      b.style.setProperty('--sc', 'var(--c' + s.color + ')');
      b.setAttribute('aria-label', s.placed ? s.placed.word + (s.placed.correct ? ', correct' : ', not correct, tap to remove') : s.len + ' letter word, empty');
      for (let k = 0; k < s.len; k++) {
        const c = document.createElement('span');
        c.className = 'cell';
        c.style.setProperty('--k', k);
        if (s.placed) { c.textContent = s.placed.word[k]; c.style.background = 'var(--c' + s.color + ')'; }
        b.appendChild(c);
      }
      if (s.placed && s.placed.correct) {
        b.insertAdjacentHTML('beforeend', '<svg class="check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7"/></svg>');
      } else if (wrong) {
        b.insertAdjacentHTML('beforeend', '<svg class="x" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>');
      }
      b.addEventListener('click', () => { if (wrong && !solved) removeWord(s.placed); });
      els.slots.appendChild(b);
    });

    // one-shot animation flags are consumed by this render
    enterTile = -1;
    placed.forEach((p) => { p.fresh = false; });
  }

  let toastTimer;
  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), 1700);
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
  function ensureTimer() { if (!startedAt) { startedAt = Date.now(); timerId = setInterval(tick, 500); } }

  function clearPath() { if (path.length) { path = []; hintCell = -1; render(); } }

  function submit() {
    if (solved || !path.length) return;
    const word = path.map((i) => puzzle.letters[i]).join('');
    const clearSoon = () => setTimeout(() => { path = []; render(); }, 300);
    // The word goes into the slot with that many letters: an empty one first, else one holding a wrong word.
    const slots = slotWords.filter((x) => x.len === word.length);
    const slot = slots.find((x) => !x.placed) || slots.find((x) => !x.placed.correct);
    if (!slot) {
      toast(slots.length ? 'You already found the ' + word.length + '-letter word' : (word.length < 4 ? 'Words are at least 4 letters' : 'No ' + word.length + '-letter word in this puzzle'));
      shake(); sfx.wrong(); buzz(30); clearSoon(); return;
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
    const entry = { word, path: path.slice(), color: slot.color, fresh: true, correct: word === slot.answer && tiles(path) === tiles(answerPath) };
    slot.placed = entry;
    placed.push(entry);
    path = []; hintCell = -1;
    if (entry.correct) { sfx.right(); buzz([14, 40, 14]); toast('Correct!'); }
    else { sfx.wrong(); buzz(35); toast('Not quite — tap it to remove'); }
    checkWin();
    render();
  }

  function removeWord(entry) {
    placed = placed.filter((p) => p !== entry);
    slotWords.forEach((s) => { if (s.placed === entry) s.placed = null; });
    path = [];
    sfx.back(); buzz(8);
    render();
  }

  function checkWin() {
    if (!slotWords.every((x) => x.placed && x.placed.correct)) return;
    solved = true;
    clearInterval(timerId); if (startedAt) tick();
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
    setTimeout(() => { sfx.win(); buzz([20, 50, 20, 50, 60]); confetti(); }, 250);
    setTimeout(() => (els.win.showModal ? els.win.showModal() : alert(els.share.textContent)), 1500);
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
    buzz(10);
    render();
    toast('Start here — a ' + cand.path.length + '-letter word');
  }

  // ---------- confetti ----------
  function confetti() {
    const cv = els.confetti, dpr = window.devicePixelRatio || 1;
    cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
    const ctx = cv.getContext('2d'); ctx.scale(dpr, dpr);
    const cols = ['#f43f6e', '#00b4d8', '#a259e6', '#4fbf1a', '#f58a00', '#6b6bf2'];
    const ps = Array.from({ length: 150 }, () => ({
      x: innerWidth / 2 + (Math.random() - .5) * 80, y: innerHeight * 0.38, vx: (Math.random() - .5) * 13, vy: -Math.random() * 13 - 4,
      w: 6 + Math.random() * 6, h: 4 + Math.random() * 5, r: Math.random() * 6, vr: (Math.random() - .5) * .4, c: cols[Math.floor(Math.random() * cols.length)],
    }));
    const t0 = performance.now();
    (function frame(now) {
      const t = now - t0;
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      ps.forEach((p) => {
        p.vy += 0.32; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.globalAlpha = Math.max(0, 1 - t / 2800);
        ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore();
      });
      if (t < 2800) requestAnimationFrame(frame); else ctx.clearRect(0, 0, innerWidth, innerHeight);
    })(t0);
  }

  // ---------- input ----------
  // Pointer positions are tracked in grid units and interpolated between events, so a fast flick
  // never skips a tile. A tile only counts once the pointer is near its centre, which stops
  // corner-cutting from jumping onto the wrong neighbour.
  const INNER = 0.38;
  function toGrid(e) {
    const r = els.board.getBoundingClientRect();
    return { gx: ((e.clientX - r.left) / r.width) * puzzle.cols, gy: ((e.clientY - r.top) / r.height) * puzzle.rows };
  }
  function cellAt(gx, gy, strict) {
    const c = Math.floor(gx), r = Math.floor(gy);
    if (c < 0 || c >= puzzle.cols || r < 0 || r >= puzzle.rows) return -1;
    if (strict && (Math.abs(gx - (c + .5)) > INNER || Math.abs(gy - (r + .5)) > INNER)) return -1;
    const i = r * puzzle.cols + c;
    return puzzle.letters[i] ? i : -1;
  }

  function consider(gx, gy, locked) {
    const i = cellAt(gx, gy, true);
    if (i < 0 || locked.has(i)) return;
    const last = path[path.length - 1];
    if (i === last) return;
    if (path.length > 1 && i === path[path.length - 2]) { path.pop(); moved = true; sfx.back(); render(); return; }
    if (!path.includes(i) && neighbours(last, puzzle.rows, puzzle.cols).includes(i)) {
      path.push(i); moved = true; enterTile = i;
      sfx.step(path.length); buzz(6); render();
    }
  }

  function onDown(e) {
    if (solved || !path) return;
    if (e.button > 0) return;
    const g = toGrid(e);
    const i = cellAt(g.gx, g.gy, false);
    if (i < 0) { clearPath(); return; }
    const locked = lockedSet();
    if (locked.has(i)) return;
    ensureTimer();
    e.preventDefault();
    hintCell = -1; moved = false; tapWrong = null; lastPt = g; dragging = true;
    const last = path[path.length - 1];
    if (path.length && i === last) { dragging = 'maybeSubmit'; }
    else if (path.includes(i)) { path = path.slice(0, path.indexOf(i) + 1); }
    else if (path.length && neighbours(last, puzzle.rows, puzzle.cols).includes(i)) { path.push(i); enterTile = i; sfx.step(path.length); buzz(6); }
    else {
      path = [i]; enterTile = i; sfx.step(1); buzz(6);
      tapWrong = placed.find((p) => !p.correct && p.path.includes(i)) || null; // a plain tap on a wrong word removes it
    }
    try { els.frame.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    render();
  }

  function onMove(e) {
    if (!dragging || !lastPt) return;
    const locked = lockedSet();
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of (evs.length ? evs : [e])) {
      const g = toGrid(ev);
      const dist = Math.hypot(g.gx - lastPt.gx, g.gy - lastPt.gy), n = Math.max(1, Math.ceil(dist / 0.12));
      for (let k = 1; k <= n; k++) consider(lastPt.gx + ((g.gx - lastPt.gx) * k) / n, lastPt.gy + ((g.gy - lastPt.gy) * k) / n, locked);
      lastPt = g;
    }
  }

  function onUp() {
    if (!dragging) return;
    const wasSubmitTap = dragging === 'maybeSubmit' && !moved;
    dragging = false;
    if (moved || wasSubmitTap) submit();
    else if (tapWrong) { const w = tapWrong; tapWrong = null; removeWord(w); }
    else if (path.length === 1) render(); // single tap: keep the tile selected for tap mode
  }

  els.frame.addEventListener('pointerdown', onDown);
  els.frame.addEventListener('pointermove', onMove);
  els.frame.addEventListener('pointerup', onUp);
  els.frame.addEventListener('pointercancel', () => { dragging = false; });
  els.frame.addEventListener('contextmenu', (e) => e.preventDefault());
  // Tapping anywhere outside the board also clears a half-built word.
  // (Capture phase: it must run before the board re-renders, which detaches the tapped tile.)
  document.addEventListener('pointerdown', (e) => { if (path && path.length && !e.target.closest('.frame, button, dialog, summary, a')) clearPath(); }, true);

  const undo = () => {
    if (solved) return;
    if (path.length) clearPath();
    else if (placed.length) removeWord(placed[placed.length - 1]);
  };
  els.undo.addEventListener('click', undo);
  els.undoIcon.addEventListener('click', undo);
  els.clearChip.addEventListener('click', clearPath);
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
    else if (e.key === 'Escape') clearPath();
    else if (e.key === 'Backspace') { path.pop(); render(); }
  });

  // Test hook (used by tools/e2e.js)
  window.__wend = { get puzzle() { return puzzle; }, get solved() { return solved; } };
  start('daily', true);
})();
