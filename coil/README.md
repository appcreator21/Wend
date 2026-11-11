# Coil for iMessage

A turn-based word duel you play inside a Messages conversation.

**How a duel goes**

1. Open a conversation, tap Coil in the apps row, pick a board and solve it.
2. Tap **Send**. The turn lands in the text field as a bubble; send it with the normal arrow.
3. The other player taps the bubble and plays the *same board* against your time. Faster wins the round.
4. They then solve a fresh board and serve it back. First to 3 rounds wins; either side can start a rematch.

A hint costs 15 seconds. Once you tap Play on a round the clock keeps running even if you leave, and a round
that has been played cannot be replayed for a better time.

## Build and install

You need a Mac with Xcode 15 or newer and your Apple Developer account.

1. Open `coil/Config.xcconfig` and set `APP_BUNDLE_ID` to an id of your own (for example `com.yourname.coil`).
2. Open `coil/Coil.xcodeproj`. For **both** targets (`Coil` and `CoilMessages`) go to
   *Signing & Capabilities* and choose your team. (Or put the Team ID in `Config.xcconfig` once.)
3. Plug in your iPhone, select it as the run destination and press Run. Coil appears on the home screen
   (solo practice) and in the Messages apps row (duels).

To try a duel on one Mac first: run the `Coil` scheme on a simulator, open Messages there. The simulator's
Messages app has two fake participants you can switch between to play both sides.

## Getting it onto the other phone (TestFlight)

1. In [App Store Connect](https://appstoreconnect.apple.com) create a new app with the same bundle id. Any name
   that is free will do; nothing is published.
2. In Xcode choose the destination *Any iOS Device*, then *Product > Archive*, then *Distribute App > TestFlight & App Store*.
3. When the build finishes processing, open the app's **TestFlight** tab.
   - Fastest: add the other player as an **internal tester** (they need to be a user on your App Store Connect team; up to 100, no review).
   - Otherwise create an **external** group and add their email. The first external build goes through a short beta review.
4. They install the TestFlight app, accept the invite, install Coil, and it shows up in their Messages apps row.

TestFlight builds expire after 90 days; archive and upload again (bump `CURRENT_PROJECT_VERSION`) to renew.

## How it is put together

| Path | What it is |
| --- | --- |
| `Web/` | The game itself: page, styles and all the rules (`coil.js`). Runs in a web view. |
| `Shared/GameHost.swift` | The web view, a `coil://` handler that serves the bundled files, and the JSON bridge. |
| `MessagesExtension/` | `MSMessagesAppViewController`: hands a tapped message to the page, turns a finished turn into an `MSMessage`. |
| `App/` | The small home-screen app every iMessage app ships inside (solo practice). |
| `tools/serve.js` | Runs the game in a desktop browser: `node coil/tools/serve.js`. |
| `tools/test-duel.js` | Plays a whole duel between two simulated phones. |
| `tools/make-xcodeproj.rb` | Regenerates the Xcode project after files are added or removed. |
| `tools/make-icons.js`, `tools/resize-icons.py` | Rebuild the icon sets. |

The boards come from the same generator and word list as the web game (`src/generator.js`, `data/`), which the
Xcode project bundles directly, so there is one copy of each.

One message is one turn. Its URL carries the whole duel (score, last round, the board and the sender's time), so
there is no server. A checksum rejects damaged or hand-edited messages; it is friendly-rivalry protection, not
tamper-proofing.
