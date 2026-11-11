// Plays a whole duel between two simulated phones, handing each "send" to the other side the way Messages does.
//   NODE_PATH=$(npm root -g) node coil/tools/test-duel.js
const { chromium } = require('playwright');
const server = require('./serve.js');
let bad = 0;
const check = (name, ok, extra) => { console.log((ok ? 'ok   ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); if (!ok) bad++; };

async function solve(page, waitMs) {
  await page.waitForFunction(() => window.__coil.screen === 'play');
  if (waitMs) await page.waitForTimeout(waitMs);
  const sol = await page.evaluate(() => window.__coil.game.puzzle.solution);
  for (const { path } of sol) {
    const c = (i) => page.locator(`.tile[data-i="${i}"]`).boundingBox();
    const b0 = await c(path[0]); await page.mouse.move(b0.x + b0.width / 2, b0.y + b0.height / 2); await page.mouse.down();
    for (const i of path.slice(1)) { const b = await c(i); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 3 }); }
    await page.mouse.up();
  }
  await page.waitForFunction(() => window.__coil.screen !== 'play');
}
const lastSend = (page) => page.evaluate(() => window.Host.sent.filter((m) => m.type === 'send').pop());
const deliver = (page, match, fromMe) => page.evaluate(([m, f]) => window.Host.receive({ type: 'open', style: 'expanded', match: m, fromMe: f }), [match, fromMe]);
const text = (page, id) => page.locator('#' + id).textContent();

(async () => {
  const browser = await chromium.launch();
  const base = 'http://localhost:' + server.address().port + '/index.html?fast&env=messages';
  const phone = async () => { const p = await (await browser.newContext({ viewport: { width: 390, height: 640 }, hasTouch: false })).newPage(); p.on('pageerror', (e) => check('no page error', false, e.message)); await p.goto(base); return p; };
  const A = await phone(), B = await phone();

  check('opens on the home card', (await text(A, 'cardTitle')) === 'Start a duel');
  await A.click('#picker [data-d="easy"]');
  await solve(A, 2100); // A takes a couple of seconds, so B (instant) wins the round
  check('A is offered Send', (await A.evaluate(() => window.__coil.screen)) === 'send');
  await A.click('#cardMain');
  let m = await lastSend(A);
  check('A sends round 1', /^Round 1: beat 0:0\d$/.test(m.caption) && m.newSession === true && m.image.startsWith('data:image/jpeg'), m.caption + ' | ' + m.subcaption);
  check('A now waits', (await A.evaluate(() => window.__coil.screen)) === 'waiting');
  check('the message hides the letters but fits in a URL', m.match.length < 3000, m.match.length + ' chars');

  // A taps its own bubble: still waiting, cannot play its own board
  await deliver(A, m.match, true);
  check('own bubble shows waiting', (await A.evaluate(() => window.__coil.screen)) === 'waiting');

  let turn = 0, from = A, to = B, rounds = 0;
  for (;;) {
    await deliver(to, m.match, false);
    if ((await to.evaluate(() => window.__coil.screen)) === 'over') break;
    rounds++;
    check('round ' + rounds + ' intro', (await text(to, 'cardTitle')) === 'Round ' + rounds);
    await to.click('#cardMain');
    if (rounds === 1) {
      // leaving and coming back must not reset the clock or let the round be replayed
      await to.click('#quitBtn');
      check('leaving keeps the clock running', (await text(to, 'cardMain')) === 'Continue');
      await to.click('#cardMain');
    }
    // the answering player is always faster here, except in round 2 where they dawdle and lose
    await solve(to, rounds === 2 ? 4200 : 0);
    const title = await text(to, 'cardTitle');
    check('round ' + rounds + ' scored', rounds === 2 ? /^They took round 2/.test(title) : /^You (took round|win the duel)/.test(title), title);
    if (rounds === 1) {
      await deliver(to, m.match, false); // re-opening the played message must not offer the board again
      check('a played round cannot be replayed', (await to.evaluate(() => window.__coil.screen)) === 'after');
    }
    if (await to.locator('#picker').isVisible()) {
      await to.click('#picker [data-d="' + ['medium', 'hard', 'expert', 'easy'][turn++ % 4] + '"]');
      await solve(to, 2100);
      await to.click('#cardMain');
    } else {
      await to.click('#cardMain'); // send the final result
    }
    m = await lastSend(to);
    check('turn sent', !!m && m.newSession === false, m.caption + ' | ' + m.subcaption);
    [from, to] = [to, from];
    if (rounds > 12) { check('duel ends', false); break; }
  }
  const score = await to.evaluate(() => window.__coil.duel.P.s);
  check('duel ends at first to 3', Math.max(...score) === 3, score.join('-') + ' after ' + rounds + ' rounds');
  check('both sides agree on the winner', (await text(to, 'cardTitle')) !== (await text(from, 'cardTitle')), (await text(from, 'cardTitle')) + ' / ' + (await text(to, 'cardTitle')));
  await to.click('#cardMain');
  check('rematch offers a board', await to.locator('#picker').isVisible());

  // damaged message
  await deliver(B, m.match.slice(0, -6) + 'AAAAAA', false);
  check('damaged message falls back to home', /could not be read/.test(await text(B, 'cardText')));

  // compact drawer: everything on the home card is reachable without scrolling, and the board fits when expanded
  for (const [w, h] of [[390, 260], [320, 230]]) {
    const p = await (await browser.newContext({ viewport: { width: w, height: h } })).newPage();
    await p.goto(base + '&style=compact');
    const box = await p.locator('#picker').boundingBox();
    check('compact home fits ' + w + 'x' + h, box && box.y + box.height <= h, box && Math.round(box.y + box.height) + ' <= ' + h);
  }
  for (const [w, h] of [[375, 540], [390, 640], [430, 800]]) {
    const p = await (await browser.newContext({ viewport: { width: w, height: h } })).newPage();
    await p.goto(base);
    await p.click('#picker [data-d="expert"]');
    await p.waitForFunction(() => window.__coil.screen === 'play');
    const fits = await p.evaluate(() => { const s = document.getElementById('slots').getBoundingClientRect(), t = document.querySelector('.tile').getBoundingClientRect(); return [s.bottom <= innerHeight, Math.round(t.width)]; });
    check('expert board fits ' + w + 'x' + h, fits[0] && fits[1] >= 26, 'tile ' + fits[1] + 'px');
    if (w === 390) await p.screenshot({ path: process.env.SHOT_DIR ? process.env.SHOT_DIR + '/play.png' : '/dev/null' }).catch(() => {});
  }
  await browser.close(); server.close();
  console.log(bad ? bad + ' FAILED' : 'all good');
  process.exit(bad ? 1 : 0);
})();
