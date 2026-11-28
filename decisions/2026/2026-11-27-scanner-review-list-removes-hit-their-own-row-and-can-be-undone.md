---
date: "2026-11-27"
title: "Scanner review list: removes hit their own row and can be undone"
decided_by: "Chey (via Claude Opus 5.5)"
areas: ["scanner", "frontend"]
supersedes: []
---
## 2026-11-27 — Scanner review list: removes hit their own row and can be undone
**Decided by:** Chey (via Claude Opus 5.5)

**Decision:** From the owner's 2026-11-27 scan session (S5 of the Tack spec):

1. A review-list row's remove is in the row's own control line, never on its
   edge. On a card row it is the stepper's left button while the quantity is
   one (drawn ×, named "Remove <card>"); at two or more that button is the
   minus again. A needs-input row has "remove" beside "pick a match". The
   absolutely-positioned 22px × at each row's top-right corner is gone.
2. A remove is honoured only for the row that was under the finger: the list
   (`VerifyFeed`) records when its rows last moved — a row closing up, a scan
   landing at the top, the header changing height, the list resizing, a
   scroll the list started — and a remove pressed less than 300ms after that,
   or on a row that moved between finger-down and finger-up, does nothing.
3. Every destructive remove in the scanner — the row's remove, the stepper
   going below one (list and swipe review), "Discard and retake" — names what
   it removed and offers Undo through the app's toast ("Removed Galvantula ·
   Undo"), restoring the row to its place in scan order exactly as it was.
   Voice keeps its own Undo. The scanner's bottom bar publishes its height as
   `--toast-lift` so the toast stands above "Add N cards".
4. `/scan` holds `html[data-fixed-screen]` (`useFixedScreen`): the document
   behind the fixed screen cannot be scrolled by the reader, and the list has
   `overscroll-behavior-y: contain`.
5. The scanning bin follows the newest scan to the top only once the reader
   has let go of the list and been idle for a second.
6. The scanner's bottom bar, a bar-less list and the bottom notices honour
   Deck-E's launcher (`[data-fab-bar]`, `[data-fab-clear]`, `[data-fab-lift]`
   under `html[data-fab]`).
7. The count chip names the repeat — "9 cards · 2× Durant" (up to two names,
   then "N duplicates") — instead of "9 cards · 8 unique", and truncates
   rather than wrapping the header.
8. The offline banner's reachability probe (an uncredentialed `GET /api/me`,
   so a 401 every time) re-asks on window focus only when its last answer is
   older than 60s or was not "reachable"; offline re-probes back off from 5s
   to 60s.

**Why:** A tap meant for a Herdier removed the Galvantula two rows down
("Verify (9). I had 10 before… I swear"), silently, with no way back but a
rescan. Replaying the trace (tap at viewport y≈322 on "Remove Galvantula") at
428×926 puts the list at scrollTop 218, where the Herdier's name and its own ×
(y=166) are under the sticky header and the only × beside the visible half of
the Herdier is Galvantula's, directly under the Herdier's stepper: the × sat on
the boundary between rows and read as belonging to the row above. A quick
second tap also removed the next row as it slid into the first one's place.
The scroll stall ("for a second I was trying to scroll and it wasn't doing
it") came from the document behind the fixed screen being scrollable (the
shell's 100vh is the toolbar-hidden viewport on iOS; the trace shows a tap with
pageY − clientY = 34): swipes on the chrome or off the list's end scrolled an
invisible document, and while it coasted iOS gave it the next touch. In the
bin, a landing scan also smooth-scrolled the list to the top under a dragging
thumb. No non-passive touch listener of the app's sits on the scroll path
(measured), so the main thread does not gate list scrolling.

**Implications:** The remove control's move is visible to the owner: the ×
is now in the stepper. Anything new placed at a row's top edge reintroduces
the boundary ambiguity. Another fixed full-screen route can opt into
`useFixedScreen`. `tests/browser/scanReviewList.mts` (suite
`scan-review-list-proof`) replays the trace and checks remove placement,
the double tap, Undo, scroll containment, the follow rule, launcher clearance,
the chip and the probe cadence at 390×844 and 428×926. WebKit has no scroll
anchoring, so a scan landing above a scrolled reader in the bin still moves
the rows by one (the remove guard covers it); anchoring them belongs with the
capture-to-list animation work.
