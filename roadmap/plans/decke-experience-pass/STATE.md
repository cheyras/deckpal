# Where this pass actually stands — the compaction-safe handoff

Written so that losing the conversation costs nothing. If you are picking this up
cold, read this file, then `ESCORT-PLAN.md`, then `COVERAGE.md` Part II.

---

## The standing instruction

> Work until all the outstanding things from the big pass are totally done.
> Build a dev page of AI chat UI primitives and composed flows — every kind —
> and do a full UI pass against that surface, where it can all be seen at once
> without chatting. **beautiful-ui.dev is the FORM/STRUCTURE. The existing app
> design system is the TONE/FEEL.** Use a subagent that is JUST a designer, with
> its whole context on visual taste. Look hard at claude.ai. The starter prompt
> box is lame — big, nice text above the input, centred, before a conversation
> starts. Chat widgets should have real card thumbnails and feel like the rest
> of the app. Verify at desktop AND mobile sizes.

**The owner's judgement on the work so far, which must not be softened in any
summary:** *"a lot of the design feels phoned in… laughably bad… I'm honestly
pretty disappointed."* That is accurate and it is the bar to clear.

## Why it went wrong, so it is not repeated

Playwright only started working late on 2026-08-22. **Before that every "visual
verification" was an agent reading code and reasoning about what it would look
like.** When I finally looked, I checked composition (is the sidebar sharp, is he
beside the composer) and never craft. The vision judge was never run. The
beautiful-ui research (`research/R6-beautiful-ui.md`, per-component specs) was
gathered and then **not used** — the work was built against a plan instead.

**The rule now: nothing is "done" until it has been photographed and looked at,
at 1440×900 and at 390px.**

## The instrument, which works

```
PLAYWRIGHT_MODULE='E:/Users/cheyr/deckpal/node_modules/.pnpm/playwright@1.62.1/node_modules/playwright' \
  node scripts/visual-harness/capture-decke.mjs --scene chat-open --base http://localhost:5204
```

- Playwright is **already in the repo's pnpm store**; it does not need installing.
- Base must be **`localhost`**, not `127.0.0.1` — vite binds IPv6.
- `pnpm dev` serves on the first free port from 5199; check its output.
- Crop with the ffmpeg at `contact-sheet.mjs:21`, then read the PNG.
- **Stub `DevBackendRibbon` out before photographing**: it is `fixed bottom-0
  z-[9999]` and sits exactly over the composer at phone width. It is dev-only
  chrome and it has already caused one false bug report.
- Measure computed styles by driving Playwright directly rather than reading CSS.
  The composer's double border took four wrong guesses from CSS and one query.

## Fixed and photographed

- Composer: the inner blue outline (a specificity loss — premium's focus halo
  scores (0,3,0), the composer's override (0,2,1)), 20px→14px radius, focus no
  longer 2px of saturated cyan, 20px of bottom breathing room.
- He is no longer cut off: `anchor: 'bottom'` in `parkBeside`, threaded through
  `FlyOptions`, the station **and** the re-solve.
- Placeholder clipping at 390px ("Ask Deck-E…").
- **Deck-E never appeared after signing in** — `deckeEntitled()` cached the
  signed-out 401 forever; `resetDeckeEntitlement()` existed with no caller.
- **Most tools failed on a protected preview** — the self-hop forwarded the
  bypass *header* but not the `_vercel_jwt` *cookie* a browser session uses.
  17 tools use `ctx.api`. Preview-only; production was never affected.
- `escort` macro tool, C21 thinking beat, the dismissal preference, C40 compact
  screens, the transcript live region, jump-to-latest, C35 flight profile.

## Outstanding — the actual list

1. **The dev gallery page** (`/dev/chat-ui`) — every chat primitive and composed
   flow on one surface. **This is the prerequisite for everything below it.**
2. **A designer subagent** does the UI pass against that page, desktop + mobile.
   Form from beautiful-ui, tone from the app's own system.
3. **The empty state** — big, well-set text above a centred composer, the way
   claude.ai does it. Currently small and lame.
4. **The approval card** — reported as *"amateur… less helpful than him just
   asking in text"*. Needs real card thumbnails.
5. **The scrollbar** sits beside the transcript instead of at the window edge.
6. **He answers as though a cancelled write happened.** Reported: denied the
   add, and his reply implied it went through. Worst item on the list — it is
   the exact failure this pass exists to prevent, and it is correctness, not
   paint.
7. ~~**The escort is still unmeasured.**~~ **MEASURED 2026-08-23** —
   `ESCORT-PLAN.md` §8. 40 trials: "help me find pitch black" walks **19/20 via
   `escort`**, `journey` 0, arguments correct 19/19, against a `journey`
   baseline of 2/10. Both controls clean — "take me to it" jumps 10/10, a
   progress question navigates 0/10. The diagnosis (construction cost, not
   reluctance) holds. The instrument now lives at
   `scripts/decke-tool-choice-probe.mjs` instead of a scratch directory.
   **And reading the steps found what the wire could not:** the walk pointed at
   the set row and stopped, leaving the person on `/series/<slug>` looking at a
   link to what they asked to be helped to find. Fixed — it presses the row now,
   after a `LOOK_BEAT_MS` hold so the pointing is not erased by the press.
   **Still open: arrival has not been seen in a browser. Gate 22 is the
   authority and it needs a deployment with these commits on it.**
8. **Rotate `AI_GATEWAY_API_KEY`** — a subagent printed it into a task log at
   `…/tasks/a379da90ff2fcbc10.output`. Marketing-images key, not Deck-E's.
9. Lower priority, from `COVERAGE.md` §II.6: C51's control row, C39, C46 (needs
   an owner ruling, not a decision), D8 (confirmed real, `LEAD_MAX` ruled out —
   the composed pose comes from `rig.float.rotation` and `pose.lean * 15` into
   the rider system, both additive on top of the flight track).

## Where it stands after the night of 2026-08-23

**The design pass landed.** The approval card leads every row with real card
art and confirms with "Add 1 card" / "Remove 2 cards"; the empty state is
30px Fraunces above a centred composer; tool rows have a status pill instead
of a bold run-on; the scrollbar is at the pane edge, verified by measuring the
real app and then reverting to reproduce the 342px defect. `/dev/chat-ui`
photographs all of it at 1440 and 390.

**Verified rather than taken on report:** 405 web tests, 171 api, 7 mcp, 52
deck, 33 images, 9 variants — every CI suite green locally, typecheck clean, no
file with mixed line endings, and the one mutation the designer reported coming
back GREEN re-run to confirm it now goes red.

### Still open

1. **Gate 22 has not run.** The QA meter was spent (120/day, UTC-midnight
   reset) and it returns 429. It is the authority on ARRIVAL and it is the last
   unverified thing about the escort. `probe-escort-path.mjs` covers the half
   that needs no turn — all seven hops including the press that opens the set.
2. **Rotate `AI_GATEWAY_API_KEY`** — still the owner's to do.
3. ~~**Deck-E clipped bottom-right on desktop.**~~ **NOT REAL — it was the dev
   ribbon**, for the third time in this codebase. `capture-chat-panel.mjs` did
   not strip it. Re-shot clean: he is whole at 1440 and 1720. `parkBeside`'s
   horizontal clamp is present and correct (`region.left + margin`, margin =
   `bodyPx * 0.6`); the `bandSpan` path that does NOT bite at zero is a
   different solve, and I misread one for the other. **That claim was wrong when I made it:**
   `capture-decke.mjs`, the primary instrument and the one that sentence was
   about, had forgotten it — its review JPEG had the ribbon across the composer
   and his feet. A helper you can decline to call is documentation. The strip
   now runs inside the three shared functions in `lib/screenshot.mjs` that every
   capture goes through, which is the choke point it should have been.
4. **Mobile openers are indented ~113px while the heading is at 16px.** Real,
   and measured. The indent is `decke-shift` clearing him — correct for the
   THIRD chip, which does overlap him, over-correction for the first two, which
   do not. Fixing it trades "clear him" against "align with the heading", which
   is an owner call. He also stands very tight to the left edge at 390px:
   whole, but with almost nothing to spare.
5. **C46 needs an owner ruling**, not a decision.

## Found while the designer worked, 2026-08-23

- **Eleven MCP tools answered with metadata and nothing else** — `search_cards`
  returned a row count and no cards. Fixed, `DECISIONS.md` 2026-08-23. **Deck-E
  was never affected**; this is the MCP product surface. It changes a shipped
  public surface without the owner's sign-off, which he should be told plainly.
- **The escort never arrived.** It pointed at the set row and stopped. Fixed,
  with a `LOOK_BEAT_MS` hold so the press does not erase the pointing.
- **D8's pixel confirmation was withdrawn** — peak mid-flight tilt is 24.8° by
  design, so a single frame cannot tell a defect from the middle of an arc.
- **`DeckeChat.tsx` holds 124 bare CR characters** from the designer's
  `edit-send.mjs` (repo root, untracked). Harmless to the parser, ugly in a
  diff. Normalise the file once the designer is finished with it, and delete
  that script.

## Contracts that bite

- **X1** reduced motion ships with the motion, per-element `motion-safe:`, never
  a blanket `0.01ms`.
- **X2** every status row comes from a real invocation's real result.
- **B12** verification runs as the QA account (`.qa-account`), never the owner's.
- Tests: new file in an existing glob dir is auto-collected; CI already runs
  `deckpal-web test:decke` and `deckpal-api test:decke`.
- **Every test must be watched failing.** Two "verified" tests this session were
  vacuous — a guard that could not fire, and an assertion no mutation could
  break. Mutate, watch it go red, restore.
- Importing a `.tsx` under `node --import tsx` throws (`import.meta.env`), which
  is why pure logic lives in sibling `.ts` modules.

## The pattern worth remembering

Three things this session were **built and never wired**: `CardRows`,
`onRemoveCard`, and `resetDeckeEntitlement` — the last of which broke the
product for every signed-in user. And three times an instrument returned a
confident wrong answer that I repeated: a probe blind to rejected tool calls, a
probe fed a shell-mangled route, and a screenshot containing dev chrome.
**A wrong answer and a right one look identical coming out of a tool.**
