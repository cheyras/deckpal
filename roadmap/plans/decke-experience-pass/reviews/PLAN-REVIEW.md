# PLAN.md — adversarial review

**Reviewed:** `scratchpad/deck-e-pass/PLAN.md` **including the mid-review revision** (E8 replaced with the one-journey-plan design; E4 softened; three owner rulings settled; D3 made probe-first), against `OWNER-RULINGS.md`, `BRIEF.md` (rev 2), `BRIEF-AUDIT.md`, R1–R9, and the repo at `decke-experience-pass` (`34d3914`).
**Method:** every load-bearing `file:line` in the plan re-read in the repo — roughly forty anchors checked. Nearly all are exact (`DeckeHost.tsx:166-177`, the `centre:true` call sites, `solvePark`'s centre branch, `park.test.ts:119`, `deep.ts`'s swallowed stream, the chip filter-append at `useDeckeChat.ts:274`, `pickVariant`, `MAX_LEGS`, `LANDMARK_CAP=40` at `useDeckeChat.ts:768`, the `routes/`-only audit scan, gate 5's canonical-URL assertions, the 17 gates, the vite chunk pin, the composer `<form>` with no safe-area padding — all verified). The plan's research base is genuinely sound. Its failures are structural: one phase is mis-framed as rendering work when it is protocol work, two sequencing claims are inverted, one mechanism choice contradicts the brief the plan declares authoritative, and one shipped feature gets silently killed by item A1 and appears in no document at all.

The new E8 was reviewed as new, unreviewed design: all five of its repo citations verify exactly (`tools.ts:260`'s `z.array(commandSchema).min(1).max(6)`; `runCommands` at `commands.ts:182`; `data-decke-nav` at `AppShell.tsx:177`; `data-decke-series` at `SeriesIndex.tsx:100`; `data-decke-set` at `SeriesDetail.tsx:26`; and `travelAfterRoute`'s 6000ms MutationObserver at `uiTools.ts:299-341` is exactly as described). The architecture is right — but its central premise, *"navigation is deterministic once the destination is known,"* is **falsified in two concrete, verified places** (M-10, M-11), and the sequencer's integration with the turn loop is unspecified (M-12).

Severity counts: **1 BLOCKER, 12 MAJOR, 10 MINOR, 3 NIT.**

---

## BLOCKER

### F-1. Phase F is not "the visual half" — OR4's card cannot be built on the existing approval protocol, and the plan never designs the protocol it actually needs

**The claim challenged:** *"~80% built. What's missing is the visual half, and OR4 defines it."*

**The evidence.** The approval answer is a binary verdict replayed as **the whole, unmodified tool call plus its signature**:

- `useDeckeChat.ts:159-166` — `settle(approved)` maps **every** pending approvalId to the **same** boolean: `resolve?.(new Map(list.map((a) => [a.approvalId, approved])))`.
- `approval.ts:1-55` (header) — the answer "goes back by REPLAYING THE WHOLE TOOL CALL with the verdict attached," and dropping the `signature` once made **every approved write fail** (`validateApprovedToolApprovalsError` under `DECKE_APPROVAL_SECRET`, which is set in Production and Preview).

Now hold OR4's settled details against that:

1. **Inline picker per row** — the user picks a variant the model did not state. The write that must execute **differs from the signed call**. Modifying args client-side invalidates the signature by design; that discipline is the fix for a shipped-class bug.
2. **Per-row "that's wrong" removal** — same problem: the committed item list ≠ the signed item list.
3. **"Accept commits section 1 even if a printing in section 2 is unpicked"** — a **partial commit of one held tool call**, which the binary approve/deny cannot express at all.

The plan's only gesture at this is *"Reuse: `ripCommit.ts`'s resolve-then-one-atomic-batch with an idempotency key"* — which implies **bypassing the held call entirely** and committing from the client. But then the SDK-held `log_cards` call still exists and must be disposed of: approve it and you double-write; deny it and the model is told nothing was written while writes happened — a truthfulness violation of exactly the kind X2/X3 exist to forbid, and the model's next turn will say so to the user.

**Why this is the scariest item in the plan.** The plan itself records that this seam produced two shipped-class bugs with the identical reader-facing shape — *"Consent given, nothing happened."* It gives prompt-wording near this seam a whole cross-cutting constraint (X3), then describes rebuilding the seam's UI-to-execution contract as "the visual half."

**What I would do instead.** Before any Phase F code, write the commit-protocol decision as its own design note with the options costed:
- **(a)** Deny the held call with a structured reason, then commit the user-corrected batch client-side via the ripCommit path, and feed the real result back to the model as a tool-result/system part so its account stays truthful (X2). Cheapest; needs the "deny ≠ nothing happened" narration designed.
- **(b)** Server-side approve-with-modification: the server re-validates and re-signs an edited call. Cleanest semantics; a real API/protocol change, and it must be checked against what pinned `ai@7.0.66` can express at all.
- **(c)** Model round-trip ("row 3 is the holo") — honest but costs legs (`MAX_APPROVAL_REPLAYS = 2`) and latency, and re-prompts the user.

Whichever is chosen, the existing approval gate ("Add one card — preview, no row, approval, row, quantity, revert offered") must be updated in the same phase, and Phase F needs a verification section — it is currently **the only phase with none** (see MINOR-7).

---

## MAJOR

### M-1. The A-phase / B-phase dependency is stated backwards, and Phase A work gets invalidated by Phase B

**The claim challenged:** §10: *"A — independent… B — needs A4/A5's anchors."*

**The evidence.** A4's own text: *"size him from the composer card's measured rect. **Phase B makes the composer the anchor**."* A5: *"Derive it from the composer rect."* But today's desktop composer lives inside a **420px bottom-right floating panel** (`DeckeChat.tsx:436` — `bottom-[24px] right-[24px] … w-[420px]`), and B1 — per OR1 — replaces that with a content-pane takeover with the composer bottom-centred (C37). So A4/A5 anchored to the pre-B composer are anchored to a rect that B1 moves across the screen. The V3 stills at 1440/1920 and the V4 facing assertions run in Phase A are all invalidated the day B1 lands and must be re-run — and the facing *derivation* ("left of the composer", OR1) only means what the owner intends once the composer is where OR1 puts it.

The same applies to **A3's `theme.css:697-713` fix**: the keyframe's own comment says the panel "GROWS OUT OF THE BUTTON" toward a bottom-right origin — a design B1 replaces. Fixing its transform-origin in Phase A is polishing a panel Phase B deletes.

**What I would do instead.** Keep A1/A2/A6/A7 first — they really are independent. Build the *mechanism* for A4/A5 in Phase A (measure-composer-rect → height/facing, unit-tested on the option added to `FlyOptions`), but land and **verify** A4/A5/A3's entry-origin against B1's layout, i.e. pull B1 (the layout skeleton, not B2–B8) ahead of A4/A5's sign-off. Say so in §10 instead of the current inverted claim.

### M-2. The ordered-part-list refactor is assigned to two different phases, and the plan builds Phase C renderers it knows Phase E will rework

**The claim challenged:** §10 line 6: *"E — needs A5 **and C's message-model change**"* — while no Phase C item contains a message-model change, and E5 calls the ordered part list *"the real structural work of the phase"* (Phase E).

**The evidence.** The message model is `{id, role, text, tools?, screen?}` (`useDeckeChat.ts:103` ff.) — parallel fields, exactly as E5 says. C2 (chip order, first-seen ordering, inline rows) and C3 (thinking row that "expands to show step detail" and carries D's live status) are renderers over that model. If they are built on parallel arrays, E5's interleave-in-occurrence-order refactor rewrites them. Worse, **C2(a) and E5 contradict each other**: C2(a) restores "chips ABOVE his words" (the stale comment at `DeckeChat.tsx:514`), while E5 interleaves rows with prose **in occurrence order**. Once text streams between tool calls, you cannot have both; the C2(a) fix is throwaway.

**What I would do instead.** Make the ordered part list an explicit item **C0**, landed before C2/C3, with C2/C3 as its first consumers and E5 reduced to "add the client-emitted part types." Drop C2(a) as a separate fix — occurrence order subsumes it (and is the truthful order, which is X2's spirit). Then §10's line is true instead of aspirational.

### M-3. A3's preferred mechanism is the one the brief says "cannot work"

**The claim challenged:** A3: *"Prefer animating `stage.setCharacterHeight` 0→target… fall back to a rig-root screen-space scale."*

**The evidence.** The plan's own authority clause says the brief wins. Brief C3 (audited, `[AUDIT]`-corrected) says of exactly this: *"**That cannot work.** `setCharacterHeight` dollies the camera… Driving it toward zero pulls the camera to infinity, and every position solved in blender-space becomes wrong as it moves — which is exactly the bug the 'resize first, then solve' ordering at `DeckeHost.tsx:227-263` was written to prevent."* It then recommends option 3 — compose the existing 500ms opacity fade + the `boot` squash + a short `flyTo` — as *"the only option that adds no new mechanism."* The plan lists the poisoned option as preferred, the brief's option 1 (with its `CHANNEL_RANGE.sq`/`rig.squash` interaction warning) as fallback, and **omits the recommended option entirely**. The plan notices the perceptual half ("verify it reads as growing not zooming") but not the solved-position/infinity half, which is the half that breaks things.

**What I would do instead.** Make the brief's option 3 the preferred path. If the height animation is still attempted, it must be bounded well away from zero and every destination re-solved after it settles — and the plan must say why the brief's "cannot work" doesn't apply, since right now it contradicts its own authority ordering without acknowledging it.

### M-4. A1 silently kills the rip-watching feature, and this appears in no document

**The finding the task asked for: a real problem absent from the plan, the brief, the audit, and the research.**

**The evidence.** `ripPresence.ts:11-13`: *"**EVERY EXPORT HERE IS A NO-OP WHEN HE IS NOT LOADED.** …nothing in the rip path may depend on him being present, and nothing here may throw into it."* `Scan.tsx:14` imports `attendRip`/`reactToPull` and drives them during pack rips. Today, the idle timer (`DeckeHost.tsx:166-177`) means an entitled user on `/scan` has the runtime loaded by the time a rip starts, so Deck-E comes over and reacts to chase pulls. After A1, the runtime loads **only** on the chat chip's `onWarm`/`onOpen`. A user who goes to `/scan` and rips packs without ever touching the chat button gets **no attendance and no reactions — the feature disappears, silently, by the deliberate design of its own no-op guard**. A1's new gate (assert zero `models/decke/*` requests without interaction) would *enshrine* the regression as passing behaviour.

**What I would do instead.** Decide it, don't discover it: either warm the runtime when a rip session starts (or on `/scan` entry) for entitled users — a named exception recorded in the same DECISIONS entry as A1 — or put the accepted loss in front of the owner explicitly. "Load only when invited" arguably includes "invited by starting a pack rip"; that reading preserves both the restoration story and the feature.

### M-5. The deep-tool timeout still reads as success, and the plan fixed the silence but not the lie

**The claim challenged:** Phase D's framing that D1 (forward progress) addresses *"the liveness gap [that] hid a real failure from the person who built it."*

**The evidence.** The audit's D2 fork: the failed `Analyse the collection` chip showed **no error styling** in the frames, though the renderer has a real error style (`DeckeChat.tsx` chip: `t.phase === 'error' ? 'text-text-muted line-through'` — verified). Branch (b) — error never emitted — is strongly supported by `deep.ts`'s own budget path (verified: *"A deep tool that hits this returns what it has"*; an abort mid-stream *"is not an error here"*), which surfaces budget expiry as a normal result → `phase:'ok'`. The audit said plainly: **"under (b) no renderer change fixes it. One network capture settles it."** The plan forwards progress (D1) but never settles the fork and never makes budget-expiry visibly distinct. The owner will still praise a timed-out analysis; he'll just watch it stream first.

**What I would do instead.** Add to Phase D: (1) the settling network capture the audit named (gate 7 already hooks the wire); (2) a `partial`/timed-out terminal state on the chip/row, sourced from the deep runner's own `timedOut` flag — a real invocation fact, so X2-compliant by construction.

### M-6. V3 is claimed "built and proven" for surfaces it cannot currently photograph

**The claim challenged:** the V3 row of the instruments table, and every "Verify (V3…)" on a chat surface (A4, B2, B3, B5).

**The evidence.** `run-visual-smoke.mjs:13`: the harness *"runs entirely signed out"* — its proof run photographs the public landing page. Every chat surface in this plan is behind auth and behind the entitlement gate. The audit flagged this exact thing: *"the harness is signed-out by construction, and almost every mobile defect lives behind auth… That is a prerequisite, not a detail."* The plan dropped the prerequisite. The plumbing to fix it exists (`decke-gates.mjs`'s `withSignedInPage` + the QA account under B12), but combining it with the harness is unbuilt, unnamed work.

**What I would do instead.** Add a work item — a signed-in visual spec (QA account, B12) — as the first V3 task, before any V3 claim on a chat surface is allowed to count.

### M-7. X1's reduced-motion "genuinely different code path" has no owner, and Phase E's preamble denies the engine work its own items require

**The claim challenged:** X1: *"C32 under reduce = … arrive cut rather than flown. A genuinely different code path, not a disabled animation."* And Phase E's preamble: *"The flight engine, highlight ring and cross-route continuity are complete and correct (R3). **Nothing there changes.**"*

**The evidence.** The only reduced-motion awareness anywhere in the engine is a comment noting that native smooth scrolling respects it *"without this module having to know that exists"* (`DeckE.ts:1933`). There is no `prefersReducedMotion` read in `character/decke/` or `character/host/` (verified by grep; the helper exists only in `Sheet.tsx`). "Arrive cut rather than flown" and A3's reduce path ("appear at final size, no flight") both require a new engine capability — an instant-arrive mode on `flyTo`/entry — that **no phase allocates as work**. Meanwhile E6 (cancel journey on user input) is also engine work. So the preamble's "nothing there changes" is contradicted twice by the plan's own items, and X1 is a promise with no design behind it — exactly what the review question suspected.

**What I would do instead.** An explicit engine item: the host reads the media query and passes a `reduced` flag (or `{instant:true}`) into `DeckE`, honoured by entry, flight, and escort legs — keeping the engine media-query-ignorant, consistent with its stated philosophy. Correct the Phase E preamble to name E6 and the reduce path as the two engine changes.

### M-8. The mobile panel's geometry under the new sharp header is entirely unspecified, and C56 — the complaint that says it is fragile — appears nowhere in the plan

**The claim challenged:** B2's *"the scrim starts below the app header"* as a complete statement of the mobile change.

**The evidence.** The mobile panel is `inset-0` at `z-[25]`, above `--z-chrome: 20` (verified, `DeckeChat.tsx:436-441`). B2 moves the **scrim**; nothing in the plan decides: (a) the **panel's** own top edge — left at `inset-0`, the "Deck-E" header row and ✕ paint on top of the now-sharp app header; (b) whether the chat keeps its own header at all once the app header is visible above it (C47 is about that ✕ row); (c) what a tap on the now-live app header does mid-chat — the hamburger opens the nav drawer (`z-overlay`) over the conversation, and a nav tap navigates mid-turn. And **C56** — *"have Deck-E down here"*, which the brief marks *"major as a regression risk"* precisely because the park landmark lives inside the panel whose top edge this change moves (`DeckeChat.tsx:576`, `PARK_BOTTOM`) — is never cited in the plan. An implementer will invent all four decisions.

**What I would do instead.** In B2/B3: panel top offset = the scrim's (`calc(64px + env(safe-area-inset-top))`); an explicit decision on the chat header row's fate; a stated header-tap policy (at minimum: nav closes or minimises the chat deliberately, not incidentally); and C56's "his mobile position is unchanged" as a named B-phase verification assertion.

### M-9. Q13 — "should the page behind scroll?" — was never ruled, and the plan silently closes it

**The claim challenged:** B6's *"The body-lock itself is correct iOS technique"*, presented as settled.

**The evidence.** Brief Q13 (line 2893) is *"On mobile with the chat open, should the page behind be scrollable?"* — the audit's warning was *"'probably' is doing work in a blocker."* `OWNER-RULINGS.md` has no ruling on it: OR4's header says "(resolves C43 / Q13)" but its **content resolves only the approval-card question (C43)**; nothing in it touches scrolling. The cross-reference is wrong, and the effect is that an unresolved owner question now *looks* resolved. The plan's §13 "Still open for him" does not carry it. OR1 makes it sharper, not moot: with the header sharp and present, "I expected the page behind to scroll" becomes a more plausible reading of C46, not less.

**What I would do instead.** Fix OR4's header reference, and either add Q13 to §13 or get the one-sentence ruling. B6's fixes (stick-to-bottom guard, pointer-events) are correct under *either* answer, so the work isn't blocked — but the plan must not present the lock as ruled-on when it wasn't.

### M-10. E8's determinism premise fails on state-dependent disclosures — and the QA account hits the failure on the first page of the canonical journey

**The claim challenged:** *"Navigation is deterministic once the destination is known, so per-hop reasoning buys nothing."*

**The evidence.** On `/series`, uncollected series render **only after** a disclosure click: `SeriesIndex.tsx:368-374` — `showOthers ? (list) : (button)`, with `setShowOthers(true)` on the button marked `data-decke-show-others` / `data-decke-clickable`. The code's own comment (`:390-396`): *"For a collector who owns nothing — every new account, **and the QA account the gates run as** — every series on /series is behind this button."* So `[data-decke-series="X"]` **does not exist in the DOM at plan time or on arrival** for most series, and whether the disclosure step is needed depends on client state the plan-maker cannot see (and the state is one-shot, not idempotent to probe: once revealed, the button itself is gone, so a plan that includes the disclosure click *fails its wait* on a page where someone already revealed it). Under the current per-hop design this is a non-problem — landmarks are collected **fresh per leg** (`useDeckeChat.ts:521-560`), so the model sees the actual page before choosing the next hop. A one-shot plan sees nothing. Fail-stop "handles" it by re-entering the model — which on the gates' own QA account makes the failure path the **common** path on the journey's first page, re-buying the per-hop round trips E8 exists to delete.

**What I would do instead.** Give the journey vocabulary a conditional step semantic — `ensure: {selector, via: clickSelector}`: if the target already matches, skip; if not, click the disclosure and wait. That one verb covers reveals, accordions, and tabs, keeps plans deterministic *in structure* while tolerant of state, and keeps fail-stop for what it should be: the exceptional path. Then write the E-phase gates to run both branches (revealed and unrevealed) — the QA account makes the unrevealed branch free to test.

### M-11. E8's addressing scheme has a floor the plan does not state: cards are unaddressable, because the grids are virtualized

**The claim challenged:** *"the entire path is constructible without having seen any of those pages"* — implicitly, to any destination.

**The evidence.** The addressing scheme covers nav → series → set (`data-decke-nav`, `data-decke-series`, `data-decke-set` — all verified). It stops there. On `SetDetail.tsx` only the **grid container** is landmarked (`data-decke-card-grid`, `:130-131`); individual card tiles carry no per-tile selector — and they cannot simply be given one, because `GridView.tsx` windows the grid with `@tanstack/react-virtual` (`useVirtualizer`, `overscan: 3`), and the same GridView backs `SearchResults`, `ListDetail`, and `SpeciesDetail`. An off-screen tile **is not in the DOM**, so a wait-for-selector for it never fires no matter how long the bound — the wait mechanism reports "we are on the page, but I could not find that part of it" for a card that is right there, two screenfuls down. A journey ending "…and here is the card" — the natural last hop of "help me find X" — is therefore not buildable from what E8 specifies.

**What I would do instead.** State the floor explicitly in E8: journeys terminate at the set row / grid container in this pass, with the model's existing `highlight`+prose covering the card level — **or** scope the real work (per-tile selectors, a scroll-to-index step that drives the virtualizer, and a wait that understands windowing) as its own item. Either is fine; silence is not, because an implementer will discover the virtualizer mid-phase.

### M-12. The sequencer's integration with the turn loop, the abort path, and the command queue is unspecified

**The claim challenged:** the "What it requires" list, offered as complete ("Is that enough?" — no).

**The evidence, four gaps an implementer must otherwise invent:**
1. **Abort wiring.** `send()` aborts the previous turn's `AbortController` before starting a new one (`useDeckeChat.ts:188`), and `stop()` aborts it too. A journey mid-execution belongs to the aborted turn — nothing in E8 says the sequencer observes that signal. Without it, the user sends a new message and the character keeps flying the *old* journey while the new turn answers, or worse, both drive him at once. E6 covers user *gestures*; this is a different cancel source and needs the same treatment: the executor takes the turn's signal.
2. **What the tool returns.** Fail-stop "hands back to the model for a fresh turn" — so the journey tool's result must carry per-step outcomes (done / failed-at-step-N-because) in a schema the model can re-plan from. Unstated; and it is also what the action rows render from, so it is the X2 contract for the whole phase.
3. **The command queue.** `runCommands` serialises turns through a per-character promise queue (`commands.ts:178-190`, `TURNS` WeakMap) precisely so batches do not interleave. Does a journey ride that queue or bypass it? If it bypasses, an `express` batch from the same turn interleaves with flight beats; if it rides it, a queued journey behind a stuck batch delays past its own waits' assumptions. Decide, and say so.
4. **A held write landing mid-journey.** The SDK runs parallel tool calls in one step; a model can emit `journey` and a write in the same step, so the approval dialog can appear while the character is mid-choreography. Probably fine (the hold is real; the journey contains no writes) — but the plan should say the two do not deadlock and which one the UI foregrounds.

**What I would do instead.** Add these four to E8's requirements list, each one sentence. None is hard; all are invisible until hit.

---

## MINOR

### m-0a. E4's text now contradicts E8, and §10 still orders a measurement that no longer exists
E4 (lines 553-556) still says *"Needs a sitemap encoding the click path between pages"* while E8 says the addressing scheme *"is better than the 'sitemap' E4 originally proposed."* One of them is the plan. And §10 line 6 still says **"Measure E8 first"** — the measure-first task was deleted with the old E8; the sequencing list was not updated. Rewrite E4 as: the addressing convention (the three `data-decke-*` patterns and how to build them from ids the data tools return) + the `NAV` structure (`AppShell.tsx:90-97`) + **the state-dependence facts from M-10/M-11** (what is behind a disclosure; where the addressable floor is). Without that third element the softened E4 is under-specified into exactly the trap M-10 describes. Keep the landmark priority tier — that part is a repair and survives.

### m-0b. The reduce path's "skip the flight beats" needs a dwell rule, and still needs the engine capability M-7 names
Selector-based waits mean the *timing* survives cutting flights — that part of the design is sound. Two residues: a `speak` beat whose display time was implicitly the flight duration now needs an explicit reading-time dwell, or the bubble flashes; and "arrive cut rather than flown" still requires the character to *be placed* at the target without a tween — an instant-arrive the engine does not have (M-7 stands; the sequencer just gives that work a natural home).

### m-1. A5 reintroduces a claim its own audit corrected
The plan: *"`flyTo` then re-asserts the boot default `facing = 1` = screen-left."* The audit (finding 5) corrected exactly this: the code is `this.setFacing(park.facing ?? this.facingTarget)` (`DeckE.ts:1158`, verified) — it re-asserts **his current heading**, so the bug is *"facing is never decided for the chat"* and the symptom is **path-dependent and intermittent**. The fix (a `facing` field on `FlyOptions`, honoured for centre parks) is unaffected, but a verifier expecting deterministic screen-left will misread a passing run. Restore the audited wording.

### m-2. E7's mechanism claim is wrong
*"The one brevity rule (`prompt.ts:543-544`) is conditioned on `travelling`"* — no `travelling` conditioning exists anywhere in `prompt.ts` (verified by grep). The rule is static prose — *"When you move, keep what you say SHORT"* — and applies to `goTo` as much as `flyTo`, so E1 routing more traffic through jumps changes nothing about which rule applies. "Verify after E1–E3" remains the right call, but for the honest reason: C33 may need its own fix regardless.

### m-3. A6 aims a frame-reading instrument at the one target where frame-reading has already failed twice
The audit shows rev 1's pupil description was contradicted by the stills (finding 6) and D14's rim-clipping *"is read off a re-encoded 4K still of a WebGL render"* and may be a codec artifact — the audit's named settling tool is `/dev/decke?parity=1` on a live canvas. The plan says *"Also fix D14"* (asserting a defect not yet confirmed real) and verifies gaze via V4 contact sheets. Better: confirm D14 live first; assert the gaze *angle* numerically at unit level (the offset → angle derivation is pure math, `look.ts:165-178`); use V4 only for the coarse "up and away" read it can settle in two seconds.

### m-4. X4 understates how weak the audit test is
Beyond scanning `routes/` only, the scan is **non-recursive** (`readdirSync` — `routes/deck/`, `routes/dev/`, `routes/landing/` already escape it today) and the regex matches only the attribute **alone on its own line** (`/^\s*data-decke-clickable\s*$/`) — an inline marking escapes the audit even inside a scanned file. The widening commit must fix all three (root, recursion, format), or E3's markings can still dodge the discipline the plan correctly says must come first.

### m-5. No complaint-coverage map, and spot-checks find real droppage
The brief declares **42 actionable** complaints. The plan has no appendix mapping each to a phase item or an explicit deferral. Spot-checks found: **C56** absent (see M-8), **C60** absent — the audit ranked it *"major, as a cross-cutting acceptance criterion"* (*"every chip, pill, row, badge and meter introduced by this work must answer 'am I pressable?' at rest"* — and its inverse; plus the explicit warning **not** to fix it with `user-select: none`), and **C6**'s empty-vs-active composer states unaddressed (B1 says only "centred", which also leaves "centred" ambiguous against C37's "bottom centre" — say bottom-centre). C60 belongs as a named acceptance criterion beside C6-accessibility in Phase C. Add the coverage table; it is an hour's work and it is how the next droppage gets caught.

### m-6. C6-accessibility has no instrument
The plan says every new control ships role/label/focus "not a follow-up" — but none of V1–V5 can see any of it. As written, D13 is the one item whose verification story is genuinely nothing. Add a keyboard-walk/axe pass to the Phase C verification (the gates already drive a real browser; tabbing through the chat and asserting focus order is gate-shaped work).

### m-7. Phase F has no verification section
Every other phase names its instruments; F names none. The existing approval gate pins the current dialog flow and will need updating for the segmented card; the picker, per-row removal, partial commit, and the `variantSource` field each need V1/V2 coverage. (Folded into the BLOCKER's remedy, but it stands alone too: even if the protocol were trivial, F as written ships unverified.)

### m-8. E5's last-leg rows are not wire-visible
Client tool results reach the wire as parts of the *next* leg's POST — which is how gate 7-style checks can cover them — but a movement on the **final** leg has no follow-up POST. "Gate 7 extends to cover them" (X2) therefore needs a DOM-side assertion for the last leg, or the gate quietly proves less than claimed.

---

## NIT

### n-1. OR4's header cross-reference
"(resolves C43 / Q13)" — Q13 is the scroll question. Presumably a slip for the confidence-question number. Fix it in the rulings doc; it is the root of M-9's silent closure.

### n-2. "Fable reviews this plan before any code, and reviews the code at the end"
Fine — but the F-protocol decision (BLOCKER) and the D3 probe result both produce owner-facing forks mid-pass. Name the checkpoint at which those answers re-enter the plan, or they will arrive as surprises inside a phase.

### n-3. The journey cap has no number
E8 says "capped, the way `express` caps commands" — `express` says `.max(6)`. Say the journey's number (and whether waits count against it), or the cap will be invented at the schema keyboard.

---

## What is GOOD, and must not change in response to the above

- **The verification doctrine and the V4 usage rule.** "A fail is a reason to look, not a fact," claims must be falsifiable, `unclear` is a real answer — this is the correct epistemic posture and V4 is *not* theatre under it. Its assigned claims (absent→grows→travels; more blurred and darker while the top bar stays sharp; facing toward the input) are all two-second human calls. Keep it exactly as scoped — and keep refusing to let it judge "a really great experience."
- **V5's non-delegability, correctly reasoned.** The CDP safe-area override covers geometry; compositing under a translucent status bar stays on the phone. The two named V5 items are right. (Add one: the iOS keyboard-open state against the new composer card — `visualViewport` behaviour in a standalone PWA is another thing Blink emulation does not settle, and B3/B5's bottom spacing lives or dies there.)
- **X4-first sequencing.** Widening the audit before marking anything is exactly right (just widen it properly — m-4).
- **A1's design and its landmine.** The restoration framing is verified true (`DeckeHost.tsx:433-436` and `vite.config.ts` both check out), the byte total is right, the network-evidence gate is the correct instrument, and the `Decke-runtime` chunk-name landmine is real and well-stated. Fix M-4 alongside it; do not soften A1 itself.
- **A5's "do not touch `solvePark`" guard.** `park.test.ts:119` pins it exactly as claimed; the call-site fix via `FlyOptions.facing` is the right shape.
- **E1 split-don't-delete.** Gate 5's actual assertions (goTo on the wire, canonical `/series/<slug>/<id>` URL) survive the split untouched — verified against the gate's source. Superseding-entry discipline is right.
- **E8's one-journey-plan architecture itself.** Do not retreat from it in response to M-10..M-12. It genuinely dissolves the leg-budget problem (`MAX_LEGS = 4` verified; per-hop turns re-bill ~600 tokens of landmarks at ~1.1s TTFT each); its precedent is real (`express`'s validated client-executed batch, the `TURNS` queue); its wait design (conditional, bounded, reusing `travelAfterRoute`) is the right one and that function's honest-partial failure message is exactly the reporting posture the journey needs; fail-stop + re-enter-the-model-on-failure is the correct hybrid. M-10..M-12 are missing *step semantics and wiring*, not flaws in the shape. Fix them inside this design.
- **D3's probe-first posture, endorsed as-is.** The `fullStream`/`'source'`-parts hypothesis is the cheap experiment, `deep.ts:172`'s `textStream`-only loop is the verified discard point, and the provider question is already queued for the owner (spec §14.1) if the probe comes back empty. This is not deferring a decision that should be made now — it is refusing to ask the owner to rule on a fact nobody has looked at. Same for D4 (not reverting the model mid-pass).
- **X2/X3 as constraints, and OR4's provenance-not-confidence design itself.** The design is right and `pickVariant` really does already distinguish the three cases; only the commit protocol (BLOCKER) is missing. The "new field, not new status semantics" hard constraint is exactly correct — keep it.
- **D1's root cause.** The swallowed `textStream` loop is verified verbatim; forwarding it is right; keeping sub-agent prose out of his voice is right.
- **D5, B7, A6's playbook landmine.** `navigate({ to })` with no replace — verified. The z-30-over-chrome conflict with C29 — verified, and the keep-out is the right single mechanism. The generator really is broken (`playbook.ts:6-9`) and hand-edit-plus-record is the honest move.
- **The scope fences (§12) and Phase G as a menu.** Every one of them is correctly fenced, including the refusal to re-litigate the chat model in the same pass as navigation work.

---

## What I would cut

1. **E4 as a separate item.** E8's addressing scheme has superseded the sitemap — the plan already says so, but E4's own text still demands one (m-0a). Fold what remains of E4 into E8's prompt-side work: the addressing convention, the `NAV` structure, and the state-dependence facts. Keep the landmark priority tier — that is a repair and stands alone.
2. **C2(a) as a standalone fix.** Subsumed by the ordered part list (M-2); restoring "chips above words" only to interleave them later is motion without progress.
3. **A3's `theme.css` transform-origin fix as Phase A work.** Fold it into B1, whose layout decides what the panel's entry even looks like (M-1).
4. **C5's "expand-in" polish.** The compact/summary mode and the preview-vs-result distinction are the substance; the entrance animation is the cuttable third of that item in a pass already carrying more motion than any before it, each needing a reduce path in the same commit.

## What must not change

The five-instrument doctrine and its honesty rules; X2 and X3 verbatim; X4-first; A1's deletion-plus-gate (with M-4 resolved alongside, not instead); the `solvePark` guard; gate 5's survival through E1's split; **E8's one-plan architecture, its conditional-wait choice, and its fail-stop/re-enter hybrid** — repair M-10..M-12 inside that design, do not fall back to per-hop turns; D3's probe-first posture; OR4's provenance design (the card's *shape* — only the commit protocol beneath it is missing); the three newly settled rulings (persistence out, add-photo deferred, leg-budget dissolved) — none should be reopened; the §12 scope fences; the DECISIONS discipline in §11. These are the plan's spine, and every one of them checked out against the repo.

One addition §11 now needs: the journey tool itself is a decision — "wayfinding is one client-executed plan, model re-entered only on failure" — and it should get a DECISIONS entry alongside the other eleven, because it supersedes the per-hop assumption that `MAX_LEGS` was designed around.

---

## Verdict

**Green-light with changes.** The research substrate is verified and strong — including the late E8 revision, whose citations all held — and most items are correctly scoped repairs. But: the F-phase protocol gap (BLOCKER) must be designed before Phase F is scheduled; the A↔B sequencing inversion, the C/E message-model placement, and A3's mechanism choice (M-1..M-3) must be corrected before any code, or the pass strands its own early work; E8 needs its step semantics finished before the journey tool's schema is written (M-10..M-12 — the `ensure` verb, the addressability floor, the abort/queue wiring), or the QA-account gates will fail on the first page of the first escorted journey; and M-4 (rip presence) and M-9 (Q13) each need one deliberate decision — cheap now, expensive as surprises.
