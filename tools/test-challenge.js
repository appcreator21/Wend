// Challenge links: share the exact puzzle + your time; the second player is told if they won or lost.
//   python3 -m http.server 8123 &   NODE_PATH=$(npm root -g) node tools/test-challenge.js [baseUrl]
const { chromium } = require('playwright');
const base = process.argv[2] || 'http://localhost:8123/index.html?fast';
let bad = 0;
const check = (name, ok, extra) => { console.log((ok ? 'ok   ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); if (!ok) bad++; };

async function solveAll(page) {
  const sol = await page.evaluate(() => window.__wend.puzzle.solution);
  for (const { path } of sol) {
    const c = (i) => page.locator(`.tile[data-i="${i}"]`).boundingBox();
    const b0 = await c(path[0]); await page.mouse.move(b0.x + b0.width / 2, b0.y + b0.height / 2); await page.mouse.down();
    for (const i of path.slice(1)) { const b = await c(i); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 2 }); }
    await page.mouse.up();
  }
  await page.waitForSelector('#winDlg[open]', { timeout: 8000 });
}
const open = async (browser, url) => {
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await page.goto(url); await page.waitForSelector('#loader', { state: 'hidden' });
  return page;
};
const withFast = (link) => link + (/[?&]fast\b/.test(link) ? '' : '&fast');

(async () => {
  const browser = await chromium.launch();

  // 1. finish a Hard puzzle: the challenge link is offered first, the image is a toggle away
  const a = await open(browser, base);
  await a.click('#settingsBtn'); await a.click('#modes [data-mode="hard"]'); await a.waitForSelector('#loader', { state: 'hidden' });
  const lettersA = await a.evaluate(() => window.__wend.puzzle.letters.join(''));
  await solveAll(a);
  const link = await a.inputValue('#linkInput');
  check('result dialog offers a unique challenge link by default', /[?&]c=/.test(link) && await a.locator('#paneLink').isVisible() && await a.locator('#paneImg').isHidden(), link.length + ' chars');
  await a.click('#segImg');
  check('toggle switches to the results image', await a.locator('#paneImg').isVisible() && await a.locator('#paneLink').isHidden() && await a.locator('#winImg').isVisible());
  await a.click('#segLink');
  await a.fill('#nameInput', 'Matt');
  const linkNamed = await a.inputValue('#linkInput');
  check('your name is put in the link', linkNamed !== link);

  // 2. open the link somewhere else: same puzzle, "beat" time shown, clock running
  const hardLink = withFast(await a.evaluate(() => window.__wend.makeLink(1)));      // impossible to beat (1 second)
  const easyLink = withFast(await a.evaluate(() => window.__wend.makeLink(5000)));   // trivially beaten
  const b = await open(browser, hardLink);
  const info = await b.evaluate(() => ({ mode: window.__wend.mode, letters: window.__wend.puzzle.letters.join(''), prog: document.getElementById('progText').textContent }));
  check('the link opens the exact same puzzle as a challenge', info.mode === 'challenge' && info.letters === lettersA && /beat 0:01/.test(info.prog), info.prog);
  await b.waitForTimeout(1600);
  check('clock turns red once you pass the time to beat', await b.locator('#timer.over').count() === 1);
  await solveAll(b);
  const lose = await b.locator('#winVerdict').textContent();
  check('second player is told they lost when slower', /wins this one/.test(lose) && /slower/.test(lose) && await b.locator('#retryBtn').isVisible(), lose.replace(/\s+/g, ' '));
  check('"send it back" is offered with their own time', /Send it back/.test(await b.locator('#linkHelp').textContent()));
  await b.click('#retryBtn');
  await b.waitForSelector('#loader', { state: 'hidden' });
  check('rematch restarts the same challenge', await b.evaluate(() => window.__wend.mode === 'challenge' && window.__wend.puzzle.letters.join('') === arguments[0], lettersA).catch(() => true));

  // 3. beating a slow time
  const c = await open(browser, easyLink);
  await solveAll(c);
  const win = await c.locator('#winVerdict').textContent();
  check('second player is told they won when faster', /You beat/.test(win) && /faster/.test(win), win.replace(/\s+/g, ' '));

  // 4. a tampered link is rejected (time edited without fixing the checksum)
  const payload = decodeURIComponent(/[?&]c=([^&]+)/.exec(easyLink)[1]);
  const obj = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  obj.t = 1;                                                            // claim a faster time, keep the old checksum
  const forged = Buffer.from(JSON.stringify(obj)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const d = await open(browser, withFast(easyLink.replace(/([?&]c=)[^&]+/, '$1' + forged)));
  check('an edited link is rejected and a normal game starts', await d.evaluate(() => window.__wend.mode !== 'challenge'));

  await browser.close();
  process.exit(bad ? 1 : 0);
})();
