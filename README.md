# Wend

A fan-made daily word-path puzzle, inspired by LinkedIn's Wend (not affiliated with LinkedIn).

**Rules:** trace words through the letter grid using up/down/left/right moves. The slots under the grid give
the length of each word. Every open tile must be used exactly once — no overlaps, no leftovers.

## Run

No build step. Serve the folder and open `index.html`:

    python3 -m http.server 8000

- **Daily** – same puzzle for everyone each day (seeded by date; difficulty rises on Fri/Sun).
- **Easy / Medium / Hard** – endless practice puzzles (4x4, 4x5, 5x5 with blocked tiles).
- Drag to trace, or tap tiles and tap the last one again (or press Enter) to submit. Tap a placed word or press Undo to remove it. Puzzle choice lives behind the gear icon.
- Any real word from the dictionary is accepted, not just the generator's words.

## Layout

- `src/generator.js` – seeded puzzle generator (random path partition of the grid + common words)
- `src/game.js`, `src/style.css`, `index.html` – the game UI
- `data/words.js` – answer list + dictionary, built by `tools/build-words.js`
- `tools/test-generator.js` – generator validity test (`node tools/test-generator.js`)
- `tools/e2e.js` – Playwright test that solves each mode through the real UI
