---
date: "2026-08-24"
title: "Round two: the card spotlight, the snap legs, and the strand that survived round one"
decided_by: "Claude, from the owner's live test of round one (\"Wow, it is much"
areas: ["catalog"]
supersedes: []
---
## 2026-08-24 — Round two: the card spotlight, the snap legs, and the strand that survived round one
**Decided by:** Claude, from the owner's live test of round one ("Wow, it is much
better" — and then a card-navigation request that stranded him parked beside a
card for the life of the page).

**Decision:**

1. **A card tile on a set page is addressable now** — the "card spotlight."
   The system prompt used to say the floor out loud: the grid is
   window-virtualized, only visible tiles exist, so waiting for one never
   finished — which is why "take me to the illustration rare" got improvised
   highlight-and-wait instead of the choreography the owner specced ("bring up
   the set page … then scrolled down the page for me to the specific card …
   so it looks like he's flying down the page to the card"). The wait is a
   REQUEST now: `travelAfterRoute`, waiting on the strict one-spelling form
   `[data-decke-card="<cardId>"]` (allowlisted as exactly that shape and
   nothing looser), dispatches a `decke:reveal` window event every 400 ms; the
   set page listens, smooth-scrolls its virtualizer to the card (dedupe by
   identity, already-centred check, remembered across the not-loaded gap),
   the tile mounts, and the ordinary settle + `flyTo(scrollWith)` carries him
   to it. Tiles are flyTo/highlight targets, never clickable. Proven live
   end-to-end through the real `runUiTool` against the dev server, including
   the cold-navigation race (the listener mounts AFTER the first ask; the
   re-ask lands) and the polite 6 s failure for a nonexistent id. The prompt's
   addressability paragraph was rewritten into the recipe, and
   `prompt.test.ts`'s floor pin flipped to pin the new truth.
2. **The chat legs are snap legs.** `FlyOptions.rate` (playback-only, scales
   the solved track's duration and can touch nothing else — pinned by a test
   that proves same tilt, half time) with `SNAP_RATE = 2` on exactly the
   chip→mark entrance hop and the mark→chip exit dive. Measured live off
   `getState().flying`: entrance 518 ms, dive 432 ms, against ~1000/940+ at
   the old pace; the mid-session correction hop stays ordinary (321 ms leg
   observed untouched). Owner: "twice as fast … nice and snappy."
3. **The strand is fixed at both ends.** `onTravel` now fires on EVERY leg
   that moves him (the once-per-turn guard meant a mid-turn tidy — the reader
   navigating themselves — left later legs unable to re-mark him as out: no
   bubble, no read-timer, no retirement; "he never left. He just stayed
   parked"). And a WORDLESS presentation retires on its own shorter clock
   (`SILENT_RETIRE_MS`) — the read-timer used to key on the bubble having
   text, so highlight-and-say-nothing parked him forever.
4. `toolNavRef` stores only the pathname half of a tool navigation — a `goTo`
   may carry a query now, and the watcher compares against `pathname`, which
   never does.

**Implications:**
- "He was static when I scrolled" is understood and BOUNDED, not eliminated: a
  tile virtualized out of the DOM stops re-solving his station (grid overscan
  keeps ~1350 px of margin mounted), and the auto-retire now guarantees he
  leaves shortly after; perfect element-tracking through virtualization is
  deliberately not attempted.
- BinderView paginates rather than scrolls, so a spotlight into another binder
  page still fails politely at the cap; TableView rows carry the attribute.
- While the chat sheet is open the app scroll-locks the body, so no reveal can
  scroll the page in that state — irrelevant to the real flow (he dismisses
  the sheet before going out), recorded for whoever wants sheet-up reveals.
- New pins: the one-spelling allowlist (+8 refusals), the reveal-seam
  contract, an addressable-card audit tripwire, the rate playback pin.

