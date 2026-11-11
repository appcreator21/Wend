// Renders the app icon and the iMessage icon set. Run after changing the artwork below:
//   NODE_PATH=$(npm root -g) node coil/tools/make-icons.js && python3 coil/tools/resize-icons.py
const { chromium } = require('playwright');
const path = require('path');
const art = (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${(1024 - w) / 2} ${(1024 - h) / 2} ${w} ${h}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#232a66"/><stop offset="1" stop-color="#0f1226"/></linearGradient></defs>
  <rect x="-200" y="-200" width="1424" height="1424" fill="url(#g)"/>
  <path d="M292 292h440v440H402V402h220v220H512" fill="none" stroke="#ffd166" stroke-width="84" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="292" cy="292" r="62" fill="#ff6b6b"/><circle cx="512" cy="622" r="62" fill="#4ecdc4"/>
</svg>`;
(async () => {
  const browser = await chromium.launch();
  for (const [name, w, h] of [['icon-1024.png', 1024, 1024], ['icon-1024x768.png', 1024, 768]]) {
    const page = await (await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 })).newPage();
    await page.setContent('<body style="margin:0">' + art(w, h));
    await page.screenshot({ path: path.join(__dirname, name) });
  }
  await browser.close();
})();
