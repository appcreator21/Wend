# Wend

A fan-made daily word-path puzzle, inspired by LinkedIn's Wend (not affiliated with LinkedIn).

**Rules:** trace words through the letter grid using up/down/left/right moves. The slots under the grid give
the length of each word. Every open tile must be used exactly once — no overlaps, no leftovers.

## Run

No build step. Serve the folder and open `index.html`:

    python3 -m http.server 8000

- **Daily** – same puzzle for everyone each day (seeded by date; hard on Fri/Sun).
- **Easy / Medium / Hard** – endless practice puzzles. Word lengths always climb by one starting at 4:
  Easy = 4 words (4-7 letters, 5x5 grid), Medium = 5 words (4-8, 6x6), Hard = 6 words (4-9, 7x7). Unused cells are blocked.
- Drag to trace, or tap tiles and tap the last one again (or press Enter) to submit. Tap a placed word or press Undo to remove it. Puzzle choice lives behind the gear icon.
- Each board has one fixed set of answer words. Whatever you trace fills the slot with that many letters
  (a wrong word replaces the previous wrong one); only the correct word gets a green check, locks in and counts.
  The puzzle is solved when every slot is correct.
- Every board is checked to have exactly one way to split into common words, with plenty of decoy words (Easy 12+, Medium 20+, Hard 30+),
  no straight runs longer than 3 tiles and no plural answers, so you can't just read words off the grid.

## Layout

- `src/generator.js` – seeded puzzle generator (random path partition of the grid + common words)
- `src/game.js`, `src/style.css`, `index.html` – the game UI
- `data/words.js` – pool of puzzle answers, built by `tools/build-words.js`
- `tools/test-generator.js` – generator validity test (`node tools/test-generator.js`)
- `tools/e2e.js` – Playwright test that solves each mode through the real UI
