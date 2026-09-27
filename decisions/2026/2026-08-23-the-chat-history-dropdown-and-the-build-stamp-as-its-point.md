---
date: "2026-08-23"
title: "The chat history dropdown, and the build stamp as its point"
decided_by: "Claude Opus 5 on behalf of @cheyras"
areas: ["agents","frontend","operations"]
supersedes: []
---
## 2026-08-23 — The chat history dropdown, and the build stamp as its point
**Decided by:** Claude Opus 5 on behalf of @cheyras

**Decision:** Deck-E's panel gains a `History` control to the right of the title
and a read-only transcript viewer behind it. Four decisions inside that were
open and are now closed:

1. **Where the build stamp lives, and what it says when there is none.** Every
   list row and every recorded turn carries a monospace, tabular-figure stamp —
   `#78` for one build, `#77→78` for a conversation that outlived a deploy, and
   an em dash for a turn with no attributable PR. `buildStamp()` in
   `historyState.ts` is the only place that decides, and it can never produce
   `#0`, `#null` or the word "unknown": `buildPr` is legitimately null on a
   preview or a local build and a number-shaped claim about a build nobody
   deployed is worse than a blank.
2. **A deploy that landed MID-conversation gets a ruled line.** When a turn's
   stamp differs from the one before it, the transcript draws `Deployed #78`
   across the column. It is the only element allowed to interrupt the reading
   flow, and it earns that: the turn above it and the turn below it ran on
   different code, which is the single fact a regression hunt is looking for.
   `Deployed` is claimed only when BOTH stamps are known; going from unknown to
   known says `Build #78` and claims nothing about what changed.
3. **The viewer has no composer.** Not greyed, not disabled — absent, replaced
   by a bar that says the record is not live and holds the way back. Same ruling
   as the spent-credit state, in the same slot, for the same reason: a control
   that is gone cannot take a question it will never answer. Escape unwinds one
   layer (dropdown → record → panel) rather than closing everything.
4. **Deleting is two presses with no undo, and the delete is always visible.**
   The RLS grants delete and withholds update, so there is nothing to restore
   and nothing offers one. The ✕ began as a hover-reveal and that was reversed:
   two of this session's own instruments disagreed about whether it was visible
   on a touch profile, and `Emulation.setEmulatedMedia` will not force the
   `hover` feature to settle it. The safety is the second press, not the hiding.

**Why:** *"I think fixing things and improving the agent will be greatly helped
by having a full record of all my chats, which tools were called. Should
probably have each chat transcript record say what was the latest PR it's
immediately after so we can easily spot regressions."* Two audiences — a reader
finding a conversation again, and a maintainer asking "did this get worse, and
when" — and the second got two of the three sentences.

**Implications:**

- **`/api/decke/history` is not deployed.** Against the live backend the
  dropdown's only reachable state is `Couldn't load your history. / No such
  route`, which is honest and correct and is not the feature. The UI was driven
  through its real states with `probe-chat-history.mjs --stub`; the server half
  is verified by nobody until the routes ship.
- **`ToolPhase` gained `unknown`, and `ToolRowData` gained `recorded`.** The
  history is the tool row's second consumer and revealed two states the first
  never had: a phase this app does not recognise, and a call that was still
  running when the turn was filed. Both are muted and say so in words; neither
  draws a tick. `ToolRowAppearance` now names its `glyph` exhaustively instead
  of inferring it from the tone — the inferring ternary's fall-through cases
  were "tick" and "warning", which is how a refusal once shipped with a ✓.
- **`.decke-shift` gained a `max-width`, and that fixes a pre-existing bug in
  the LIVE transcript.** Measured at 390px: a tool row carrying
  `decke-shift w-full` ran from x=128 to x=486 in a column ending at x=374 —
  112px, exactly one gutter, off the right edge, with its text clipped mid-word.
  `w-full` is `width: 100%` and a percentage width does not subtract the
  element's own margin. `.decke-bubble` and `.decke-figure` already carried the
  cap, which is why replies and panels were fine and rows were not.

---

