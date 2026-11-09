// The loading screen must never hang: version skew (page and script out of step) and a crashing script
// both have to end in a working game or a visible error with a Reload button.
//   python3 -m http.server 8123 &   NODE_PATH=$(npm root -g) node tools/test-resilience.js [baseUrl]
const { chromium } = require('playwright');
const base = process.argv[2] || 'http://localhost:8123/index.html?fast';
let bad = 0;
const check = (name, ok, extra) => { console.log((ok ? 'ok   ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); if (!ok) bad++; };

(async () => {
  const browser = await chromium.launch();

  // 1. page missing elements the script expects (what a stale cached script looks like to a newer page)
  // (rewrites the page from the Node side, so it only runs against a local server)
  if (/^https?:\/\/localhost/.test(base)) {
    const page = await (await browser.newContext()).newPage();
    await page.route(/\/(index\.html)?(\?.*)?$/, async (route) => {
      if (route.request().resourceType() !== 'document') return route.continue();
      const res = await route.fetch(); let body = await res.text();
      for (const id of ['helpBtn', 'undoBtn', 'hintBtn', 'clearChip', 'progBar', 'copyBtn', 'nextBtn']) body = body.replace(`id="${id}"`, `id="gone-${id}"`);
      route.fulfill({ response: res, body });
    });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base);
    await page.waitForSelector('#loader', { state: 'hidden', timeout: 8000 }).catch(() => {});
    const ready = await page.evaluate(() => !!(window.__wend && window.__wend.puzzle));
    check('game still starts when the page is missing buttons', ready && errors.length === 0, errors[0] || '');
  }

  // 2. a script that crashes at startup -> visible error + Reload button, not a frozen loader
  {
    const page = await (await browser.newContext()).newPage();
    await page.route(/src\/game\.js/, (route) => route.fulfill({ contentType: 'application/javascript', body: "throw new Error('boom at startup');" }));
    await page.goto(base);
    await page.waitForSelector('#loadError:not([hidden])', { timeout: 5000 }).catch(() => {});
    const shown = await page.locator('#loadError').isVisible();
    const note = await page.locator('#loadErrorNote').textContent();
    check('a crashing script shows an error with a Reload button', shown && /boom/.test(note) && await page.locator('#loadError button').isVisible(), JSON.stringify(note));
  }

  // 3. a script that never starts anything -> the watchdog shows the error after 12s
  {
    const page = await (await browser.newContext()).newPage();
    await page.route(/src\/game\.js/, (route) => route.fulfill({ contentType: 'application/javascript', body: '/* does nothing */' }));
    await page.goto(base);
    await page.waitForSelector('#loadError:not([hidden])', { timeout: 15000 }).catch(() => {});
    check('a script that never starts is caught by the watchdog', await page.locator('#loadError').isVisible());
  }

  // 4. the background worker is unavailable and the app reopens in a saved practice mode (Hard): must still load fast
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.addInitScript(() => { try { localStorage.setItem('wend.mode', '"hard"'); } catch (e) { /* ignore */ } });
    await page.route(/gen-worker\.js/, (route) => route.fulfill({ status: 404, body: 'nope' }));
    const t0 = Date.now();
    await page.goto(base);
    await page.waitForSelector('#loader', { state: 'hidden', timeout: 9000 }).catch(() => {});
    const ok = await page.evaluate(() => !!(window.__wend && window.__wend.puzzle && window.__wend.puzzle.difficulty === 'hard'));
    check('saved Hard mode loads even though the worker is unavailable', ok, (Date.now() - t0) + 'ms');
  }

  // 5. a bad pool entry makes startup throw -> visible error, not an endless loader
  {
    const page = await (await browser.newContext()).newPage();
    await page.route(/data\/puzzles\.js/, (route) => route.fulfill({ contentType: 'application/javascript', body: 'window.WEND_POOL={easy:[{s:null}],medium:[{s:null}],hard:[{s:null}],expert:[{s:null}]};' }));
    await page.goto(base);
    await page.waitForSelector('#loadError:not([hidden])', { timeout: 6000 }).catch(() => {});
    check('a startup exception shows the error panel', await page.locator('#loadError').isVisible());
  }

  // 6. the game crashes AFTER choosing a puzzle (the case that used to leave the loader looping silently)
  if (/^https?:\/\/localhost/.test(base)) {
    const page = await (await browser.newContext()).newPage();
    await page.route(/src\/game\.js/, async (route) => {
      const res = await route.fetch(); let body = await res.text();
      body = body.replace("render();\n      hideLoader(", "throw new Error('render boom');\n      hideLoader(");
      route.fulfill({ response: res, body });
    });
    await page.goto(base);
    await page.waitForSelector('#loadError:not([hidden])', { timeout: 6000 }).catch(() => {});
    const shown = await page.locator('#loadError').isVisible();
    await page.waitForTimeout(9000); // the 8s cutoff must not remove the error panel
    check('a crash after the puzzle is chosen still shows the error panel (and keeps it)', shown && await page.locator('#loadError').isVisible());
  }

  await browser.close();
  process.exit(bad ? 1 : 0);
})();
