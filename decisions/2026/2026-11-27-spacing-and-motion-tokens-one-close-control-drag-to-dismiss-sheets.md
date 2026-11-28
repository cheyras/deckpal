---
date: "2026-11-27"
title: "Spacing and motion tokens, one close control, drag-to-dismiss sheets"
decided_by: "Chey (via Claude Opus 5.5)"
areas: ["frontend"]
supersedes: []
---
## 2026-11-27 — Spacing and motion tokens, one close control, drag-to-dismiss sheets
**Decided by:** Chey (via Claude Opus 5.5)

**Decision:** The design system gains the two foundations it never had, and the overlay chrome is rebuilt on them.

- **Spacing.** `--spacing: 4px` in theme.css's `@theme`, so Tailwind's numeric utilities are the scale (`p-4` = 16px). A fixed list of sanctioned steps (px, 0.5–3.5 in half steps, then 4, 5, 6, 7, 8, 10, 12, 14, 16, 20) is written beside it, mirrored in `lib/spacing.ts` and `apps/web/scripts/spacing-audit.mjs`, and held together by `lib/__tests__/spacing.test.ts`. Three roles are theme keys and so utilities: `--spacing-gutter` (16), `--spacing-hit` (44, `size-hit`), `--spacing-corner` (8, `top-corner right-corner`).
- **Motion.** `--duration-instant|fast|base|slow|slower` (120/160/220/300/420ms) and `--ease-standard|enter|exit|sheet|spring`, mirrored for JavaScript in `lib/motion.ts` and pinned by `lib/__tests__/motion.test.ts`. Rules: arrivals decelerate, departures accelerate, exits are shorter than entrances, overlays travel on `ease-sheet`, and reduced motion removes travel but keeps fades.
- **One close control.** `components/ui/CloseButton.tsx`: a bare ✕ with no disc, `text-secondary` at rest, a 44px box pinned `--spacing-corner` from the top and the side. Sheet's header, the card sheet and Deck-E's chat use it.
- **One close control for the phone drawer**: the header's Menu button, which now morphs into the ✕. The drawer's own "Close navigation" button is gone visually; it stays in the dialog as a visually hidden, non-tabbable button so a screen reader inside the modal still has a labelled dismiss (A11Y-05). The drawer's Tab loop includes the header button.
- **Drag to dismiss.** On phones the whole sheet bar is a drag handle (pointer events, `touch-action: none`, pointer capture), and a pull down on the body at scroll-top drags the sheet too (non-passive `touchmove`, decided on the first move). The panel follows 1:1 on `transform` only; let go, it is thrown off at the release speed or springs back carrying the release velocity (a `linear()` spring easing, cubic fallback). The decision uses the UIScrollView projection (0.998) with a flick floor. Physics in `components/ui/sheetDrag.ts`, unit-tested.
- **Scroll edge.** Content scrolling under a bar fades (a mask on the scroller) and blurs (a backdrop-filter strip over the edge), ramping with scroll distance. `lib/useScrollEdge.ts` drives it; sticky content marked `data-scroll-edge-pin` is kept whole. Every Sheet has it, the app header has a strip under it, and /design's tab row uses the horizontal form.
- **FAB clearance.** While Deck-E's launcher is mounted, `html[data-fab]` gives `.app-content` `--fab-clearance` of bottom padding.

**Why:** The owner's 2026-11-27 review on an iPhone: "wonky spacing issues here and there… define that into the design system", "incorporate animation into the design system… really think through the… timing", the drawer "just snaps open", two X's on the open drawer, the card sheet's X "way too close to the edge… closer to the top than it is to the side" and "make the X's just the icon… across the whole app", the grabber "really glitchy… very choppy" (it had no gesture at all — the browser took the touch as a scroll), a hard shadow cut under the sheet header ("more iOS like where it… fades out… and kind of blurs… a pattern change everywhere"), and the assistant button covering the last row of lists. A token for every value already existed except spacing and motion, which is why those two kept drifting.

**Implications:**
- The spacing migration is NOT done. `components/ui/`, the app shell and /design are on the scale; about 2,250 bracketed spacing utilities remain elsewhere (≈1,960 on-scale and mechanical, ≈290 off-scale). /design → Pending carries the count and the plan; recount with `node apps/web/scripts/spacing-audit.mjs --files`. Migrate one file at a time, by its owner, never by a repo-wide codemod.
- New code writes the step (`px-4`), never a bracket (`px-[16px]`), and takes durations and curves from the motion tokens rather than writing `220ms cubic-bezier(…)` inline.
- Any new sheet header must carry `data-sheet-handle` (use `SheetBar`) or it will not drag. A sheet that refuses `onClose` after being thrown springs back up.
- The critical-path budget (`apps/web/scripts/check-critical-path.mjs`) stays at 230 kB gzipped. The drag physics, the scroll-edge hook and the close control add about 2.5 kB to Sheet, which was on the critical path only because the header's bug reporter imported it through `ListModals`. The bug reporter now loads lazily (`components/BugButtonLazy.tsx`), which takes the whole Modal/Sheet stack off the first paint: 220.8 kB after this change, measured by the build's own check.
- The page dims behind the drawer by fading `main` (as before), now as a transition; a scrim was rejected because it would have to beat every z-index the routed pages use inside `main`.
- The drag was verified with CDP touch input in headless Chromium (1:1 tracking, spring back, throw, body pull at top, no sheet movement when the body is scrolled) but not on a physical iPhone; `tools/ios-sim` is the next check.
