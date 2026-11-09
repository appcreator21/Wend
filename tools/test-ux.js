// UX checks: natural dragging + everything fits one screen.
//   python3 -m http.server 8123 &   NODE_PATH=$(npm root -g) node tools/test-ux.js [baseUrl]
const { chromium } = require('playwright');
const base = process.argv[2] || 'http://localhost:8123/index.html?fast';
let bad = 0;
const check = (name, ok, extra) => { console.log((ok ? 'ok   ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); if (!ok) bad++; };

(async () => {
  const browser = await chromium.launch();

  // ---- fits on one screen, no scrolling, at several phone sizes, in every mode ----
  for (const [w, h] of [[390, 844], [375, 667], [430, 932], [360, 640]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    for (const mode of ['easy', 'medium', 'hard', 'expert']) {
      await page.goto(base);
      await page.waitForSelector('#loader', { state: 'hidden' });
      await page.click('#settingsBtn'); await page.click(`#modes [data-mode="${mode}"]`);
      await page.waitForSelector('#loader', { state: 'hidden' });
      const m = await page.evaluate(() => {
        const r = (s) => document.querySelector(s).getBoundingClientRect();
        return { scroll: document.documentElement.scrollHeight, inner: innerHeight, actions: r('.actions').bottom, board: r('#frame').width, boardRight: r('#frame').right, w: innerWidth };
      });
      check(`fits ${w}x${h} ${mode}`, m.scroll <= m.inner + 1 && m.actions <= m.inner + 1 && m.boardRight <= m.w, `(board ${Math.round(m.board)}px, bottom ${Math.round(m.actions)}/${m.inner})`);
    }
    await ctx.close();
  }

  // ---- natural dragging ----
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto(base); await page.waitForSelector('#loader', { state: 'hidden' });
  await page.click('#settingsBtn'); await page.click('#modes [data-mode="hard"]'); await page.waitForSelector('#loader', { state: 'hidden' });
  const sol = await page.evaluate(() => window.__wend.puzzle.solution);
  const box = (i) => page.locator(`.tile[data-i="${i}"]`).boundingBox();
  const center = async (i) => { const b = await box(i); return [b.x + b.width / 2, b.y + b.height / 2]; };
  const press = async (i) => { const [x, y] = await center(i); await page.mouse.move(x, y); await page.mouse.down(); };
  const glide = async (cells) => { for (const i of cells) { const [x, y] = await center(i); await page.mouse.move(x, y, { steps: 4 }); } };
  const chip = () => page.locator('#current').textContent();
  const filled = () => page.locator('.slot.filled').count();
  const checks = () => page.locator('.slot .check').count();

  const word = sol.find((s) => s.path.length >= 6);
  const L = word.path.length;

  // 1. a path that fits no slot is NOT cleared on release, and you can continue dragging from it
  await press(word.path[0]); await glide(word.path.slice(1, 3)); await page.mouse.up();   // 3 letters: too short
  check('short path stays selected after release', (await chip()).length === 3 && (await filled()) === 0, `chip="${await chip()}"`);
  await press(word.path[2]); await glide(word.path.slice(3)); await page.mouse.up();      // resume from the last tile
  check('can resume dragging after release and place the full word', (await checks()) === 1 && (await filled()) === 1);

  // 2. dragging backwards removes the last letter
  await page.click('#undoBtn'); // remove the placed word to start clean
  const other = sol.find((s) => s !== word && s.path.length >= 5);
  await press(other.path[0]); await glide(other.path.slice(1, 4));
  const before = (await chip()).length;
  await glide([other.path[2]]);
  const after = (await chip()).length;
  check('dragging back over the previous tile drops a letter', before === 4 && after === 3, `${before} -> ${after}`);
  await page.mouse.up();
  await page.click('#clearChip');
  check('clear chip empties the selection', (await page.locator('#clearChip').isHidden()));

  // 3. releasing early places a (wrong) word; dragging out from its last tile picks it back up and extends it
  await press(other.path[0]); await glide(other.path.slice(1, 4)); await page.mouse.up();   // 4 letters -> goes into the 4-letter slot
  const placedWrong = (await filled()) >= 1;
  await press(other.path[3]); await glide(other.path.slice(4)); await page.mouse.up();       // extend from its last tile
  const okExtend = (await page.locator('.slot.filled .check').count()) >= 1;
  check('early release places a word, and dragging from its last tile extends it', placedWrong && okExtend);

  // 4. tapping a wrong word removes it
  const wrongPath = sol[0].path.slice().reverse();
  await press(wrongPath[0]); await glide(wrongPath.slice(1)); await page.mouse.up();
  const nBefore = await filled();
  const [tx, ty] = await center(wrongPath[Math.floor(wrongPath.length / 2)]);
  await page.mouse.move(tx, ty); await page.mouse.down(); await page.mouse.up();
  check('tapping a wrong word removes it', (await filled()) === nBefore - 1);

  // 5. solve, results button + share image
  await page.click('#undoBtn').catch(() => {});
  for (const s of sol) { await press(s.path[0]); await glide(s.path.slice(1)); await page.mouse.up(); }
  await page.waitForSelector('#winDlg[open]', { timeout: 6000 }).catch(() => {});
  const win = await page.evaluate(() => ({ solved: window.__wend.solved, open: document.getElementById('winDlg').open, img: document.getElementById('winImg').src.slice(0, 5), w: document.getElementById('winImg').naturalWidth }));
  check('solved opens the result dialog with a puzzle image', win.solved && win.open && win.img === 'blob:' && win.w === 1080, JSON.stringify(win));
  await page.screenshot({ path: process.argv[3] ? process.argv[3] + '/win.png' : '/tmp/win.png' });
  await page.click('#winDlg form button');
  check('See results button appears in the action row once solved', await page.locator('#resultsBtn').isVisible() && await page.locator('#undoBtn').isHidden());

  await browser.close();
  process.exit(bad ? 1 : 0);
})();
