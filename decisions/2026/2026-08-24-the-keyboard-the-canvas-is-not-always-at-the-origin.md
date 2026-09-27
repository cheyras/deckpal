---
date: "2026-08-24"
title: "The keyboard: the canvas is not always at the origin"
decided_by: "@cheyras (report and the instruction to research first), agent"
areas: ["general"]
supersedes: []
---
## 2026-08-24 — The keyboard: the canvas is not always at the origin

**Decided by:** @cheyras (report and the instruction to research first), agent

**Decision:** Three changes, and the first one is the bug:

1. `viewportToBlender` subtracts the CANVAS'S OWN client origin before mapping a
   DOM rect into NDC. `viewport.ts` gains `setCanvasOrigin` / `canvasOriginX` /
   `canvasOriginY`; `DeckE` re-measures the canvas rect when a new `originDirty`
   flag is set (by the capture-phase `scroll` listener, by `visualViewport`
   resize, and by `resize`).
2. The chat holds the page with `html, body { height: 100%; overflow: hidden }`
   instead of `Sheet`'s shared `lockScroll`, which pins the body with
   `position: fixed`. `Sheet.tsx` is untouched and its four other consumers keep
   the old lock.
3. The composer is auto-focused on DESKTOP ONLY.

**Why:** Three attempts failed before this one, and all three failed the same
way: they were reasoned about on a desktop browser and "verified" by simulating
a keyboard with CSS, which tests the model rather than the platform. The fourth
attempt started by putting a live readout on screen in the iOS Simulator and
reading the numbers off a real keyboard:

```
              keyboard down          keyboard up
scrollY       1                      269
innerHeight   678                    410
panel         64..678                -204..410
park          447..592               179..324
composer      600..658               332..390
canvas        0..760                 -268..492
```

**The canvas moved to -268 and the projection did not know.** `viewportToBlender`
mapped client Y straight into canvas NDC under a comment that said "the canvas is
top-anchored, so a viewport Y and a canvas Y are the same number" — true of every
frame except the ones that matter. The park box at client 251 was drawn at client
-16, which is the character a few pixels off the top of the screen. Every reported
symptom is that one subtraction:

- *"Deck-E disappears"* — he was drawn 268px above where he belonged.
- *"He scrolls at a faster rate than the rest of the page"* — exactly twice: the
  page moved him once, and the stale origin moved him again by the same amount.

Why the canvas moves at all: focusing an input makes iOS scroll the document to
reveal it, and it does that even with the page held. WebKit ships a regression
test asserting precisely this — `body-overflow-hidden-height-100-percent-keyboard`,
whose expected result is "the document did scroll". Every `position: fixed` layer
on the page rides that scroll.

**Implications:**

- **The platform's reveal is the feature, not the enemy.** Measured: a real tap
  on the composer produces the correct result on its own — iOS scrolls the panel
  up and the composer lands above the keyboard. Nothing in this change tries to
  position anything against the keyboard.
- **Resizing the panel to fit above the keyboard was tried, on the device, and
  is WRONG.** iOS reveals regardless of whether the input is already visible, so
  the two compound: with the panel shortened by 268 AND iOS scrolling by 268, the
  panel measured -204..142 and the composer ended up near the top of the screen.
  That is the "huge gap" and the intersecting headers from the 2026-08-24 report,
  reproduced and understood. `kbInset` is not in this change.
- **Nothing here reads `visualViewport` geometry.** It is a version lottery
  (WebKit 229876 on iOS 15, WebKit 297779 on iOS 26, which hit apple.com), and
  the fix does not need it: it asks the browser where the canvas is, which is a
  measurement rather than an interpretation. *"It shouldn't matter what version
  I'm on — more people than just me will use it."*
- **The auto-focus was a second, independent defect.** iOS runs its reveal for a
  focus the USER caused and not for one a timer caused, so opening the chat put
  the keyboard over a composer that stayed put. Not auto-focusing is also the
  better phone behaviour: the empty state is a greeting, three suggestions and a
  character, and the keyboard covered all three to save a tap nobody had asked
  for. Desktop keeps it.
- **`lockScroll` is untouched and still shared.** The chat holds the page itself
  now. The other four `Sheet` surfaces almost certainly have the same class of
  bug and are filed rather than fixed, per the scoping call.
- **KNOWN REMAINING ROUGH EDGE, measured and not fixed:** with the keyboard up
  the document's real scroll range is 1px, so a reader who scrolls away from the
  composer cannot scroll back to it and must dismiss the keyboard and tap again.
  Giving the document a keyboard's worth of genuine scroll range would fix it
  without moving anything, and is the next thing to try if it bothers anyone.
- **The instrument matters more than the fix.** `xcrun simctl` plus the Simulator
  control tool drives real Safari with a real keyboard; a temporary on-screen
  readout of the numbers above turned four rounds of inference into one
  measurement. Two of the linked IDB-based tools could not be installed at all —
  `idb-companion` needs Xcode 26 to compile and this machine has 16.4 — and were
  not needed.

### 2026-08-24, same day — verified again on iOS 26.5

Re-run on an iPhone 17 Pro / iOS 26.5 runtime once Xcode 26 was installed,
because the whole point of the approach is that it should not care which iOS it
is on, and 26 is the version carrying the `visualViewport` regression (WebKit
297779) that the earlier attempts would have been exposed to.

Identical result to 18.6 across the whole pass: opens with no keyboard and
everything visible; a tap on the composer gets iOS's reveal with the composer
above the keyboard and him beside it in the park box; dismissal restores
exactly. This is the expected outcome rather than a lucky one — the fix reads no
`visualViewport` geometry at all, so there is nothing for that regression to
corrupt.

ONE BEHAVIOURAL DIFFERENCE, and it is in our favour: the stranding noted above
does NOT reproduce on 26.5. A swipe with the keyboard up moves nothing — the
page is genuinely held — where 18.6 let the reader scroll away from the composer
and not scroll back. So the known rough edge is 18.6-and-earlier only, which
lowers its priority but does not remove it.

TOOLING, for whoever verifies next:
- The built-in simulator control caches its device list at session start. A
  runtime installed mid-session is invisible to it and no amount of detaching
  helps; restart the session, or use `idb`.
- `idb` is finally installable now that Xcode 26 is present (`brew install
  facebook/fb/idb-companion` needed it and refused on 16.4). The Python client
  is NOT compatible with Python 3.14 — `asyncio.get_event_loop()` raises — so
  install `fb-idb` into a 3.11 venv. `idb ui tap/swipe/text` then drives any
  booted device by udid, including ones the built-in tool cannot see.

---

