// Coil: a turn-based word-path duel played through Messages.
//
// One turn = one message. A message carries the whole duel: the score, the result of the last round,
// and the board the sender just solved together with their time. The receiver plays that board against
// the clock, the round is scored on their phone, and then they solve a fresh board and serve it back.
//
// The native side (Shared/GameHost.swift) only moves messages in and out; all game rules live here.
//   native -> page : Host.receive({ type: 'open' | 'presentation' | 'sent', ... })
//   page -> native : Host.post({ type: 'ready' | 'expand' | 'send' | 'haptic', ... })
(function () {
  'use strict';
  const Gen = window.WendGen;
  const $ = (id) => document.getElementById(id);
  const PENALTY = 15;      // seconds added per hint
  const TARGET_WINS = 3;   // first to this many rounds wins the duel
  const CELL = 100;
  const NAMES = { easy: 'Easy', medium: 'Medium', hard: 'Hard', expert: 'Expert' };
  const HEX = ['#ff6b6b', '#4ecdc4', '#ffd166', '#a78bfa', '#6ee7a0', '#ff9f5a', '#5fb4ff'];
  const fmt = (s) => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  const params = new URLSearchParams(location.search);
  const ENV = params.get('env') || 'web';   // 'messages' (the iMessage extension), 'app' (the home-screen app) or 'web'
  const native = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.host;

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage is optional */ } },
  };

  // ---------- bridge ----------
  const Host = {
    sent: [], // what the page posted, kept for tests and for running in a plain browser
    post(msg) {
      Host.sent.push(msg);
      if (native) native.postMessage(msg);
      else if (msg.type === 'send') setTimeout(() => Host.receive({ type: 'sent', ok: true }), 0);
    },
    receive(ev) {
      if (typeof ev === 'string') ev = JSON.parse(ev);
      if (ev.type === 'open') onOpen(ev);
      else if (ev.type === 'presentation') setStyle(ev.style);
      else if (ev.type === 'sent') onSent(ev);
    },
  };
  window.Host = Host;
  const haptic = (kind) => { if (native) native.postMessage({ type: 'haptic', kind }); };

  // ---------- sound ----------
  let actx;
  function tone(freq, dur, delay) {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      const t = actx.currentTime + (delay || 0), o = actx.createOscillator(), g = actx.createGain();
      o.type = 'triangle'; o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(actx.destination); o.start(t); o.stop(t + dur + 0.02);
    } catch (e) { /* audio is optional */ }
  }
  const sfx = {
    step: (n) => tone(280 * Math.pow(2, Math.min(n, 12) / 12), 0.06),
    right: () => [440, 554, 659].forEach((f, k) => tone(f, 0.16, k * 0.07)),
    wrong: () => tone(150, 0.18),
    win: () => [440, 554, 659, 880, 1109].forEach((f, k) => tone(f, 0.2, k * 0.09)),
  };

  // ---------- message payload ----------
  const b64e = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const b64d = (s) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));
  const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };
  // The checksum catches damaged messages and casual edits. It is not tamper-proof; this is a game between friends.
  const pack = (o) => b64e(JSON.stringify(Object.assign({}, o, { k: hash(JSON.stringify(o) + '|coil') })));

  function unpack(str) {
    try {
      const o = JSON.parse(b64d(str));
      const k = o.k; delete o.k;
      if (hash(JSON.stringify(o) + '|coil') !== k) return null;
      const okScore = Array.isArray(o.s) && o.s.length === 2 && o.s.every((x) => Number.isInteger(x) && x >= 0 && x < 100);
      if (o.v !== 1 || typeof o.id !== 'string' || !Number.isInteger(o.rd) || o.rd < 1 || (o.by !== 0 && o.by !== 1) || !okScore || !(o.to >= 1 && o.to <= 9)) return null;
      if (o.last && !(Array.isArray(o.last.t) && o.last.t.length === 2)) return null;
      if (o.over) return o;
      const { r, c, l, p } = o;
      if (!(r >= 3 && r <= 12 && c >= 3 && c <= 12) || typeof l !== 'string' || l.length !== r * c || !/^[A-Z_]+$/.test(l) || !Array.isArray(p) || p.length < 2 || p.length > 12) return null;
      const seen = new Set(), lens = new Set(), solution = [];
      for (const ps of p) {
        const cells = String(ps).split('.').map(Number);
        if (cells.length < 3 || cells.some((x) => !Number.isInteger(x) || x < 0 || x >= r * c || l[x] === '_' || seen.has(x))) return null;
        for (let i = 1; i < cells.length; i++) if (!Gen.neighbours(cells[i - 1], r, c).includes(cells[i])) return null;
        cells.forEach((x) => seen.add(x));
        if (lens.has(cells.length)) return null;
        lens.add(cells.length);
        solution.push({ word: cells.map((x) => l[x]).join(''), path: cells });
      }
      if (seen.size !== l.replace(/_/g, '').length) return null;
      if (!(o.t >= 0 && o.t < 864000)) return null;
      o.puzzle = { rows: r, cols: c, letters: l.split('').map((x) => (x === '_' ? null : x)), lengths: [...lens].sort((a, b) => a - b), solution, difficulty: NAMES[o.d] ? o.d : 'medium' };
      return o;
    } catch (e) { return null; }
  }
  const puzzleFields = (p) => ({ d: p.difficulty, r: p.rows, c: p.cols, l: p.letters.map((x) => x || '_').join(''), p: p.solution.map((s) => s.path.join('.')) });

  // What this phone remembers about a duel: the round it already played (so a round can't be replayed for a
  // better time), when its clock started, and the turn it has ready to send.
  const recKey = (id) => 'coil.duel.' + id;
  const loadRec = (id) => store.get(recKey(id), { answered: 0, start: {} });
  function saveRec(id, rec) {
    store.set(recKey(id), rec);
    const ids = store.get('coil.duels', []).filter((x) => x !== id);
    ids.push(id);
    while (ids.length > 30) { try { localStorage.removeItem(recKey(ids.shift())); } catch (e) { /* ignore */ } }
    store.set('coil.duels', ids);
  }

  // ---------- boards ----------
  function fromPool(difficulty) {
    const list = window.WEND_POOL && window.WEND_POOL[difficulty];
    if (!list || !list.length) return null;
    const e = list[Math.floor(Math.random() * list.length)];
    return { rows: e.r, cols: e.c, letters: e.l.split('').map((ch) => (ch === '#' ? null : ch)), lengths: e.s.map((x) => x[0].length).sort((a, b) => a - b), solution: e.s.map(([word, path]) => ({ word, path })) };
  }
  // A fresh board, made on the spot. If that takes too long on a slow phone, a pre-checked board is used instead.
  function makePuzzle(difficulty) {
    return new Promise((resolve, reject) => setTimeout(() => {
      let p = null;
      try { p = Gen.generate({ seed: 'coil-' + difficulty + '-' + Date.now() + '-' + Math.random(), difficulty, answers: window.WEND_ANSWERS, maxMs: 2500 }); }
      catch (e) { p = fromPool(difficulty); }
      if (!p) { reject(new Error('no board available')); return; }
      p.difficulty = difficulty;
      resolve(p);
    }, 30));
  }

  // ---------- state ----------
  const S = { screen: '', style: 'expanded', matchStr: null };
  let duel = null;   // { id, mySlot, s, to, last, nextRd, fresh, P }
  let game = null;   // the board being played

  function setStyle(style) {
    S.style = style === 'compact' ? 'compact' : 'expanded';
    document.documentElement.classList.toggle('compact', S.style === 'compact');
    $('resume').hidden = !(S.style === 'compact' && game && !game.solved);
  }
  const expand = () => { if (S.style === 'compact') Host.post({ type: 'expand' }); };

  // ---------- cards ----------
  function card(o) {
    S.screen = o.screen;
    $('play').hidden = true; $('resume').hidden = true; $('card').hidden = false;
    $('cardTitle').textContent = o.title || ''; $('cardTitle').className = o.cls || '';
    $('cardText').textContent = o.text || '';
    $('score').hidden = !o.score;
    if (o.score) {
      $('scoreMe').textContent = o.score[duel.mySlot]; $('scoreThem').textContent = o.score[1 - duel.mySlot];
      $('scoreNote').textContent = 'first to ' + duel.to;
    }
    $('picker').hidden = !o.pick; pickFn = o.pick || null;
    const btn = (el, def) => { el.hidden = !def; if (def) { el.textContent = def[0]; el.onclick = def[1]; } };
    btn($('cardMain'), o.main); btn($('cardAlt'), o.alt);
  }
  let pickFn = null;
  $('picker').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b && pickFn) pickFn(b.dataset.d); });
  $('howBtn').addEventListener('click', () => { expand(); $('howDlg').showModal(); });
  $('resume').addEventListener('click', () => Host.post({ type: 'expand' }));

  const newDuel = (fresh) => ({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8), mySlot: 0, s: [0, 0], to: TARGET_WINS, last: null, nextRd: 1, fresh });

  function home() {
    duel = null; S.matchStr = null;
    if (ENV === 'app') {
      card({ screen: 'home', title: 'Practice', text: 'Pick a board to warm up.\nTo duel someone, open a conversation in Messages and choose Coil from the apps row.', pick: (d) => serve(d, 'solo') });
    } else {
      card({ screen: 'home', title: 'Start a duel', text: 'Pick a board. Solve it, send it, and they race your time.',
        pick: (d) => { duel = newDuel(true); serve(d, 'serve'); }, alt: ['Practice solo', () => card({ screen: 'home', title: 'Practice', text: 'No clock to beat, nothing gets sent.', pick: (d) => serve(d, 'solo'), alt: ['Back', home] })] });
    }
  }

  // A message was opened (or arrived while the game was on screen).
  function onOpen(ev) {
    setStyle(ev.style || S.style);
    const busy = !!game && !game.solved;
    if (!ev.match) {
      // Opened from the apps row. Don't throw away a board in progress or a turn that is ready to send.
      if (!S.screen || (!busy && S.screen !== 'send' && S.screen !== 'after')) home();
      return;
    }
    if (ev.match === S.matchStr && S.screen && S.screen !== 'home') return; // already showing this turn
    if (ev.live && S.screen && !['home', 'waiting', 'over'].includes(S.screen)) return; // never interrupt play
    stopGame();
    openMatch(ev.match, !!ev.fromMe);
  }

  function openMatch(str, fromMe) {
    const P = unpack(str);
    if (!P) { home(); $('cardText').textContent = 'That message could not be read (it may be from a newer version). Start a new duel instead.'; return; }
    S.matchStr = str;
    const mySlot = fromMe ? P.by : 1 - P.by;
    const rec = loadRec(P.id);
    duel = { id: P.id, mySlot, s: P.s, to: P.to, last: P.last, nextRd: P.rd + 1, fresh: false, P };
    if (P.over) return over(P);
    if (fromMe) return waiting();
    if (rec.answered >= P.rd) { // this phone already played that round
      duel.s = rec.s; duel.last = rec.last;
      if (rec.sent) return waiting();
      return rec.out ? readyToSend() : afterAnswer();
    }
    intro(P, rec);
  }

  function intro(P, rec) {
    const running = rec.start && rec.start[P.rd];
    card({ screen: 'intro', score: P.s, title: 'Round ' + P.rd,
      text: 'They solved this ' + NAMES[P.puzzle.difficulty] + ' board in ' + fmt(P.t) + '.\n' + (running ? 'Your clock is already running!' : 'Beat that to win the round. The clock starts when you tap Play.'),
      main: [running ? 'Continue' : 'Play', () => {
        const r = loadRec(P.id);
        r.start = r.start || {};
        if (!r.start[P.rd]) { r.start[P.rd] = Date.now(); saveRec(P.id, r); }
        startGame(P.puzzle, 'answer', { startAt: r.start[P.rd], target: P.t, label: 'Round ' + P.rd });
      }] });
  }

  // The round is scored: show who took it, then it is this player's serve (or the duel is over).
  function afterAnswer() {
    const rec = loadRec(duel.id), last = rec.last, mine = last.t[duel.mySlot], theirs = last.t[1 - duel.mySlot];
    const res = mine < theirs ? 'win' : mine > theirs ? 'lose' : 'tie';
    const times = fmt(mine) + ' vs their ' + fmt(theirs);
    const done = Math.max(rec.s[0], rec.s[1]) >= duel.to;
    if (done) {
      const won = rec.s[duel.mySlot] > rec.s[1 - duel.mySlot];
      card({ screen: 'after', score: rec.s, cls: won ? 'win' : 'lose', title: won ? 'You win the duel!' : 'They win the duel', text: 'Last round: ' + times + '.', main: ['Send the result', send] });
    } else {
      card({ screen: 'after', score: rec.s, cls: res === 'tie' ? '' : res,
        title: res === 'win' ? 'You took round ' + last.rd : res === 'lose' ? 'They took round ' + last.rd : 'Round ' + last.rd + ' is a tie',
        text: times + '.\nYour serve: pick the next board.', pick: (d) => serve(d, 'serve') });
    }
  }

  function readyToSend() {
    const rec = loadRec(duel.id), P = unpack(rec.out);
    if (!P) return afterAnswer();
    if (P.over) return afterAnswer();
    card({ screen: 'send', score: P.s, title: 'Solved in ' + fmt(P.t), text: 'Send it. They have to beat your time on the same board.', main: ['Send', send] });
  }

  function waiting() {
    const rec = loadRec(duel.id);
    card({ screen: 'waiting', score: duel.s, title: 'Their turn',
      text: ENV === 'messages' ? 'If the message is still in the text field, tap the send arrow.\nYou get the next board when they have played.' : 'Waiting for the other player.',
      alt: rec.out ? ['Put the message back', send] : null });
  }

  function over(P) {
    const me = P.s[duel.mySlot], them = P.s[1 - duel.mySlot], won = me > them;
    let text = '';
    if (P.last) text = 'Last round: ' + fmt(P.last.t[duel.mySlot]) + ' vs their ' + fmt(P.last.t[1 - duel.mySlot]) + '.';
    card({ screen: 'over', score: P.s, cls: won ? 'win' : 'lose', title: won ? 'You won the duel!' : 'They won the duel', text,
      main: ['Rematch', () => { duel = newDuel(false); card({ screen: 'home', title: 'Rematch', text: 'Pick the first board.', pick: (d) => serve(d, 'serve') }); }] });
  }

  // Build a fresh board and play it: as this player's serve in a duel, or just for practice.
  function serve(difficulty, kind) {
    expand();
    card({ screen: 'building', title: 'Building a board…', score: kind === 'serve' ? duel.s : null });
    const mine = duel;
    makePuzzle(difficulty).then((p) => {
      if (S.screen !== 'building' || duel !== mine) return;
      startGame(p, kind, { startAt: Date.now(), label: kind === 'solo' ? 'Practice' : 'Round ' + duel.nextRd });
    }).catch(() => { home(); $('cardText').textContent = 'Could not build a board. Please try again.'; });
  }

  function send() {
    const rec = loadRec(duel.id), P = unpack(rec.out);
    if (!P) return;
    const a = P.s[P.by], b = P.s[1 - P.by];
    const line = a > b ? '{me} leads ' + a + '–' + b : a < b ? '{me} trails ' + a + '–' + b : a ? 'Tied ' + a + '–' + b : 'New duel';
    const msg = P.over
      ? { caption: a > b ? '{me} wins the duel ' + a + '–' + b : '{me} loses the duel ' + a + '–' + b, subcaption: 'Tap for a rematch', summary: 'Coil: the duel is over' }
      : { caption: 'Round ' + P.rd + ': beat ' + fmt(P.t), subcaption: line + ' · ' + NAMES[P.puzzle.difficulty], summary: 'Coil: your turn' };
    sending = duel.id;
    Host.post(Object.assign(msg, { type: 'send', match: rec.out, image: bubbleImage(P), newSession: !!rec.fresh }));
  }
  let sending = null;
  function onSent(ev) {
    if (!sending || !duel || duel.id !== sending) return;
    sending = null;
    if (!ev.ok) { $('cardText').textContent = 'Could not add the message to the conversation. Try again.'; return; }
    const rec = loadRec(duel.id);
    rec.sent = true; saveRec(duel.id, rec);
    S.matchStr = rec.out;
    const P = unpack(rec.out);
    duel.s = P.s;
    if (P.over) { duel.P = P; over(P); $('cardText').textContent = 'Result ready. Tap the send arrow to deliver it.'; } else waiting();
  }

  // The picture in the message bubble: the shape of the board (no letters, so nobody gets a head start) and the time to beat.
  function bubbleImage(P) {
    try {
      const W = 900, H = 600, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const ctx = cv.getContext('2d');
      const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#1b2050'); g.addColorStop(1, '#0f1226');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      const rr = (x, y, w, h, r) => { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h); ctx.fill(); };
      const font = (w, s) => w + ' ' + s + 'px -apple-system, system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      if (P.over) {
        ctx.fillStyle = '#9499c4'; ctx.font = font(700, 54); ctx.fillText('DUEL OVER', W / 2, 170);
        ctx.fillStyle = '#ffd166'; ctx.font = font(800, 220); ctx.fillText(Math.max(P.s[0], P.s[1]) + '–' + Math.min(P.s[0], P.s[1]), W / 2, 350);
      } else {
        const p = P.puzzle, size = 440, cell = size / Math.max(p.rows, p.cols), ox = 60, oy = (H - cell * p.rows) / 2;
        p.letters.forEach((ch, i) => {
          if (!ch) return;
          ctx.fillStyle = HEX[(i * 7 + (i % p.cols)) % HEX.length]; ctx.globalAlpha = 0.9;
          rr(ox + (i % p.cols) * cell + cell * 0.06, oy + Math.floor(i / p.cols) * cell + cell * 0.06, cell * 0.88, cell * 0.88, cell * 0.2);
        });
        ctx.globalAlpha = 1;
        const tx = 60 + size + (W - size - 60) / 2;
        ctx.fillStyle = '#9499c4'; ctx.font = font(700, 46); ctx.fillText('ROUND ' + P.rd, tx, 170);
        ctx.fillStyle = '#eef0ff'; ctx.font = font(600, 50); ctx.fillText('Beat', tx, 260);
        ctx.fillStyle = '#ffd166'; ctx.font = font(800, 130); ctx.fillText(fmt(P.t), tx, 360);
        ctx.fillStyle = '#9499c4'; ctx.font = font(600, 40); ctx.fillText(NAMES[p.difficulty], tx, 460);
      }
      return cv.toDataURL('image/jpeg', 0.85);
    } catch (e) { return null; }
  }

  // ---------- playing a board ----------
  const els = { board: $('board'), wrap: $('boardWrap'), slots: $('slots'), current: $('current'), timer: $('timer'), toast: $('toast') };

  function startGame(puzzle, kind, opts) {
    expand();
    game = { puzzle, kind, target: opts.target || 0, startAt: opts.startAt, hints: 0, hintCell: -1, found: [], path: [], solved: false, dragging: false, moved: false, lastPt: null,
      words: puzzle.lengths.map((len, k) => ({ len, color: k % HEX.length, sol: puzzle.solution.find((x) => x.word.length === len), found: false })) };
    S.screen = 'play';
    $('card').hidden = true; $('play').hidden = false;
    $('roundLabel').textContent = opts.label || '';
    $('target').textContent = game.target ? 'beat ' + fmt(game.target) : NAMES[puzzle.difficulty] || '';
    els.board.setAttribute('viewBox', '0 0 ' + puzzle.cols * CELL + ' ' + puzzle.rows * CELL);
    game.timerId = setInterval(tick, 500);
    tick(); render(); setStyle(S.style);
  }
  function stopGame() { if (game) { clearInterval(game.timerId); game = null; } $('resume').hidden = true; }

  const elapsed = () => Math.max(0, Math.floor((Date.now() - game.startAt) / 1000));
  function tick() {
    if (!game) return;
    const e = elapsed();
    els.timer.textContent = fmt(e + PENALTY * game.hints);
    els.timer.classList.toggle('over', !!game.target && e + PENALTY * game.hints > game.target);
  }

  const cx = (i) => (i % game.puzzle.cols) * CELL + CELL / 2;
  const cy = (i) => Math.floor(i / game.puzzle.cols) * CELL + CELL / 2;
  const lineSvg = (p, color) => p.length === 1
    ? '<circle class="dot" cx="' + cx(p[0]) + '" cy="' + cy(p[0]) + '" r="30" fill="' + color + '"/>'
    : '<polyline class="line" points="' + p.map((i) => cx(i) + ',' + cy(i)).join(' ') + '" stroke="' + color + '"/>';

  function render() {
    const p = game.puzzle, owner = new Map();
    game.words.forEach((w) => { if (w.found) w.sol.path.forEach((c) => owner.set(c, w)); });
    let svg = '';
    p.letters.forEach((ch, i) => {
      const x = (i % p.cols) * CELL, y = Math.floor(i / p.cols) * CELL;
      if (ch) svg += '<rect class="tile' + (i === game.hintCell ? ' hint' : '') + '" data-i="' + i + '" x="' + (x + 5) + '" y="' + (y + 5) + '" width="90" height="90" rx="18"/>';
    });
    game.words.forEach((w) => { if (w.found) svg += '<g class="' + (w.fresh ? 'found' : '') + '">' + lineSvg(w.sol.path, HEX[w.color]) + '</g>'; w.fresh = false; });
    const fit = game.words.find((w) => !w.found && w.len === game.path.length);
    if (game.path.length) svg += '<g id="trace" class="trace">' + lineSvg(game.path, fit ? HEX[fit.color] : '#9499c4') + '</g>';
    p.letters.forEach((ch, i) => { if (ch) svg += '<text class="letter' + (owner.has(i) || game.path.includes(i) ? ' on' : '') + '" x="' + cx(i) + '" y="' + cy(i) + '">' + ch + '</text>'; });
    els.board.innerHTML = svg;

    const word = game.path.map((i) => p.letters[i]).join('');
    els.current.textContent = word || (game.solved ? 'Solved!' : 'Drag across tiles to spell a word');
    els.current.className = 'current' + (word ? '' : ' idle');
    els.slots.innerHTML = game.words.map((w) => '<div class="slot">' + w.sol.word.split('').map((ch) => '<span' + (w.found ? ' style="background:' + HEX[w.color] + '">' + ch : '>') + '</span>').join('') + '</div>').join('');
  }

  let toastTimer;
  function toast(msg) {
    els.toast.textContent = msg; els.toast.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => els.toast.classList.remove('show'), 1600);
  }

  function submit() {
    const g = game;
    if (!g || g.solved || !g.path.length) return;
    const word = g.path.map((i) => g.puzzle.letters[i]).join('');
    const open = g.words.filter((w) => !w.found);
    if (word.length < open[0].len) return; // too short to be anything yet: keep it selected and keep going
    const key = (pth) => pth.slice().sort((a, b) => a - b).join(',');
    const hit = open.find((w) => w.sol.word === word && key(w.sol.path) === key(g.path));
    if (hit) {
      hit.found = true; hit.fresh = true; g.path = []; g.hintCell = -1;
      sfx.right(); haptic('success'); render();
      if (g.words.every((w) => w.found)) solved();
      return;
    }
    if (!open.some((w) => w.len === word.length)) { toast('No ' + word.length + '-letter word left'); return; }
    sfx.wrong(); haptic('error');
    const t = $('trace'); if (t) t.classList.add('shake');
    toast('Not a hidden word');
    setTimeout(() => { if (game === g && !g.dragging) { g.path = []; render(); } }, 320);
  }

  function solved() {
    const g = game;
    g.solved = true; clearInterval(g.timerId);
    const time = elapsed() + PENALTY * g.hints;
    els.timer.textContent = fmt(time);
    sfx.win();
    if (g.kind === 'answer') {
      // Score the round. Lower time wins; equal times score nothing.
      const P = duel.P, me = duel.mySlot, s = P.s.slice();
      if (time < P.t) s[me]++; else if (time > P.t) s[1 - me]++;
      const t = [0, 0]; t[me] = time; t[1 - me] = P.t;
      const rec = loadRec(duel.id);
      rec.answered = P.rd; rec.s = s; rec.last = { rd: P.rd, t }; rec.out = null; rec.sent = false;
      if (Math.max(s[0], s[1]) >= P.to) rec.out = pack({ v: 1, id: duel.id, rd: P.rd, by: me, s, to: P.to, last: rec.last, over: 1 });
      saveRec(duel.id, rec);
      duel.s = s; duel.last = rec.last;
    } else if (g.kind === 'serve') {
      const rec = loadRec(duel.id);
      rec.out = pack(Object.assign({ v: 1, id: duel.id, rd: duel.nextRd, by: duel.mySlot, s: duel.s, to: duel.to, last: duel.last }, puzzleFields(g.puzzle), { t: time, h: g.hints }));
      rec.sent = false; rec.fresh = !!duel.fresh;
      if (!rec.answered) { rec.answered = 0; rec.s = duel.s; rec.last = duel.last; }
      saveRec(duel.id, rec);
    }
    setTimeout(() => {
      if (game !== g) return;
      stopGame();
      if (g.kind === 'answer') afterAnswer();
      else if (g.kind === 'serve') readyToSend();
      else card({ screen: 'home', title: 'Solved in ' + fmt(time), text: 'Play another?', pick: (d) => serve(d, 'solo'), alt: ['Home', home] });
    }, params.has('fast') ? 0 : 1100);
  }

  $('hintBtn').addEventListener('click', () => {
    if (!game || game.solved) return;
    const w = game.words.find((x) => !x.found);
    game.hints++; game.hintCell = w.sol.path[0]; game.path = [];
    tick(); render(); toast('A ' + w.len + '-letter word starts here (+' + PENALTY + 's)');
  });
  $('quitBtn').addEventListener('click', () => {
    if (!game) return;
    const kind = game.kind;
    stopGame();
    if (kind === 'answer') intro(duel.P, loadRec(duel.id));
    else if (kind === 'serve' && !duel.fresh && duel.P && !duel.P.over) afterAnswer();
    else home();
  });

  // ---------- input ----------
  // Pointer positions are tracked in grid units and interpolated between events, so a fast flick never skips a
  // tile. While dragging, a tile only counts once the finger is near its centre, which stops corner-cutting
  // from catching the wrong neighbour.
  const INNER = 0.38;
  function toGrid(e) {
    const r = els.wrap.getBoundingClientRect(), p = game.puzzle;
    const scale = Math.min(r.width / p.cols, r.height / p.rows);
    return { gx: (e.clientX - r.left - (r.width - p.cols * scale) / 2) / scale, gy: (e.clientY - r.top - (r.height - p.rows * scale) / 2) / scale };
  }
  function cellAt(gx, gy, strict) {
    const p = game.puzzle, c = Math.floor(gx), r = Math.floor(gy);
    if (c < 0 || c >= p.cols || r < 0 || r >= p.rows) return -1;
    if (strict && (Math.abs(gx - (c + 0.5)) > INNER || Math.abs(gy - (r + 0.5)) > INNER)) return -1;
    const i = r * p.cols + c;
    return p.letters[i] ? i : -1;
  }
  const lockedSet = () => { const s = new Set(); game.words.forEach((w) => { if (w.found) w.sol.path.forEach((c) => s.add(c)); }); return s; };
  const adjacent = (a, b) => Gen.neighbours(a, game.puzzle.rows, game.puzzle.cols).includes(b);
  function addTile(i) { game.path.push(i); sfx.step(game.path.length); haptic('tick'); }

  els.wrap.addEventListener('pointerdown', (e) => {
    if (!game || game.solved) return;
    const g = toGrid(e), i = cellAt(g.gx, g.gy, false);
    if (i < 0) { if (game.path.length) { game.path = []; render(); } return; }
    if (lockedSet().has(i)) return;
    e.preventDefault();
    game.hintCell = -1; game.moved = false; game.lastPt = g; game.dragging = true;
    const path = game.path, last = path[path.length - 1];
    if (path.length && i === last) game.dragging = 'tapLast';           // tapping the last tile again places the word
    else if (path.includes(i)) game.path = path.slice(0, path.indexOf(i) + 1);
    else if (path.length && adjacent(last, i)) addTile(i);
    else { game.path = []; addTile(i); }
    try { els.wrap.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    render();
  });
  els.wrap.addEventListener('pointermove', (e) => {
    if (!game || !game.dragging || !game.lastPt) return;
    const locked = lockedSet();
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
    for (const ev of (evs.length ? evs : [e])) {
      const g = toGrid(ev), from = game.lastPt;
      const n = Math.max(1, Math.ceil(Math.hypot(g.gx - from.gx, g.gy - from.gy) / 0.12));
      for (let k = 1; k <= n; k++) {
        const i = cellAt(from.gx + ((g.gx - from.gx) * k) / n, from.gy + ((g.gy - from.gy) * k) / n, true);
        const path = game.path, last = path[path.length - 1];
        if (i < 0 || locked.has(i) || i === last) continue;
        if (path.length > 1 && i === path[path.length - 2]) { path.pop(); game.moved = true; render(); }
        else if (!path.includes(i) && adjacent(last, i)) { addTile(i); game.moved = true; render(); }
      }
      game.lastPt = g;
    }
  });
  const release = () => {
    if (!game || !game.dragging) return;
    const tapLast = game.dragging === 'tapLast' && !game.moved;
    const moved = game.moved;
    game.dragging = false;
    if (moved || tapLast) submit();
  };
  els.wrap.addEventListener('pointerup', release);
  els.wrap.addEventListener('pointercancel', () => { if (game) game.dragging = false; });
  document.addEventListener('contextmenu', (e) => e.preventDefault());

  // Test hook (imessage/tools/test-duel.js)
  window.__coil = { get game() { return game; }, get screen() { return S.screen; }, get duel() { return duel; }, unpack };

  setStyle(params.get('style') || 'expanded');
  Host.post({ type: 'ready' });
  if (!native) Host.receive({ type: 'open', style: S.style, match: params.get('m'), fromMe: params.has('mine') });
})();
