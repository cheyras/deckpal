---
date: "2026-09-26"
title: "Collection, list and deck writes go through per-document lanes and always end visibly"
decided_by: "Chey (via Claude)"
areas: ["decks"]
supersedes: []
---
## 2026-09-26 — Collection, list and deck writes go through per-document lanes and always end visibly

**Decided by:** Chey (via Claude)

**Decision:** Collection counters, list edits and deck edits stop using one
`useMutation` per write. They go through `lib/writeLane.ts`: one request in
flight per document (`collection:<setId>`, `list:<id>`, `deck:<id>`); a write
still waiting its turn is replaced by a newer write for the same item (the last
intent wins); and the control shows the pending intent until the item's last
write settles. Every such write states an absolute target — the counters use
`PATCH /collection/variants/:id` instead of `…/increment`, and a deck row's ×
is `PATCH …/cards/:cardId {quantity: 0}` — which is what makes coalescing and
Retry safe. Outcomes are reported one way (`lib/writes.ts`): a final failure
rolls back and raises a `Toast` naming what did not save ("Couldn't remove
Pikachu from “Trade binder”."), adds why only when it is actionable (offline,
timed out, deleted, a 4xx's own message), and offers Retry when repeating the
request is harmless. A form that stays open (Edit list, the delete
confirmations) reports inline through `FormAlert` instead. Deleting a list or a
deck, and removing a card from a deck, offer Undo through the existing restore
and absolute-set endpoints. The server's answer to a collection write is folded
into the cached card and set responses (after cancelling any older read still in
flight, which would otherwise land last and undo it on screen); the set itself is
re-read once, two seconds after the taps stop, for the goal-specific have/need
flags the answer cannot supply, and the grid is no longer dimmed for a
background read. `Toast` is a new `components/ui` primitive: one at a time, in
PwaUi's bottom-right stack with the offline banner, errors announced
assertively.

**Why:** Quality audit QUAL-02: fifteen collection/list/deck mutations failed
with no message (restore, edit, delete, pin, add card, update deck among them);
Restore in Recently deleted — the undo for every delete — did nothing visible
on a 500. QUAL-06: the deck stepper fired unordered requests, and a stale
answer landing last replaced the whole deck with an older count. UX audit
UXC-02: the grid counters disabled themselves during a write, so the 2nd and
3rd tap of a three-copy pull were dropped, and each tap re-downloaded the whole
set (0.8–6.5 s on production) while dimming the grid. UXC-08: no undo in the UI,
although the server has one. TanStack Query does not order concurrent
`mutate()` calls, and its `scope` option serialises without coalescing or
saying which answer is an item's last word; those three properties are the
whole fix, so they live in one small module unit-tested on its own
(`lib/__tests__/writeLane.test.ts`) and in a browser check that injects 500s,
reordered latency and offline (`tests/browser/writes.mjs`).

**Implications:**
- Offline is unchanged where it was defined: the service worker still never
  queues a write, and the collection counters stay disabled offline. Other
  writes are attempted and fail with "You're offline." — they are no longer
  held by TanStack's paused-mutation queue and replayed later.
- A write that has not answered in 20 s is aborted and reported, so one stalled
  request cannot freeze the document's other writes. Aborting a fetch does not
  stop the server, though, so when a write got no answer (the deadline, a
  dropped connection) its outcome is UNKNOWN: the newer write already queued
  for that item fails with it (reported once, as the item's final word, so
  Retry targets the latest intent), and nothing more is sent for that item
  until 75 s after the unanswered one left — longer than the API function's
  60 s `maxDuration`, so it can no longer land after its replacement. A unit
  test holds that margin against `vercel.json`. Failures the server answered
  (a 500), and requests that never left an offline device, fence nothing.
  After an unanswered failure the surface re-reads what the write touched,
  at once and again when the window closes, in case the change landed late.
- Offline, a write is refused when it is asked for, not queued: one waiting
  behind another would otherwise go out by itself on reconnecting.
- `applyAnswer` cancels every read of the data a write touched that is in
  flight when its answer arrives, applies the answer, then asks those reads
  again, so a slow GET can neither undo the edit on screen nor be lost (an
  add's list refresh, a first load).
- The write-feedback toast sits outside every sheet, so the topmost `Sheet`'s
  Tab loop now runs through it: a keyboard can reach Retry for a save that
  failed inside a sheet. Only the topmost dialog handles Tab.
- Writes belong to the account that asked for them. On IDENTITY_CHANGED every
  lane is cancelled (queue dropped, in-flight request aborted, its answer
  ignored) and any Retry/Undo toast is dismissed; each write also re-checks the
  session just before it is sent, because another tab signing in changes
  storage before this tab hears about it.
- The set progress bars move when the server confirms (one round trip) rather
  than instantly from CardDetail's client-side copy of the progress maths,
  which is removed. Have/Need/Dupes counts and the "Need" filter catch up with
  the one re-read after the taps stop, so a card no longer vanishes from under
  the finger logging it.
- Additive writes — adding N copies from the deck search picker, adding to a
  static list — get no Retry, and their tile stays disabled while saving.
- Not done here: an exact Undo for removing a card from a list needs the list
  item DELETE to return its mutation `batchId` for `POST /mutations/revert`.
  Scanner and Deck-E batch commits have their own flows and are unchanged.
- New writes to these documents should use `save()` / `laneFor()` from
  `lib/writes.ts`, not a bare `useMutation`.
