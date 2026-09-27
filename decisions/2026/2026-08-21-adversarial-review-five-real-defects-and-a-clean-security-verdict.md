---
date: "2026-08-21"
title: "Adversarial review: five real defects, and a clean security verdict"
decided_by: "Claude, acting on a Fable 5 adversarial review (step 7 of the"
areas: ["security"]
supersedes: []
---
## 2026-08-21 — Adversarial review: five real defects, and a clean security verdict
**Decided by:** Claude, acting on a Fable 5 adversarial review (step 7 of the
owner's original sequence).

**Security verdict, recorded because a negative result is worth as much as a
finding:** no path was found from a model-supplied string to markup, `href`,
`src`, a URL, a class name, or an unintended navigation. The landmark allowlist
(`el.closest('[data-decke-landmark]')`), the route allowlist (with `//` and `/\`
smuggling both rejected), and the markup-free screen schema all hold. The
reviewer states plainly that there is no `click` tool, so `flyTo`/`highlight` can
only move and ring.

**Fixed:**
1. **`variantsAsked` was never cleared** (`Scan.tsx`). The per-card variant cache
   outlived the session it belonged to, so from the SECOND pack onwards a
   repeated card early-returned, kept `variants: []`, rendered no printing
   selector and committed as primary — reinstating the exact mis-filing the
   selector was added the same day to prevent. Now cleared with the session
   (`resetRip`) and per committed card.
2. **The client swallowed `error` parts** (`useDeckeChat.ts`). An error part is a
   VALUE on a 200 stream, not a thrown exception; with no branch it was dropped,
   the stream ended `done`, and the `catch` never ran. A dead turn was
   indistinguishable from a turn he chose not to answer. This is the same trap
   that cost an afternoon server-side, one layer out.
3. **`thinking` was latched** (`useDeckeChat.ts`). It is a sustained state and the
   turn boundary never left it; the `talk` overlay is additive, so it looked
   correct while he spoke and only showed afterwards. On any turn where the model
   set no state — which the prompt actively encourages — he looped in it forever.
4. **Cards scanned during the commit request were discarded** (`Scan.tsx`). Rip
   mode never pauses, `commitRip` closed over the list at click time, and the
   handler then emptied the whole session. Now only committed rows are removed.
5. **Clearing the quantity box deleted the row** (`ripSession.ts` + `Scan.tsx`).
   `Number('') === 0` and 0 meant delete, so the row vanished as the reader
   pressed backspace to retype — and `setQuantity` does not release `refractory`,
   so the card could not be rescanned until it left the lens. An empty field is
   an absence, not a zero: the component maps it to `NaN` and the reducer refuses
   non-numbers. An explicit 0 still deletes.
6. **Cross-turn cleanup race** (`useDeckeChat.ts`). `busy` is React state, so two
   sends in one frame both passed the guard; the superseded turn's `finally` then
   cleared the live turn's overlay and overrides. Cleanup now runs only if the
   turn still owns `abortRef`.

**Left as noted, not fixed:** `WireCommand`'s op union, `commandSchema`'s enum and
`apply()`'s switch must agree by hand, as must `BLOCK_KINDS` and `DeckeScreen`'s
switch. Both are real extension hazards. Both are also the fail-closed direction —
an unknown op or kind is dropped, never rendered — so the cost of drift is a
silently ignored command, not a broken page. Worth a shared type when either list
next changes.

