# Wend

A fan-made daily word-path puzzle, inspired by LinkedIn's Wend (not affiliated with LinkedIn).

**Rules:** trace words through the letter grid using up/down/left/right moves. The slots under the grid give
the length of each word. Every open tile must be used exactly once — no overlaps, no leftovers.

## Run

No build step. Serve the folder and open `index.html`:

    python3 -m http.server 8000

- **Daily** – same puzzle for everyone each day (seeded by date; hard on Fri/Sun).
- **Easy / Medium / Hard / Expert** – unlimited practice puzzles, a fresh one every time (generated in a background worker, with the next one prepared while you play).
  Word lengths always climb by one starting at 4: Easy = 4 words (4-7 letters, 5x5), Medium = 5 (4-8, 6x6), Hard = 6 (4-9, 7x7), Expert = 7 (4-10, 8x8). Unused cells are blocked.
- The app reopens in whichever mode you used last.
- Add it to your home screen for a full-screen app (dark theme, content sits below the status bar).
- Drag to trace, or tap tiles and tap the last one again (or press Enter) to submit. Tap a placed word or press Undo to remove it. Puzzle choice lives behind the gear icon.
- Each board has one fixed set of answer words. Whatever you trace fills the slot with that many letters
  (a wrong word replaces the previous wrong one); only the correct word gets a green check, locks in and counts.
  The puzzle is solved when every slot is correct.
- Every board is checked to have exactly one way to split into common words, with plenty of decoy words (Easy 12+, Medium 20+, Hard 30+, Expert 40+),
  no straight runs longer than 3 tiles and no plural answers, so you can't just read words off the grid.

## Layout

- `src/generator.js` – seeded puzzle generator (random path partition of the grid + common words)
- `src/game.js`, `src/style.css`, `index.html` – the game UI (loading screen, drag input, sound/vibration, confetti)
- `src/gen-worker.js` – background puzzle generator
- `manifest.webmanifest`, `icons/` – installable web-app setup (Add to Home Screen); the Apple touch icon is also served at `/apple-touch-icon.png`
- `data/puzzles.js` – pregenerated, verified puzzles for the shared daily (365 easy/medium/hard, 200 expert); rebuild with `tools/build-puzzles.js` + `tools/pack-puzzles.js`, check with `node tools/test-pool.js`
- `data/words.js` – pool of puzzle answers, built by `tools/build-words.js`
- `tools/test-generator.js` – generator validity test (`node tools/test-generator.js`)
- `tools/e2e.js` – Playwright test that solves each mode through the real UI

## Deploy (Cloudflare Pages)

No framework: the site is static. `tools/build-site.sh` copies `index.html`, `src/` and `data/` into `dist/`.

- **Git integration:** Workers & Pages -> Create -> Pages -> connect this repo. Build command `sh tools/build-site.sh`, output directory `dist`.
- **CLI:** `sh tools/build-site.sh && npx wrangler pages deploy dist --project-name wend` (needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`).
- **API only (no asset upload token):** `node tools/make-worker.js`, then POST `worker/_worker.js` as the `_worker.js` part (with `manifest={}`) to
  `/accounts/<id>/pages/projects/wend/deployments`. The worker serves every file from memory (~90KB), which is how the current site is deployed.
