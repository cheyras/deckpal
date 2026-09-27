---
date: "2026-08-21"
title: "Booster-rip dedup is departure-then-return, not a time window"
decided_by: "Claude Opus 5 on behalf of @cheyras."
areas: ["general"]
supersedes: []
---
## 2026-08-21 — Booster-rip dedup is departure-then-return, not a time window
**Decided by:** Claude Opus 5 on behalf of @cheyras.
**Decision:** `ripSession.ts` is a pure state machine over the scanner's
per-frame matches. A card commits after `COMMIT_FRAMES` (3) consecutive frames
under `TRUST_DISTANCE` (7), then becomes REFRACTORY until the stream has missed
it for `LEAVE_FRAMES` (2) consecutive frames. Quantity is a user action.

**The obvious rule is inverted, and that is the whole difficulty.** "Same card
id within N seconds is the same card" reads correctly and is backwards: at the
scanner's 700 ms cadence with two-frame stability, a card held steady
re-stabilises about every 1.4 s, so holding ONE card for four seconds logs it
three times. A card is not new because it matched again — it is new because it
LEFT and something came back.

**`LEAVE_FRAMES` is 2 because 1 reintroduces the same bug by another route.**
The first version cleared the refractory set on a single missed frame. Cards
wobble — a hand shifts, a reflection catches the lens — and one frame comes back
over threshold, at which point the card is re-logged the moment it steadies. Two
frames (~1.4 s) is longer than a wobble and shorter than the gap between pulling
two cards. A test pins each side.

**Stricter than the single-card scanner, deliberately.** That flow uses 2 frames
at distance 9 and then STOPS to show the reader a result they can reject. A rip
runs unattended for minutes, so a false positive is not caught by anyone — it
just lands in the list. 3 frames at distance 7 costs a moment more hold time per
card and is the difference between a list you check and a list you rewrite.

**Quantity is never inferred.** Whether a second sighting is a second copy or a
re-show of the first is genuinely ambiguous, and no heuristic resolves it. The
row carries a stepper; the machine does not guess. Removing a mis-read also
clears it from the refractory set, so a correction can be rescanned immediately
rather than being invisible until the card leaves frame.

**The `cardId` -> `variantId` bridge needs no API change.** `POST
/collection/batch` takes integer `variantId`s and `/scan` returns string
`cardId`s, but `api.card(cardId)` already returns `variants[]`, so the client
resolves it before committing. `POST /collection/cards/:cardId/have` does the
same resolution server-side via `card_variant.is_primary`, which is the
precedent for picking the primary when the reader has not said otherwise.

---

