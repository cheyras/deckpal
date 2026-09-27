---
date: "2026-08-24"
title: "The animation pass: presence gets one authority, and every exit exists"
decided_by: "Claude, executing the owner's 2026-08-23 recorded review (62"
areas: ["security"]
supersedes: []
---
## 2026-08-24 — The animation pass: presence gets one authority, and every exit exists
**Decided by:** Claude, executing the owner's 2026-08-23 recorded review (62
frame annotations + narration; recon brief in the capture directory), which
opened with "the animation is so bad that it would be better if the whole
feature just didn't exist at all."

**Decision:** The 2026-08-20 entry deferred "WHAT IS ON SCREEN has three
authorities that can disagree" as "the right next change." This is that change,
plus the exits nothing ever had:

1. **Presence has one authority.** `DeckeHost`'s single choreography effect
   (deps `[chatOpen, live, wide, travelling]`) replayed the FULL entrance on
   any dependency flip — the measured uncommanded "hiccup" (land-centre → cut →
   regrow at launcher), and the close-path double-launch. Replaced by a
   presence machine (`presenceRef`, edge-triggered on `[chatOpen, live]`) plus
   a separate re-park effect (`wide`/`travelling` changes measure + park, never
   re-enter).
2. **Tool navigation is exempt from the route-watcher tidy-up** via a
   consume-once expected-pathname token set in the navigate callback
   (`toolNavRef`). Bare `goTo` — confirmed from the recording's own tool chips
   as the trigger of every route-change churn — no longer stomps `travelling`
   mid-hop. A person's own navigation still tidies, which is the case the
   watcher was written for. The ring is still cleared on every route change.
3. **Exits exist, everywhere.** Engine: `flyTo({scaleTo})` drives the entrance
   scale from the flight's OWN progress (eased into the destination), so
   "gone" and "landed" are the same frame by construction — the close is now a
   dive into the launcher chip. Panel: a real animate-out (`data-closing`,
   `decke-chat-out`, falling-edge watcher — closes from `seeYouOut` too, not
   just clicks). Bubble: read-time auto-dismiss with an animate-away. Entry
   tween gained a direction (`playEntry({to})`).
4. **The dolly re-solves the station.** `DeckE.setCharacterHeight` (public)
   wraps `Stage.setCharacterHeight` + unpin + `stationDirty` — the "measure,
   THEN move" invariant call sites hand-ordered is the engine's own now. The
   host additionally HOLDS measure during the exit (`holdMeasureRef`), because
   the close flips the keep-out band and the ResizeObserver re-dollied
   mid-dive — the measured 260 → 452 px balloon.
5. **Presenting rests small.** `uiTools` destinations (`flyTo`,
   `travelAfterRoute`) park at `depth: 'background'` — the owner's own
   BACKGROUND_SCALE system, which had only ever been a mid-flight waypoint.
   The engine already kept park/keep-out/screenRect/beacon consistent at that
   depth; only the call sites were hard-coded 'foreground'.
6. **A presentation ends itself.** Bubble read-timer (2.6 s + 45 ms/char,
   clamped 4–10 s) → bubble animates away → `seeYouOut` → dive → farewell.
   The farewell line is picked at close (the no-repeat rule needs the click)
   but SHOWN at arrival, anchored to the launcher chip's rect; no chip, no
   line (the old null fallback was the top-left corner). The turn-boundary
   arrival-close now yields to a live presentation (flying/highlighting) so it
   cannot cut the bubble off unread.
7. **Aborted flights report themselves.** `onArrive` fires with
   `aborted: true` when a flight is replaced (`flyTo`/`returnHome`), instead
   of being silently overwritten — the mechanism that used to eat `tuck()`.
8. **Concurrent entrance.** Grow starts frame zero with the panel's own
   entrance; the hop launches when his MARK's rect actually settles (a 90 ms
   poll with an on-screen requirement, floor 240 ms, cap 2.4 s) and overlaps
   the grow's tail. Not a fixed wait: probed on a cold mobile load, the glb
   parse stalls the sheet's entrance mid-translate, so a timer fires while
   the park box reads at y≈1044 of a 664 px viewport — stable AND wrong —
   and he flew off the bottom of the screen. `park()` additionally refuses
   any landmark that is not inside the viewport and takes the fraction
   fallback (the composer watch re-parks him once the real mark settles).
   Measured before the pass: 1.30 s tap-to-landed with 0.43 s dead air and a
   0.27 s static scale-up. The README's sequential recipe was updated with
   it — it documented the old design, and an agent reading it would have
   "fixed" the concurrency back out.
8b. **The lean law is budgeted across layers (D8 closed).** Apparent tilt =
   root rotation (`LEAD_*`) PLUS the `bend`/`lean` curl morphs (18°/15°
   full-scale). The old numbers (LEAD_MAX 34, curve clamp 0.72) stacked to
   ~46-58 apparent degrees on long legs — the judge read a frame as "nearly
   upside-down as it falls". Now LEAD_MAX 12, curve clamp 0.35: a worst-phase
   stack under ~20°. `hopProfile.test.ts`'s "D8 is still open" measurement is
   inverted into a gate (4° < peak ≤ 18°), per its own instructions.
9. **Placement.** Mobile chat park gained `facing: -1` (the desktop fix from
   2026-08-23 never reached the mobile call site three lines above it). The
   phone park box now stands him just ABOVE the composer, measured live from
   the composer's top. Docked travelling bar restyled to the composer's tokens
   (was `surface-raised`/`text-muted`, measured 1.3–1.4:1 contrast). Bubble
   placement now scores against HIS silhouette as well as the highlight, is
   height-capped at 38vh, and animates in/out. Minimising no longer remounts
   the panel (single element tree, CSS-driven), so no more `sheet-scrim-in`
   replay.
9b. **Two invisibility bugs, caught by screenshotting the frame the DOM said
   the words were on screen.** (1) The bubble/farewell pop-in latched a
   "played once" ref before scheduling its rAF; StrictMode's dev
   mount-cleanup-mount cancelled the rAF and the latched ref skipped the
   reschedule, so `entered` never flipped and both rendered at opacity 0 for
   their whole lives — in dev, which is what the owner runs. "Once per
   mount" is the `key`'s job; the refs are gone. (2) A `fixed` element's
   auto width shrink-wraps against the viewport edge BEFORE its transform,
   so the corner-anchored farewell collapsed to a one-word column, then
   clipped. `w-max` plus right-edge anchoring (the chip lives in a corner;
   the label's right edge sits on the chip's) fixed it; the bubble got
   `w-max` for the same hazard.
10. **Prompt policy** (`apps/api/src/decke/prompt.ts`): presenting = small in
    the background until dismissed; any turn that moved him ends in 1–2 short
    lines (the bubble renders the ordinary reply, not just journey `say`);
    after `goTo` the chat closes itself at turn end; "show me" for
    escort-unreachable destinations means a hand-authored `journey`, never a
    bare `goTo` to an index.

**Why:** Four root causes (overloaded `travelling` + effect dependency; camera
dolly with no station re-solve; no exit animation on any surface; background
depth with no resting state) accounted for essentially every annotated frame.
Each was fixed at its mechanism, not its symptom, per the recon's warning that
fixing the six `travelling` symptoms individually would produce a seventh.

**Implications:**
- **A deliberate conflict with 2026-08-23's "placement beside the composer":**
  that entry chose overlap ("that overlap is the point"); the owner's
  recording, made the same evening, asks for "just above the input" four
  times. The recording is the newer signal and was implemented. If the raised
  box reads wrong, the knob is the park box's offset in `DeckeChat.tsx`.
- `arrived` callbacks now receive `(aborted: boolean)`; ring/`then` are
  skipped on aborts. Callers must not do arrival work on `aborted === true`.
- `entryScaleAt(u, from, to)` gained a third parameter (default 1 — every
  existing caller unchanged).
- The visual harness gained a `chat-exit` scene whose `assert` pins the dive
  ("never disappears abruptly at full size… never grows during the trip").
  When judging video scenes, pass `--frames` matching the scene's own value —
  the judge's 9-frame default undersamples the ~325 ms grow and produces
  false FAILs (verified live).
- New unit pins: `exit.test.ts` (scaleTo ride, abort honesty, reversed entry
  tween); bubble non-overlap-with-him cases; a farewell render test.
- The gray-void question from the recon (§8.1, chat-close racing destination
  paint) is MITIGATED by the animated close + him staying visible, not
  root-caused. If it reappears, it needs a runtime trace of the destination
  route's loading UI.

