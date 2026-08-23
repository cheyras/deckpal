# Deck-E experience pass — EXECUTION HANDOFF

**Read this first. It is the map.** Everything needed to execute is in this
directory; nothing important lives only in a conversation.

Origin: a 26-minute narrated screen recording in which the owner walked through
Deck-E's UX on desktop and a real iPhone PWA and said what was wrong with it.
Every requirement here traces to a timestamp in that recording and a `file:line`
in this repo.

---

## 0. Where you are

- **Repo:** `E:/Users/cheyr/deckpal`
- **Branch:** `decke-experience-pass`, cut from `209150f`
- **Status: EXECUTED.** This file is the map that was followed; it is no longer
  the current state. **`COVERAGE.md` Part II is** — an audit that read every one
  of the sixty complaints against the code that now exists rather than against
  the plan, with a status and a `file:line` for each, and a ranked list of what
  is still missing. Read that before trusting anything below about what is done.
- **Commits:** `34d3914` (the visual-verification harness) through the Phase A–H
  work on this branch.
- **Baseline, verified green before any change:**
  typecheck exit 0 · **489/489 tests** across 8 suites · 4 serverless functions load

**The working tree must stay clean of accidental changes.** Check `git status`
before and after any delegated work; two agents have already had to back out
edits that reversed documented decisions.

---

## 1. The documents, in authority order

| File | What it is |
|---|---|
| `OWNER-RULINGS.md` | **Authoritative.** Six decisions taken directly from the owner. Override everything else. |
| `PLAN.md` | The implementation plan (~1000 lines). Phases A–H, cross-cutting constraints X1–X5, experience targets §0. |
| `DESIGN-approval-protocol.md` | The Phase F commit protocol. Phase F does not start without it, **and not without its review's six corrections.** |
| `reviews/DESIGN-REVIEW-approval.md` | Adversarial review of that design. **Verdict: implement with changes** — 1 blocker, 5 major. All six corrections are folded into `PLAN.md`'s Phase F banner; read them before writing Phase F code. |
| `COVERAGE.md` | Every C1–C60 and D1–D16 mapped to a plan item, with status. 48 covered · 9 partial · 4 dropped · 2 deferred · 13 context. |
| `BRIEF.md` | 2,944 lines. 60 complaints (C1–C60), 16 defects (D1–D16), 13 conflicts. Every item traced to a timestamp and a `file:line`. **This is the requirement document.** |
| `BRIEF-AUDIT.md` | 25 corrections to the brief; 11 claims found wrong or overstated. |
| `PLAN-REVIEW.md` | Adversarial review #1 (Fable). 1 blocker, 12 major, 10 minor, 3 nit. |
| `PLAN-REVIEW-CODEX.md` | Adversarial review #2 (GPT-5.6 Sol, independent). 2 blockers + the world-class gap analysis. |
| `research/R1..R9-*.md` | Deep code research with `file:line` citations. |
**Not committed:** byte-exact MIT-licensed source for 20 beautifului.dev
components was recovered during research (the site publishes no repo or package;
the source is inlined in its RSC flight stream). It is reference material, not
ours, so it is deliberately left out of this repo — re-fetch it if needed.
`research/R6-beautiful-ui.md` documents every component in enough detail to
rebuild from.

**The source recording** lives outside the repo at
`E:/Users/cheyr/Videos/CursorCaptures/capture-20260822-121909/` — `transcript.txt`
is the owner's narration, `stills/` holds 275 frames with a manifest, and
`stills/ocr/` has OCR for 170 of them. To look at a frame, crop and downscale it
first (they are 3840×2160; reading one raw wastes enormous context):

```bash
FF=<path-to-ffmpeg>
"$FF" -y -i stills/<name>.jpg -vf "crop=2600:1800:150:130,scale=1500:-2" -q:v 3 /tmp/out.jpg
```

That crop is the browser window on most desktop frames and is crisply readable.

---

## 2. Non-negotiables

Violating one of these is wrong even when the result looks right.

1. **X1 — reduced motion ships with the motion.** 19 enforcement sites. Strategy
   is per-element `motion-safe:` plus targeted `@media`. Do **not** import
   beautifului.dev's blanket `0.01ms` rule with its components.
2. **X2 — truthfulness.** Every status row is sourced from a real invocation's
   real result, never model prose. *"A chip the model could ask for would be a
   second surface to fabricate on."*
3. **X3 — approval semantics.** The call **is** the approval request. Never
   reintroduce a prose *"Confirm?"* turn — that once stopped writes entirely
   (0/15 → 21/30 after the fix).
4. **X4 — widen the clickable audit's scan root BEFORE marking anything.** It
   scans `routes/` only; the sidebar lives in `components/`.
5. **X5 — contracts.** B9 no infra changes. B11 any new env var gets a
   `DEPLOYMENT.md` row and a `/health` field in the same commit, and the
   maintainer sets it. B12 verification runs as the QA account, never the
   owner's.
6. **CI wiring.** A new test needs its own `test:*` script **and** its own
   `ci.yml` step. CI does not run `pnpm -r test`; unwired tests never run.
7. **Docs.** `DECISIONS.md` and the wiki Decision-Log together, same sitting.

---

## 3. Order of work

Do not reorder without reading §10 of `PLAN.md` — the sequence encodes
dependencies that were wrong in the first draft.

1. **X4** — widen the clickable audit's scan root. Alone, first.
2. **Signed-in visual spec** — the V3 prerequisite. The harness is signed-out by
   construction; every chat surface is behind auth. Until this exists, "Verify
   (V3)" on a chat surface is aspiration.
3. **A1, A2, A3, A6, A7** — lifecycle and expression, independent of layout.
4. **B** — the shell. **Before A4/A5**, because they anchor to a composer B1
   moves.
5. **A4, A5** + **B7** keep-out region.
6. **The ordered-part-list refactor** — its own step, before C2/C3.
7. **C** — markdown (both surfaces), chips, thinking, card rows.
8. **D** — liveness.
9. **E** — wayfinding. E8's step semantics settled before the tool schema.
10. **F** — approval card. Gated on the design note + its review.
11. **H** — control and recovery.
12. **G** + docs, decisions, gates.

---

## 4. Verification — the five instruments

### V1 — types and units
```bash
cd E:/Users/cheyr/deckpal
pnpm --filter @deckpal/db build && pnpm --filter @deckpal/storage build && pnpm --filter @deckpal/agent-tools build
pnpm -r --workspace-concurrency=1 exec tsc --noEmit
pnpm --filter deckpal-api test:deck && pnpm --filter deckpal-api test:images \
  && pnpm --filter deckpal-api test:decke && pnpm --filter deckpal-web test:decke \
  && pnpm --filter deckpal-api test:pure && pnpm --filter @deckpal/storage test \
  && pnpm --filter deckpal-api test:auth && pnpm --filter deckpal-images test
node scripts/check-functions.mjs   # needs apps/api + apps/mcp built first
```
TAP summary lines start with `ℹ`, not `#`.

### V2 — behaviour gates (the project's own standard)
`scripts/decke-gates.mjs` — 17 network-hooked gates. Playwright is resolved at
runtime, deliberately **not** a dependency:
```bash
npm install playwright        # into a scratch folder outside the repo
PLAYWRIGHT_MODULE=/path/to/node_modules/playwright \
  node scripts/decke-gates.mjs --base http://127.0.0.1:5210 --gate 1
```
Its doctrine, which governs this whole pass: *"A gate fails if the answer is
RIGHT BUT UNVERIFIED… the transcript is the model's account of what happened,
which is precisely the witness under suspicion."*

### V3 — visual
`scripts/visual-harness/` (see its README). Screenshots, video, contact sheets,
console/network logs, timing, and **CDP safe-area emulation that genuinely
works** (measured 47px top / 34px bottom, versus Chromium's 0px default).

### V4 — motion
```bash
node scripts/visual-harness/judge-motion.mjs run/open.webm \
  --assert "the character is absent at first, grows from nothing, then travels"
```
Exit 0 pass / 1 fail / 2 unclear / 3 no vision model configured / 4 error.
**Optional by design** — without `AI_GATEWAY_API_KEY` it still builds the contact
sheet and exits 3, so a caller can tell *"the change is wrong"* from *"nobody
checked."* Assert only claims a human could settle in two seconds; a `fail` is a
reason to look, not a fact.

### V5 — the owner, on a real iPhone, installed as a PWA
Not delegable. Chromium reproduces safe-area *geometry* but not
`backdrop-filter` compositing under a translucent status bar. Every mobile item
in `PLAN.md` names whether it needs V5.

---

## 5. Settled — do not reopen

- Desktop scrim: **content pane only**; header and full-height sidebar stay
  sharp. "Full screen" means the content pane. (OR1)
- Mobile warm: **tap and wait**, arrival animation covers the load. Nobody who
  never taps pays. (OR2)
- Approval card: segmented by **variant provenance**, no confidence number.
  Accept commits the known section even if a printing is left unpicked. (OR4)
- Rip-watching presence: **may be gutted** — it does not work and needs its own
  overhaul. Do not leave it as a silent no-op. (OR6)
- Conversation persistence across reloads: **out of scope**; a proper chat-history
  feature gets planned separately.
- Add-photo in the composer: **deferred, and the slot was NOT built** — the
  ruling said the card would be built so a slot exists, and what shipped is a
  composer card with room for one rather than a control. A visible disabled
  attach button is worse than nothing: it advertises a capability and then
  refuses. Corrected here after an audit read the code against this list.
- Journeys: **one plan, executed client-side** — not per-hop model turns.
- Q13 (page behind scrolls?): the lock **stays**; the complaint is caused by the
  damaged ends of the scrollable region. My ruling, not the owner's — a
  one-sentence change if he disagrees, and it blocks nothing.

---

## 6. Still open

1. **Web search visibility** — probe first (`fullStream` may already carry
   `'source'` parts that `deep.ts:172`'s `textStream`-only loop discards). Only
   escalate to the owner if the probe fails, because the fallback would mean
   relaxing the "US frontier labs only" constraint in `models.ts`.
2. **Chat model latency** — `spacexai/grok-4.20-non-reasoning` is 1148ms vs
   811ms TTFT and 7.49× the cost of its predecessor, accepted to fix `flyTo`
   reliability 0/5 → 5/5. Measure after Phase E with `flyTo` re-tested. Do not
   re-litigate mid-pass.

---

## 7. Two things easy to get wrong

- **`log_cards` behaviour change.** After Phase F, a multi-variant card with no
  stated variant — which today silently becomes the primary **and is written** —
  will instead be asked about, and **not written if ignored**. That is what the
  owner asked for, but it is a semantic change to a live write path.
- **The chunk name is load-bearing.** `vite.config.ts:220-231`'s `Decke-runtime`
  feeds `globIgnores: ['models/**','assets/Decke-*.js']`. Change the import graph
  and the emitted chunk must still match `assets/Decke-*.js`, or the PWA silently
  precaches 1.14 MB of three.js for every visitor.

---

## 8. Before declaring any phase done

- Baseline still green (§4 V1).
- The phase's own named instrument has actually run, and its artifact was looked
  at — not assumed.
- **Update `COVERAGE.md`**: mark the C/D numbers this phase actually closed, and
  move anything it deliberately did not. The map exists — keep it true, or "60
  complaints" becomes a number nobody can check.
- Every new interactive control has a role, a label, and focus handling (C6/D13).
- `DECISIONS.md` + wiki updated in the same sitting for anything non-trivial.
