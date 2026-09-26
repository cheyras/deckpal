# iOS Simulator test kit

A reusable, scripted way to test DeckPal in real Mobile Safari on the iOS
Simulator — on-screen keyboard included, Home Screen (standalone PWA) install
included, signed in to a fake account, with live page state readable from the
Mac. Nothing here talks to a real backend or a real account.

On 2026-09-23 an investigation ran this whole method ad hoc, by hand, and
found real bugs with it (see the worked example below). `DECISIONS.md` noted
that no scripted recipe existed yet. This directory is that recipe.

**macOS only.** The iOS Simulator does not exist elsewhere. The Web Inspector
client (`wir.py`) is Python 3 stdlib only — no `pip install`, nothing beyond
what ships with macOS's Python 3.

## What's here

| File | What it does |
|---|---|
| `wir.py` | Safari Web Inspector client: lists inspectable apps/pages and evaluates JS on one, over the simulator's local `webinspectord_sim` socket. |
| `server.mjs` | Fixture server: builds the real web app (cloud mode) and serves it with a fake signed-in session and a hermetic fake API. Never touches Supabase or deckpal.app. |
| `keyboard_probe.js` | One JS expression: layout/keyboard measurements (`visualViewport`, scroll, focused-element rect, dialog/title/header rects, verdicts). Hand it to `wir.py eval`. |
| `measure_keyboard.py` | Convenience: focus a selector, settle, run the probe, print JSON. |
| `shot.sh` | Screenshot fallback via `xcrun simctl io booted screenshot`, for when the simulator MCP tool's own screenshot fails (observed right after a device reboot). |
| `__tests__/` | Pure unit/integration tests for the parts above that don't need a simulator (`test_wir.py`, `server.test.mjs`). |

## Quickstart

```bash
# From the repo root, one-time or after editing apps/web:
pnpm sim:serve                    # build (if needed) + serve on :5310
pnpm sim:serve -- --port 5410     # a different port
pnpm sim:serve -- --rebuild       # force a fresh build

# List what Web Inspector can currently see
python3 tools/ios-sim/wir.py list

# Evaluate JS on a Safari tab whose URL/title contains "lists"
python3 tools/ios-sim/wir.py eval --app safari lists "document.title"

# Evaluate a probe script from a file
python3 tools/ios-sim/wir.py eval --app safari lists @tools/ios-sim/keyboard_probe.js

# Focus a field and measure the keyboard/layout in one call
python3 tools/ios-sim/measure_keyboard.py --app safari lists 'textarea[name=description]'

# Screenshot fallback
tools/ios-sim/shot.sh /tmp/shot.png
```

## The runbook

### 1. Boot and attach

Use your own booted simulator, or boot one:

```bash
xcrun simctl boot "iPhone 16 Pro"     # or a udid; skip if one is already booted
```

If you're driving it with `mcp__Claude_Code_iOS_Simulator__control` (load it
via `ToolSearch` first if it's deferred), call its `attach` action so a human
can watch. It works on a booted simulator immediately.

### 2. Serve and seed

```bash
pnpm sim:serve    # binds 127.0.0.1:5310 only -- never reachable off this Mac
```

Then, on the simulator, open Safari to `http://127.0.0.1:5310/__seed` (via
the control tool's `open_url`, or by hand). That page plants a fake signed-in
Supabase session in `localStorage` and redirects to `/lists`. Confirm with a
screenshot: the amber-free, normally-styled DeckPal UI, not a sign-in screen.

`127.0.0.1` inside the Simulator is the Mac's own loopback (the Simulator is
a native macOS process, not a VM) — `localhost` and `127.0.0.1` both work.

### 3. Drive the UI and read state

Tap with the simulator MCP tool's `tap` action, using device-point coordinates
(the tool reports the coordinate space, e.g. `402x874`, on `attach`). Read
what's on screen with `wir.py eval`, not by eyeballing screenshots alone —
screenshots show you *that* something looks off; `eval` tells you *why*
(exact pixel rects, scroll positions, booleans) in a form you can assert on.

**Never use the simulator MCP tool's `text` action.** Typing through it
switches iOS into hardware-keyboard mode, which permanently hides the
on-screen keyboard for the rest of that boot — see Trap 1 below. If you need
to type into a field for a human to see, use `app_type`-equivalent real touch
input or accept that this kit's job is to *measure* the on-screen keyboard,
not simulate typing through it.

### 4. Home Screen (standalone) install

Share (bottom toolbar, roughly at 50% width / 96% height in device points) →
scroll the share sheet up → **Add to Home Screen** → this opens a **second**
confirmation screen (name + icon preview) → tap **Add** in the top right.
Both steps are required; tapping the share-sheet row alone does not install
anything.

Once installed, tap the new Home Screen icon to launch it standalone
(`window.navigator.standalone === true`, no Safari chrome). It shows up as
its own inspectable target — bundle `com.apple.SafariViewService`, distinct
from the ordinary Safari tab (`com.apple.mobilesafari`) — which is what
`wir.py --app standalone` is matching against. Verified 2026-09-26:

```bash
$ python3 tools/ios-sim/wir.py eval --app standalone '' \
    "({ url: location.href, standalone: window.navigator.standalone })"
{
  "url": "http://localhost:5310/series",
  "standalone": true
}
```

**Clean up when you're done**: long-press the icon → **Delete Bookmark** →
confirm **Delete**. Leaving test web-clips on the shared simulator's Home
Screen is exactly the kind of mess this kit exists to avoid causing.

### 5. Screenshot fallback

If the simulator MCP tool's `screenshot` action returns `captureFailed`
(observed reliably right after `xcrun simctl shutdown`+`boot`), use
`tools/ios-sim/shot.sh` instead — it talks to CoreSimulator directly via
`simctl io ... screenshot` and does not depend on that tool's attach state.

## Worked example: the Bug Report modal keyboard bug (2026-09-26)

Still unfixed on `main` as of this writing. Reproduced end-to-end with this
kit: seed → tap the bug-report icon → tap the report textarea for real (a
genuine touch, which is what raises the on-screen keyboard) → run the probe.

```bash
$ python3 tools/ios-sim/wir.py eval --app safari '' @tools/ios-sim/keyboard_probe.js
```

```json
{
  "activeElement": { "tag": "TEXTAREA", "rect": { "top": 125.25, "bottom": 283.25, ... } },
  "visualViewport": { "width": 402, "height": 409.65625, "offsetTop": 136.65625, "scale": 1 },
  "window": { "innerWidth": 402, "innerHeight": 541 },
  "scrollY": 137,
  "documentScrollHeight": 678,
  "documentPannable": true,
  "dialog": { "selector": "[role=\"dialog\"]", "rect": { "y": -82.75, "bottom": 541, ... } },
  "title": { "selector": "[role=\"dialog\"] h2", "rect": { "y": -49.25, "bottom": -22.25, ... }, "text": "Report a bug" },
  "header": { "selector": "header", "rect": { "y": -137, "bottom": -72, ... } },
  "verdicts": {
    "documentScrolledWhileKeyboardUp": true,
    "documentBecamePannable": true,
    "focusedElementCoveredByKeyboard": false
  }
}
```

The bug in one line: with the keyboard up, `scrollY` should stay `0` (only
the modal's own content should move) but it's `137`, and the modal's `title`
and `header` rects have gone **negative** (`y: -49.25`, `y: -137`) — the
whole document scrolled up far enough to push the dialog's own title and the
app header off the top of the screen, while the focused textarea itself
stays on screen (`focusedElementCoveredByKeyboard: false`). Dismissing the
keyboard restores `scrollY` to `0` and the normal layout — confirmed by
re-running the probe after tapping the keyboard's Done button — so it's
specifically a keyboard-up state issue, not a permanent layout regression.

This is exactly the class of bug this kit exists to catch: invisible in a
desktop-browser DevTools device-emulation check (no real iOS `visualViewport`
resize-and-keyboard interaction to reproduce), and easy to miss in a
screenshot alone (the crop looks like "the sheet is just tall," not "the
document itself scrolled").

## Traps (all cost real time to find — read before you hit them)

1. **The simulator MCP tool's `text` action breaks the on-screen keyboard for
   the rest of the boot.** It switches iOS into hardware-keyboard mode
   (macOS's real keyboard is "connected" to the simulator), which hides the
   on-screen keyboard even for genuine taps afterward. Simulator's
   `ConnectHardwareKeyboard` preference does **not** undo this once it's
   happened. The fix is a reboot:
   ```bash
   xcrun simctl shutdown <udid> && xcrun simctl boot <udid>
   ```
   After a reboot, re-attach, re-seed (the fake session lives in that Safari
   profile's `localStorage`, which a reboot does not clear, but re-seeding is
   cheap and removes any doubt), and expect trap 6 (stale duplicate
   `webinspectord_sim` socket) and possibly trap 5 (screenshot tool).

2. **`navigator.onLine` is `false` in the simulator, even though the network
   genuinely works.** Don't treat it as a real offline signal; if app code
   branches on it, that branch will be live during simulator testing whether
   you want it or not.

3. **An old service-worker shell can survive between sessions and serve a
   stale page.** `server.mjs` 404s `/sw.js` specifically to prevent a new one
   from ever installing, but a *previously* installed one (from testing
   against a real deployment in the same Safari profile, for instance) can
   still intercept `/` and serve cached content. Reload once if a page looks
   unexpectedly stale.

4. **The standalone host's speech recognizer is WebKit's mock and always
   returns `"Test"`.** Only an ordinary Safari *tab* runs the real
   speech-recognition engine; a Home Screen–installed (standalone) PWA gets
   the mock, unconditionally, regardless of any permission or configuration.
   If you need real transcription for a voice-input feature under test, do
   it from a Safari tab, or drive audio into the simulator's microphone with
   `say` on the Mac as a real voice source and confirm output in a tab first.

5. **The simulator MCP tool's `screenshot` action can fail with
   `captureFailed`** — observed reliably right after a `shutdown`+`boot`
   cycle (see trap 1). Use `tools/ios-sim/shot.sh` instead; it doesn't depend
   on that tool's attach/session state.

6. **A `shutdown`+`boot` reboot can leave the previous boot's
   `webinspectord_sim` socket file behind.** `find /private/tmp -name
   'com.apple.launchd.*'` can then show two
   `com.apple.webinspectord_sim.socket` paths — one live, one stale. `wir.py`
   handles this itself (picks the most recently modified one), but if you're
   reaching for the socket directly, don't assume there's only ever one.

7. **`webinspectord_sim` appears to rate-limit or cool down new
   connections.** Measured against iOS 18.6: the third fresh connection
   within roughly ten seconds gets no reply at all — not even the
   unsolicited state push every other connection receives immediately — and
   a plain retry after a ~15s pause always recovered. `wir.py` retries this
   automatically (one wait, then one more attempt) and prints a message when
   it does, but if you're scripting many `wir.py` invocations back to back
   (rather than one process doing several things, which is what
   `measure_keyboard.py` does internally to avoid the problem entirely),
   expect occasional multi-second pauses.

8. **`Add to Home Screen` is two steps, not one.** The share-sheet row opens
   a *second* screen (name + icon preview) with its own **Add** button in the
   top right. Tapping only the share-sheet row does nothing observable — no
   error, the sheet just closes — which reads as "it didn't work" when
   actually the flow just isn't finished. See the runbook's step 4.

9. **`Runtime.evaluate`'s `awaitPromise` doesn't work over this protocol.**
   Setting it `true` does not make Safari wait for a promise to settle — the
   caller gets the pending promise's own `RemoteObject` back immediately,
   not its resolved value. `wir.py eval` works around this itself (see its
   module docstring): it wraps the expression, parks a thenable's outcome on
   `window`, and polls a follow-up `Runtime.evaluate` for it. You don't need
   to do anything differently for an async expression — `eval` already
   handles it — but if you're extending `wir.py` itself, don't reach for
   `awaitPromise: true` expecting it to work.

## Tests

```bash
pnpm test:ios-sim
```

Runs both pure suites: `node --test tools/ios-sim/__tests__/server.test.mjs`
(the fixture server's routing and seed page — no build, no socket) and
`python3 -m unittest discover -s tools/ios-sim/__tests__` (`wir.py`'s plist
frame codec, message dispatch/routing, and socket-selection logic — no real
socket, no simulator, no macOS dependency; these run anywhere Python 3 does).

Neither suite needs a booted simulator. The runbook above is what actually
exercises one, and there is no automated substitute for it — a real iOS
Simulator running real Mobile Safari is the point.

## What this kit does not cover

- **Real devices.** `webinspectord_sim`'s socket and framing are the same
  protocol a real device speaks over USB (via `usbmuxd`/lockdown pairing),
  but this kit only implements the Simulator's plain local-socket transport.
  Real-device support would need the pairing/TLS handshake layer, which is a
  materially different (and much larger) client.
- **JSContext / WebView debuggables inside native apps.** `wir.py` only
  targets `WIRTypePage`/`WIRTypeWeb`/`WIRTypeWebPage` by default. The
  protocol also exposes JSContext and service-worker debuggables
  (`WIRTypeJavaScript`, `WIRTypeServiceWorker`); `list` will show them, but
  `eval`'s page search does not match them.
- **The standalone viewport's own quirks beyond what's measured above.**
  The worked example above is the one bug this session independently
  reproduced end-to-end. If you're chasing a different standalone-vs-tab
  layout difference, `keyboard_probe.js`'s fields (`visualViewport`,
  `window`, `scrollY`) are the starting point, but you'll want to extend the
  probe rather than assume this one already covers it.
