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
  const HEX = ['#ff453a', '#64d2ff', '#ffd60a', '#bf5af2', '#32d74b', '#ff9f0a', '#5e8bff'];
  const fmt = (s) => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  const params = new URLSearchParams(location.search);
  const ENV = params.get('env') || 'web';   // 'messages' (the iMessage extension), 'app' (the home-screen app) or 'web'
  const AUTO = ENV === 'messages';          // inside Messages a finished turn is sent straight away, like GamePigeon
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
    back: () => tone(240, 0.05),
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
    layout();
  }
  const expand = () => { if (S.style === 'compact') Host.post({ type: 'expand' }); };

  // ---------- cards ----------
  function card(o) {
    S.screen = o.screen;
    $('play').hidden = true; $('resume').hidden = true; $('card').hidden = false;
    $('cardTitle').textContent = o.title || ''; $('cardTitle').className = o.cls || '';
    $('cardText').textContent = o.text || '';
    $('cardLead').textContent = o.lead || '';   // only shown in the compact drawer, where the stat panel is hidden
    $('busy').hidden = !o.busy;
    $('hero').hidden = !(o.screen === 'home' && !o.score);
    $('score').hidden = !o.score;
    if (o.score) {
      const me = o.score[duel.mySlot], them = o.score[1 - duel.mySlot];
      const pips = (n) => Array.from({ length: duel.to }, (_, k) => '<i' + (k < n ? ' class="on"' : '') + '></i>').join('');
      $('scoreMe').textContent = me; $('scoreThem').textContent = them;
      $('pipsMe').innerHTML = pips(me); $('pipsThem').innerHTML = pips(them);
      $('sideMe').classList.toggle('lead', me > them); $('sideThem').classList.toggle('lead', them > me);
      $('scoreNote').textContent = 'first to ' + duel.to;
    }
    // stat: [[label, value, note or '', class or ''], ...]
    $('stat').hidden = !o.stat;
    $('stat').innerHTML = (o.stat || []).map((c) => '<div class="' + (c[3] || '') + '"><small>' + c[0] + '</small><b>' + c[1] + '</b>' + (c[2] ? '<em>' + c[2] + '</em>' : '') + '</div>').join('');
    const inner = $('cardInner');
    inner.classList.remove('in'); void inner.offsetWidth; inner.classList.add('in');
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
      // The home-screen app: start a challenge right here (Messages' own sheet picks who gets it), or practise.
      card({ screen: 'home', title: 'Duel a friend', text: 'Solve a board, then send it. They race your time in Messages.',
        main: ['Challenge a friend', challengeBoard],
        alt: ['Practice solo', () => card({ screen: 'home', title: 'Practice', text: 'No clock to beat, nothing gets sent.', pick: (d) => serve(d, 'solo'), alt: ['Back', home] })] });
    } else {
      card({ screen: 'home', title: 'Start a duel', text: 'Pick a board. Solve it, send it, and they race your time.',
        pick: (d) => { duel = newDuel(true); serve(d, 'serve'); }, alt: ['Practice solo', () => card({ screen: 'home', title: 'Practice', text: 'No clock to beat, nothing gets sent.', pick: (d) => serve(d, 'solo'), alt: ['Back', home] })] });
    }
  }

  // The app's challenge: pick a level, solve the board, then choose who to send it to.
  function challengeBoard() {
    duel = newDuel(true);
    card({ screen: 'home', title: 'Pick a level', text: 'You solve it first, then choose who gets the challenge.', pick: (d) => serve(d, 'serve'), alt: ['Back', home] });
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
      stat: [['Time to beat', fmt(P.t), NAMES[P.puzzle.difficulty] + ' \u00b7 ' + P.puzzle.cols + '\u00d7' + P.puzzle.rows]],
      lead: 'They solved this ' + NAMES[P.puzzle.difficulty] + ' board in ' + fmt(P.t) + '.',
      text: running ? 'Your clock is already running!' : 'Beat that to win the round. The clock starts when you tap Play.',
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
    const stat = [['You', fmt(mine), '', res === 'win' ? 'best' : 'dim'], ['Them', fmt(theirs), '', res === 'lose' ? 'best' : 'dim']];
    if (done) {
      const won = rec.s[duel.mySlot] > rec.s[1 - duel.mySlot];
      card({ screen: 'after', score: rec.s, cls: won ? 'win' : 'lose', title: won ? 'You win the duel!' : 'They win the duel', stat, lead: 'Last round: ' + times + '.', main: ['Send the result', send] });
    } else {
      card({ screen: 'after', score: rec.s, cls: res === 'tie' ? '' : res,
        title: res === 'win' ? 'You took round ' + last.rd : res === 'lose' ? 'They took round ' + last.rd : 'Round ' + last.rd + ' is a tie',
        stat, lead: times + '.', text: 'Your serve: pick the next board.', pick: (d) => serve(d, 'serve') });
    }
  }

  function readyToSend() {
    const rec = loadRec(duel.id), P = unpack(rec.out);
    if (!P) return afterAnswer();
    if (P.over) return afterAnswer();
    card({ screen: 'send', score: P.s, title: 'Ready to serve', lead: 'You solved it in ' + fmt(P.t) + '.',
      stat: [['Your time', fmt(P.t), NAMES[P.puzzle.difficulty] + (P.h ? ' \u00b7 ' + P.h + (P.h === 1 ? ' hint' : ' hints') : ' \u00b7 no hints')]],
      text: ENV === 'app' ? 'Choose who to send it to. They have to beat your time on the same board.' : 'Send it. They have to beat your time on the same board.',
      main: [ENV === 'app' ? 'Choose who to send to' : 'Send', send] });
  }

  function waiting() {
    const rec = loadRec(duel.id);
    if (ENV === 'app') {
      card({ screen: 'waiting', score: duel.s, title: 'Challenge sent', text: 'They play it in Messages. When they have, you get the next board there.',
        main: ['Open Messages', () => Host.post({ type: 'openMessages' })], alt: ['Done', home] });
      return;
    }
    card({ screen: 'waiting', score: duel.s, title: 'Their turn',
      text: ENV === 'messages' ? (rec.inserted ? 'If the message is still in the text field, tap the send arrow.\nYou get the next board when they have played.' : 'Sent. You get the next board when they have played.') : 'Waiting for the other player.',
      alt: rec.out ? ['Put the message back', send] : null });
  }

  function over(P) {
    const me = P.s[duel.mySlot], them = P.s[1 - duel.mySlot], won = me > them;
    let lead = '', stat = null;
    if (P.last) {
      const mine = P.last.t[duel.mySlot], theirs = P.last.t[1 - duel.mySlot];
      lead = 'Last round: ' + fmt(mine) + ' vs their ' + fmt(theirs) + '.';
      stat = [['You', fmt(mine), '', mine < theirs ? 'best' : 'dim'], ['Them', fmt(theirs), '', theirs < mine ? 'best' : 'dim']];
    }
    card({ screen: 'over', score: P.s, cls: won ? 'win' : 'lose', title: won ? 'You won the duel!' : 'They won the duel', lead, stat,
      main: ['Rematch', () => { duel = newDuel(false); card({ screen: 'home', title: 'Rematch', text: 'Pick the first board.', pick: (d) => serve(d, 'serve') }); }] });
  }

  // Build a fresh board and play it: as this player's serve in a duel, or just for practice.
  function serve(difficulty, kind) {
    expand();
    card({ screen: 'building', busy: true, title: 'Building a board…', score: kind === 'serve' ? duel.s : null });
    const mine = duel;
    makePuzzle(difficulty).then((p) => {
      if (S.screen !== 'building' || duel !== mine) return;
      startGame(p, kind, { startAt: Date.now(), label: kind === 'solo' ? 'Practice' : 'Round ' + duel.nextRd });
    }).catch(() => { home(); $('cardText').textContent = 'Could not build a board. Please try again.'; });
  }

  // `auto` is true only when the page sends by itself; the Send buttons pass a click event, which is not.
  function send(auto) {
    const rec = loadRec(duel.id), P = unpack(rec.out);
    if (!P) return;
    const a = P.s[P.by], b = P.s[1 - P.by];
    const line = a > b ? '{me} leads ' + a + '–' + b : a < b ? '{me} trails ' + a + '–' + b : a ? 'Tied ' + a + '–' + b : 'New duel';
    const msg = P.over
      ? { caption: a > b ? '{me} wins the duel ' + a + '–' + b : '{me} loses the duel ' + a + '–' + b, subcaption: 'Tap for a rematch', summary: 'Coil: the duel is over' }
      : { caption: 'Round ' + P.rd + ': beat ' + fmt(P.t), subcaption: line + ' · ' + NAMES[P.puzzle.difficulty], summary: 'Coil: your turn' };
    sending = duel.id;
    Host.post(Object.assign(msg, { type: 'send', match: rec.out, image: bubbleImage(P), newSession: !!rec.fresh, auto: auto === true }));
  }
  // Inside Messages the turn goes out the moment the board is solved. If Messages refuses, the native side falls
  // back to putting it in the text field, and if that fails too the Send button is still there.
  function autoSend() {
    const rec = loadRec(duel.id), P = unpack(rec.out);
    if (!P) return;
    card({ screen: 'send', score: P.s, busy: true, title: P.over ? 'Sending the result\u2026' : 'Sending your serve\u2026' });
    send(true);
  }
  let sending = null;
  function onSent(ev) {
    if (!sending || !duel || duel.id !== sending) return;
    sending = null;
    if (!ev.ok) {
      if (AUTO) { const r = loadRec(duel.id), Q = unpack(r.out); if (Q && Q.over) afterAnswer(); else if (Q) readyToSend(); }
      if (!ev.cancelled) $('cardText').textContent = ev.reason === 'unavailable' ? 'This device cannot send messages. Set up Messages and try again.' : 'Could not add the message to the conversation. Try again.';
      return;
    }
    const rec = loadRec(duel.id);
    rec.sent = true; rec.inserted = !!ev.inserted; saveRec(duel.id, rec);
    S.matchStr = rec.out;
    const P = unpack(rec.out);
    duel.s = P.s;
    if (P.over) { duel.P = P; over(P); $('cardText').textContent = ev.inserted ? 'Result ready. Tap the send arrow to deliver it.' : 'Result sent.'; } else waiting();
  }

  // The picture in the message bubble: the shape of the board (no letters, so nobody gets a head start) and the time to beat.
  function bubbleImage(P) {
    try {
      const W = 900, H = 600, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const ctx = cv.getContext('2d');
      const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#1c2250'); g.addColorStop(1, '#08080d');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      const rr = (x, y, w, h, r) => { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h); ctx.fill(); };
      const font = (w, s) => w + ' ' + s + 'px -apple-system, system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      if (P.over) {
        ctx.fillStyle = '#8e8e93'; ctx.font = font(700, 54); ctx.fillText('DUEL OVER', W / 2, 170);
        ctx.fillStyle = '#ffd60a'; ctx.font = font(800, 220); ctx.fillText(Math.max(P.s[0], P.s[1]) + '–' + Math.min(P.s[0], P.s[1]), W / 2, 350);
      } else {
        const p = P.puzzle, size = 440, cell = size / Math.max(p.rows, p.cols), ox = 60, oy = (H - cell * p.rows) / 2;
        p.letters.forEach((ch, i) => {
          if (!ch) return;
          ctx.fillStyle = HEX[(i * 7 + (i % p.cols)) % HEX.length]; ctx.globalAlpha = 0.9;
          rr(ox + (i % p.cols) * cell + cell * 0.06, oy + Math.floor(i / p.cols) * cell + cell * 0.06, cell * 0.88, cell * 0.88, cell * 0.2);
        });
        ctx.globalAlpha = 1;
        const tx = 60 + size + (W - size - 60) / 2;
        ctx.fillStyle = '#8e8e93'; ctx.font = font(700, 46); ctx.fillText('ROUND ' + P.rd, tx, 170);
        ctx.fillStyle = '#ffffff'; ctx.font = font(600, 50); ctx.fillText('Beat', tx, 260);
        ctx.fillStyle = '#ffd60a'; ctx.font = font(800, 130); ctx.fillText(fmt(P.t), tx, 360);
        ctx.fillStyle = '#8e8e93'; ctx.font = font(600, 40); ctx.fillText(NAMES[p.difficulty], tx, 460);
      }
      return cv.toDataURL('image/jpeg', 0.85);
    } catch (e) { return null; }
  }

  // ---------- playing a board ----------
  const els = { board: $('board'), wrap: $('boardWrap'), slots: $('slots'), current: $('current'), clear: $('clearChip'), timer: $('timer'), toast: $('toast'),
    progBar: $('progBar'), undo: $('undoBtn'), progText: $('progText'), confetti: $('confetti') };
  const FRAME = 6;   // board frame thickness, in board units (a tile is CELL units wide)

  function startGame(puzzle, kind, opts) {
    expand();
    // Same model as the web game: a word you place goes into the slot of its length and stays on the board,
    // right or wrong. `placed` holds every word on the board; a slot holds the word currently in it.
    game = { puzzle, kind, target: opts.target || 0, startAt: opts.startAt, hints: 0, hintCell: -1, placed: [], path: [], solved: false, dragging: false, moved: false, lastPt: null,
      tapWrong: null, pickup: null,
      words: puzzle.lengths.map((len, k) => ({ len, color: k % HEX.length, sol: puzzle.solution.find((x) => x.word.length === len), placed: null })) };
    S.screen = 'play';
    $('card').hidden = true; $('play').hidden = false;
    $('roundLabel').textContent = opts.label || '';
    $('target').textContent = game.target ? 'beat ' + fmt(game.target) : '';
    $('target').classList.toggle('beat', !!game.target);
    els.board.setAttribute('viewBox', -FRAME + ' ' + -FRAME + ' ' + (puzzle.cols * CELL + 2 * FRAME) + ' ' + (puzzle.rows * CELL + 2 * FRAME));
    els.toast.classList.remove('show');
    game.enterTile = -1; game.deal = true;
    game.timerId = setInterval(tick, 500);
    tick(); render(); layout(); setStyle(S.style);
  }
  function stopGame() { if (game) { clearInterval(game.timerId); game = null; } $('resume').hidden = true; }

  const elapsed = () => Math.max(0, Math.floor((Date.now() - game.startAt) / 1000));
  function tick() {
    if (!game) return;
    const e = elapsed();
    els.timer.textContent = fmt(e + PENALTY * game.hints);
    els.timer.classList.toggle('over', !!game.target && e + PENALTY * game.hints > game.target);
  }

  // The board is as large as the space allows: full width, unless the chip and slots below it need the height.
  function layout() {
    if (!game || $('play').hidden) return;
    const p = game.puzzle, stage = els.wrap.parentNode, gap = parseFloat(getComputedStyle(stage).rowGap) || 0;
    const free = stage.clientHeight - els.current.parentNode.offsetHeight - els.slots.offsetHeight - 2 * gap;
    const ideal = els.wrap.clientWidth * (p.rows * CELL + 2 * FRAME) / (p.cols * CELL + 2 * FRAME);
    els.wrap.style.height = Math.max(120, Math.floor(Math.min(ideal, free))) + 'px';
  }
  window.addEventListener('resize', layout);

  const cx = (i) => (i % game.puzzle.cols) * CELL + CELL / 2;
  const cy = (i) => Math.floor(i / game.puzzle.cols) * CELL + CELL / 2;
  const pts = (p) => p.map((i) => cx(i) + ',' + cy(i)).join(' ');
  const wc = (k) => 'var(--w' + k + ')';

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
  // A word is one thick rounded line through its tiles.
  function snake(p, color, cls) {
    if (p.length === 1) return '<circle class="pill-dot ' + cls + '" cx="' + cx(p[0]) + '" cy="' + cy(p[0]) + '" r="32" fill="' + color + '"/>';
    return '<polyline class="pill-path ' + cls + '" points="' + pts(p) + '" stroke="' + color + '"/>';
  }
  const CHECK = (x, y, color, cls) => '<g class="' + cls + '"><circle class="badge-bg" cx="' + x + '" cy="' + y + '" r="15" stroke="' + color + '"/>' +
    '<path class="badge-check" d="M' + (x - 7) + ' ' + y + ' l5 5 l9 -10"/></g>';
  const TICK = '<svg class="check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7"/></svg>';

  // Slots are paired shortest-with-longest so the rows come out about the same width and the block stays compact.
  function slotRows(words) {
    const rows = [], MAX = 14;
    let lo = 0, hi = words.length - 1;
    while (lo <= hi) {
      if (lo < hi && words[lo].len + words[hi].len <= MAX) rows.push([words[lo++], words[hi--]]);
      else rows.push([words[hi--]]);
    }
    return rows.sort((a, b) => a[0].len - b[0].len);
  }

  const ok = (w) => !!(w.placed && w.placed.correct);
  const slotFor = (len) => game.words.find((w) => w.len === len && !ok(w));
  const CROSS = '<svg class="x" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg>';

  function render() {
    const g = game, p = g.puzzle, owner = new Map();
    g.placed.forEach((e) => e.path.forEach((c) => owner.set(c, e)));
    const W = p.cols * CELL, H = p.rows * CELL;
    let svg = '<defs><pattern id="hatch" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect class="hatch-bg" width="14" height="14"/><rect class="hatch-line" width="5" height="14"/></pattern><clipPath id="boardClip"><rect x="0" y="0" width="' + W + '" height="' + H + '" rx="26"/></clipPath></defs>' +
      '<rect class="frame" x="' + -FRAME + '" y="' + -FRAME + '" width="' + (W + 2 * FRAME) + '" height="' + (H + 2 * FRAME) + '" rx="' + (26 + FRAME) + '"/><g clip-path="url(#boardClip)">';
    // 1. cell backgrounds: tiles of the same word merge; different regions are separated by a thin gap showing the frame.
    const key = (i) => (!p.letters[i] ? 'b' : owner.has(i) ? 'w' + owner.get(i).color : 'u');
    const inset = 2;
    p.letters.forEach((ch, i) => {
      const r = Math.floor(i / p.cols), c = i % p.cols, x = c * CELL, y = r * CELL, mine = key(i);
      const diff = (rr, cc) => rr >= 0 && rr < p.rows && cc >= 0 && cc < p.cols && key(rr * p.cols + cc) !== mine;
      const l = diff(r, c - 1) ? inset : 0, rt = diff(r, c + 1) ? inset : 0, t = diff(r - 1, c) ? inset : 0, bm = diff(r + 1, c) ? inset : 0;
      const w = owner.get(i);
      svg += '<rect class="' + (ch ? 'tile' : 'gap') + '"' + (ch ? ' data-i="' + i + '" fill="' + (w ? 'var(--t' + w.color + ')' : 'var(--cell)') + '"' : '') +
        ' x="' + (x + l) + '" y="' + (y + t) + '" width="' + (CELL - l - rt) + '" height="' + (CELL - t - bm) + '"/>';
    });
    svg += '</g>';
    if (g.hintCell >= 0) svg += '<rect class="hint-ring" x="' + (cx(g.hintCell) - 44) + '" y="' + (cy(g.hintCell) - 44) + '" width="88" height="88" rx="14"/>';
    // 2. word snakes, start rings, chevrons and badges (a wrong word keeps its snake but gets no tick)
    g.placed.forEach((e) => {
      svg += snake(e.path, wc(e.color), (e.fresh ? 'pop ' : '') + (e.correct ? '' : 'bad'));
      svg += '<circle class="ring" cx="' + cx(e.path[0]) + '" cy="' + cy(e.path[0]) + '" r="33" stroke="color-mix(in srgb, ' + wc(e.color) + ' 62%, #000)"/>';
    });
    g.placed.forEach((e) => { svg += chevrons(e.path); });
    const fit = g.path.length ? slotFor(g.path.length) : null;
    if (g.path.length) {
      const col = fit ? wc(fit.color) : 'var(--muted)';
      svg += '<g id="trace" class="trace">' + snake(g.path, col, '') + chevrons(g.path) + '</g>';
      if (g.enterTile >= 0) svg += '<circle class="ripple" cx="' + cx(g.enterTile) + '" cy="' + cy(g.enterTile) + '" r="40" stroke="' + col + '"/>';
    }
    g.placed.filter((e) => e.correct).forEach((e) => {
      // The badge sits on the corner of the first tile, away from where the word heads.
      const a = e.path[0], b = e.path[1];
      const dx = Math.sign(cx(b) - cx(a)), dy = Math.sign(cy(b) - cy(a));
      const bx = dx ? -dx * 30 : 30, by = dx ? -30 : -dy * 30;
      svg += CHECK(cx(a) + bx, cy(a) + by, wc(e.color), e.fresh ? 'enter' : '');
    });
    // 3. letters on top
    const fresh = new Set(); g.placed.forEach((e) => { if (e.fresh) e.path.forEach((c) => fresh.add(c)); });
    p.letters.forEach((ch, i) => {
      if (!ch) return;
      const on = owner.has(i) || g.path.includes(i), diag = Math.floor(i / p.cols) + (i % p.cols);
      const cls = (on ? ' on' : '') + (g.deal ? ' deal' : i === g.enterTile || fresh.has(i) ? ' bounce' : '');
      svg += '<text class="letter' + cls + '" style="--d:' + diag * (g.solved ? 45 : 28) + 'ms" x="' + cx(i) + '" y="' + (cy(i) + 2) + '">' + ch + '</text>';
    });
    els.board.innerHTML = svg;
    els.board.classList.toggle('win', g.solved);

    // Live word chip (takes the colour of the slot it would fill), plus clear and undo
    const word = g.path.map((i) => p.letters[i]).join('');
    const anyWrong = g.placed.some((e) => !e.correct);
    els.current.className = 'current' + (word ? ' active' : g.solved ? ' done' : '') + (fit ? ' fits' : '');
    els.current.style.setProperty('--chip', fit ? wc(fit.color) : 'var(--pill)');
    els.current.style.setProperty('--chip-text', fit ? 'var(--on-pill)' : 'var(--text)');
    els.current.textContent = word || (g.solved ? 'Solved!' : anyWrong ? 'Tap a wrong word to remove it' : 'Drag across tiles to spell a word');
    els.clear.disabled = !word || g.solved;
    els.undo.disabled = g.solved || (!g.path.length && !g.placed.length);

    // Progress: one segment per word
    const found = g.words.filter(ok);
    els.progBar.innerHTML = g.words.map((w) => '<i' + (ok(w) ? ' class="on" style="background:' + wc(w.color) + '"' : '') + '></i>').join('');
    els.progText.textContent = (NAMES[p.difficulty] || 'Custom') + ' · ' + found.length + '/' + g.words.length;

    // Word slots: a capsule per word with a cell per letter. A placed word fills it in the word's colour;
    // a wrong one is dimmed with a cross, and tapping it takes it back off the board.
    const rows = slotRows(g.words), avail = els.wrap.clientWidth || (innerWidth - 24);
    let cs = 26;
    rows.forEach((row) => {
      const letters = row.reduce((a, w) => a + w.len, 0);
      cs = Math.min(cs, (avail - 12 * (row.length - 1) - 40 * row.length - 3 * letters) / letters);
    });
    els.slots.style.setProperty('--cs', Math.max(13, Math.floor(cs)) + 'px');
    els.slots.innerHTML = rows.map((row) => '<div class="slot-row">' + row.map((w) => {
      const bad = !!w.placed && !w.placed.correct;
      return '<button type="button" class="slot' + (ok(w) ? ' found' : '') + (bad ? ' wrong' : '') + (w.placed && w.placed.fresh ? ' fresh' : '') + (w === fit ? ' target' : '') +
        '" data-len="' + w.len + '" style="--sc:' + wc(w.color) + '" aria-label="' + (ok(w) ? w.sol.word + ', found' : bad ? w.placed.word + ', not right, tap to remove' : w.len + ' letter word, empty') + '">' +
        '<span class="cells">' + w.sol.word.split('').map((ch, k) => '<span class="cell" style="--k:' + k + (w.placed ? ';background:' + wc(w.color) + '">' + w.placed.word[k] : '">') + '</span>').join('') + '</span>' +
        '<span class="mark">' + (ok(w) ? TICK : bad ? CROSS : '') + '</span></button>';
    }).join('') + '</div>').join('');

    // one-shot animation flags are consumed by this render
    g.enterTile = -1; g.deal = false;
    g.placed.forEach((e) => { e.fresh = false; });
  }

  let toastTimer;
  function toast(msg) {
    els.toast.textContent = msg; els.toast.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => els.toast.classList.remove('show'), 1700);
  }
  function shake() {
    const t = $('trace');
    if (t) { t.classList.remove('shake'); void t.getBoundingClientRect(); t.classList.add('shake'); }
  }

  // ---------- confetti ----------
  function confetti() {
    try {
      const cv = els.confetti, dpr = window.devicePixelRatio || 1;
      cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
      const ctx = cv.getContext('2d'); ctx.scale(dpr, dpr);
      const W = innerWidth, H = innerHeight;
      const ps = Array.from({ length: 150 }, () => ({
        x: W / 2 + (Math.random() - .5) * 80, y: H * 0.38, vx: (Math.random() - .5) * 13, vy: -Math.random() * 13 - 4,
        w: 6 + Math.random() * 6, h: 4 + Math.random() * 5, r: Math.random() * 6, vr: (Math.random() - .5) * .4, c: HEX[Math.floor(Math.random() * HEX.length)],
      }));
      const t0 = performance.now();
      (function frame(now) {
        const t = now - t0;
        ctx.clearRect(0, 0, W, H);
        ps.forEach((p) => {
          p.vy += 0.32; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.globalAlpha = Math.max(0, 1 - t / 2800);
          ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore();
        });
        if (t < 2800) requestAnimationFrame(frame); else ctx.clearRect(0, 0, W, H);
      })(t0);
    } catch (e) { /* decoration only */ }
  }

  function clearPath() { if (game && game.path.length) { game.path = []; game.hintCell = -1; render(); } }

  // The word goes into the slot with that many letters: an empty one first, else one holding a wrong word.
  // Right or wrong, it stays on the board. (Never auto-clear: the player keeps dragging, drags back, or clears.)
  function submit() {
    const g = game;
    if (!g || g.solved || !g.path.length) return;
    const word = g.path.map((i) => g.puzzle.letters[i]).join('');
    const slots = g.words.filter((w) => w.len === word.length);
    const slot = slots.find((w) => !w.placed) || slots.find((w) => !w.placed.correct);
    if (!slot) {
      // Nothing to place yet: keep the path selected so the player can keep dragging, drag back to
      // drop a letter, or clear it.
      const min = Math.min(...g.words.map((w) => w.len));
      if (word.length < min) toast('Keep going — words start at ' + min + ' letters');
      else { toast(slots.length ? 'You already found the ' + word.length + '-letter word' : 'No ' + word.length + '-letter word here — keep going or drag back'); shake(); sfx.wrong(); haptic('warning'); }
      return;
    }
    // Replace the slot's previous (wrong) word and any wrong words this path runs over.
    const mine = new Set(g.path);
    g.placed = g.placed.filter((e) => {
      const evict = e === slot.placed || e.path.some((c) => mine.has(c));
      if (evict) g.words.forEach((w) => { if (w.placed === e) w.placed = null; });
      return !evict;
    });
    // Correct means the right word on the right tiles (the generator guarantees no other route spells it).
    const tiles = (pth) => pth.slice().sort((a, b) => a - b).join(',');
    const entry = { word, path: g.path.slice(), color: slot.color, fresh: true, correct: word === slot.sol.word && tiles(g.path) === tiles(slot.sol.path) };
    slot.placed = entry; g.placed.push(entry);
    g.path = []; g.hintCell = -1;
    if (entry.correct) { sfx.right(); haptic('success'); toast('Correct!'); }
    else { sfx.wrong(); haptic('error'); toast('Not quite — tap it to remove'); }
    if (g.words.every(ok)) solved(); else render();
  }

  function detach(entry) {
    game.placed = game.placed.filter((e) => e !== entry);
    game.words.forEach((w) => { if (w.placed === entry) w.placed = null; });
  }
  function removeWord(entry) {
    detach(entry);
    game.path = [];
    sfx.back(); haptic('light');
    render();
  }
  function undo() {
    if (!game || game.solved) return;
    if (game.path.length) { clearPath(); haptic('light'); }
    else if (game.placed.length) removeWord(game.placed[game.placed.length - 1]);
  }

  function solved() {
    const g = game;
    g.solved = true; clearInterval(g.timerId);
    const time = elapsed() + PENALTY * g.hints;
    els.timer.textContent = fmt(time);
    render();   // the last word pops in and the letters do a wave
    sfx.win();
    if (!(g.kind === 'answer' && time > duel.P.t)) confetti();   // no party for a lost round
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
      if (g.kind === 'answer') { afterAnswer(); if (AUTO && loadRec(duel.id).out) autoSend(); }
      else if (g.kind === 'serve') { if (AUTO) autoSend(); else readyToSend(); }
      else card({ screen: 'home', title: 'Solved in ' + fmt(time), text: 'Play another?', pick: (d) => serve(d, 'solo'), alt: ['Home', home] });
    }, params.has('fast') ? 0 : 1500);
  }

  $('hintBtn').addEventListener('click', () => {
    if (!game || game.solved) return;
    const w = game.words.find((x) => !ok(x));
    game.hints++; game.hintCell = w.sol.path[0]; game.path = [];
    haptic('medium');
    tick(); render(); toast('Start here — a ' + w.len + '-letter word (+' + PENALTY + 's)');
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
  // from catching the wrong neighbour. The rules below are the web game's.
  const INNER = 0.38;
  // The SVG is centred in the wrap and scaled to fit; its viewBox is the grid plus the frame on every side.
  function toGrid(e) {
    const r = els.wrap.getBoundingClientRect(), p = game.puzzle, f = FRAME / CELL;
    const scale = Math.min(r.width / (p.cols + 2 * f), r.height / (p.rows + 2 * f));
    return { gx: (e.clientX - r.left - (r.width - p.cols * scale) / 2) / scale, gy: (e.clientY - r.top - (r.height - p.rows * scale) / 2) / scale };
  }
  function cellAt(gx, gy, strict) {
    const p = game.puzzle, c = Math.floor(gx), r = Math.floor(gy);
    if (c < 0 || c >= p.cols || r < 0 || r >= p.rows) return -1;
    if (strict && (Math.abs(gx - (c + 0.5)) > INNER || Math.abs(gy - (r + 0.5)) > INNER)) return -1;
    const i = r * p.cols + c;
    return p.letters[i] ? i : -1;
  }
  // Tiles of correct words are locked; tiles of wrong words can be traced over (that replaces the wrong word).
  const lockedSet = () => { const s = new Set(); game.placed.forEach((e) => { if (e.correct) e.path.forEach((c) => s.add(c)); }); return s; };
  const adjacent = (a, b) => Gen.neighbours(a, game.puzzle.rows, game.puzzle.cols).includes(b);
  function addTile(i) { game.path.push(i); game.enterTile = i; sfx.step(game.path.length); haptic('select'); }

  els.wrap.addEventListener('pointerdown', (e) => {
    if (!game || game.solved) return;
    const g = toGrid(e), i = cellAt(g.gx, g.gy, false);
    if (i < 0) { clearPath(); return; }
    if (lockedSet().has(i)) return;
    e.preventDefault();
    game.hintCell = -1; game.moved = false; game.tapWrong = null; game.pickup = null; game.lastPt = g; game.dragging = true;
    const path = game.path, last = path[path.length - 1];
    if (path.length && i === last) game.dragging = 'maybeSubmit';          // tapping the last tile again places the word
    else if (path.includes(i)) { game.path = path.slice(0, path.indexOf(i) + 1); haptic('select'); }
    else if (path.length && adjacent(last, i)) addTile(i);
    else {
      game.path = []; addTile(i);
      const wp = game.placed.find((x) => !x.correct && x.path.includes(i)) || null;
      game.tapWrong = wp;                                                    // a plain tap on a wrong word removes it
      if (wp && wp.path[wp.path.length - 1] === i) game.pickup = wp;         // ...but dragging out from its last tile picks it back up
    }
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
        if (i < 0 || locked.has(i)) continue;
        let last = game.path[game.path.length - 1];
        if (i === last) continue;
        if (game.pickup && game.path.length === 1) {
          // Dragging out from the last tile of a wrong word picks that word back up, so you can extend it
          // (drag onward) or shorten it (drag back over its previous tile).
          const pp = game.pickup.path, back = pp[pp.length - 2];
          if (i === back || (adjacent(last, i) && !pp.includes(i))) {
            game.path = pp.slice(); detach(game.pickup); game.pickup = null; game.tapWrong = null; last = game.path[game.path.length - 1];
          } else continue;
        }
        const path = game.path;
        if (path.length > 1 && i === path[path.length - 2]) { path.pop(); game.moved = true; sfx.back(); haptic('select'); render(); }
        else if (!path.includes(i) && adjacent(last, i)) { addTile(i); game.moved = true; render(); }
      }
      game.lastPt = g;
    }
  });
  const release = () => {
    if (!game || !game.dragging) return;
    const wasSubmitTap = game.dragging === 'maybeSubmit' && !game.moved;
    const moved = game.moved;
    game.dragging = false;
    if (moved || wasSubmitTap) submit();
    else if (game.tapWrong) { const w = game.tapWrong; game.tapWrong = null; removeWord(w); }
    else if (game.path.length === 1) render();   // single tap: keep the tile selected for tap mode
  };
  els.wrap.addEventListener('pointerup', release);
  els.wrap.addEventListener('pointercancel', () => { if (game) game.dragging = false; });
  els.clear.addEventListener('click', () => { clearPath(); });
  els.undo.addEventListener('click', undo);
  // A wrong word in a slot can be tapped away.
  els.slots.addEventListener('click', (e) => {
    const b = e.target.closest('.slot.wrong');
    if (!b || !game || game.solved) return;
    const w = game.words.find((x) => x.len === Number(b.dataset.len));
    if (w && w.placed && !w.placed.correct) removeWord(w.placed);
  });
  // Tapping anywhere outside the board also clears a half-built word.
  // (Capture phase: it must run before the board re-renders, which detaches the tapped tile.)
  document.addEventListener('pointerdown', (e) => { if (game && !game.solved && game.path.length && !e.target.closest('.board-wrap, button, dialog')) clearPath(); }, true);
  document.addEventListener('contextmenu', (e) => e.preventDefault());

  // Test hook (coil/tools/test-duel.js)
  window.__coil = { get game() { return game; }, get screen() { return S.screen; }, get duel() { return duel; }, unpack };

  setStyle(params.get('style') || 'expanded');
  Host.post({ type: 'ready' });
  if (!native) Host.receive({ type: 'open', style: S.style, match: params.get('m'), fromMe: params.has('mine') });
})();
