// End-to-end check: drag every solution path in each mode and expect a win.
//   python3 -m http.server 8123 &   node tools/e2e.js [screenshotDir]
const { chromium } = require('playwright');
const shotDir = process.argv[2];
(async () => {
  const browser = await chromium.launch();
  let bad = 0;
  for (const mode of ['daily', 'easy', 'medium', 'hard', 'expert']) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: false });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('http://localhost:8123/index.html?fast');
    await page.waitForSelector('#loader', { state: 'hidden' });
    await page.click('#settingsBtn');
    await page.click(`#modes [data-mode="${mode}"]`);
    await page.waitForSelector('#loader', { state: 'hidden' });
    const sol = await page.evaluate(() => window.__wend.puzzle.solution);
    const center = async (i) => (await page.locator(`.tile[data-i="${i}"]`).boundingBox());
    // A wrong word still fills the slot of its length, but without a green check; the real word then replaces it.
    {
      const wrong = sol[0].path.slice().reverse();
      const b0 = await center(wrong[0]);
      await page.mouse.move(b0.x + b0.width / 2, b0.y + b0.height / 2);
      await page.mouse.down();
      for (const i of wrong.slice(1)) { const b = await center(i); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 3 }); }
      await page.mouse.up();
      const filled = await page.locator('.slot.filled').count(), checks = await page.locator('.slot .check').count();
      if (filled !== 1 || checks !== 0) { console.log(mode, 'WRONG-WORD CHECK FAILED', filled, checks); bad++; }
    }
    for (const { path } of sol) {
      const b0 = await center(path[0]);
      await page.mouse.move(b0.x + b0.width / 2, b0.y + b0.height / 2);
      await page.mouse.down();
      for (const i of path.slice(1)) {
        const b = await center(i);
        await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 3 });
      }
      await page.mouse.up();
    }
    if (shotDir && mode === 'hard') await page.screenshot({ path: `${shotDir}/hard-solved-board.png` });
    await page.waitForSelector('#winDlg[open]', { timeout: 3000 }).catch(() => {});
    const solved = await page.evaluate(() => window.__wend.solved);
    console.log(mode, solved ? 'solved' : 'NOT SOLVED', errors.length ? errors : '');
    if (!solved || errors.length) bad++;
    if (shotDir) await page.screenshot({ path: `${shotDir}/${mode}-win.png` });
    await ctx.close();
  }
  // Unsolved mid-game screenshot with a partial trace and a placed word
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto('http://localhost:8123/index.html?fast');
    await page.waitForSelector('#loader', { state: 'hidden' });
  await page.click('#settingsBtn');
  await page.click('#modes [data-mode="hard"]');
  await page.waitForSelector('#loader', { state: 'hidden' });
  const sol = await page.evaluate(() => window.__wend.puzzle.solution);
  const drag = async (path) => {
    const c = async (i) => page.locator(`.tile[data-i="${i}"]`).boundingBox();
    const b0 = await c(path[0]);
    await page.mouse.move(b0.x + b0.width / 2, b0.y + b0.height / 2); await page.mouse.down();
    for (const i of path.slice(1)) { const b = await c(i); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 2 }); }
    await page.mouse.up();
  };
  await drag(sol[0].path);
  // tap-mode: tap tiles of another word then tap the last one to submit
  for (const i of sol[1].path) await page.locator(`.tile[data-i="${i}"]`).click();
  await page.locator(`.tile[data-i="${sol[1].path.at(-1)}"]`).click();
  const placedCount = await page.locator('.slot.filled').count();
  console.log('tap-mode placed words:', placedCount, placedCount === 2 ? 'ok' : 'FAIL');
  if (placedCount !== 2) bad++;
  await page.click('#hintBtn');
  if (shotDir) await page.screenshot({ path: `${shotDir}/hard-midgame.png` });
  await browser.close();
  process.exit(bad ? 1 : 0);
})();
