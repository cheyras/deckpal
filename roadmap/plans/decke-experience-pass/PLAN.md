# Deck-E experience pass — IMPLEMENTATION PLAN

Branch `decke-experience-pass`, off `209150f`. Baseline verified green before
any change: typecheck exit 0, **489/489 tests** across 8 suites, 4 serverless
functions load.

## Authority, in order

1. `OWNER-RULINGS.md` — decisions taken directly from the owner. Override
   everything below.
2. `BRIEF.md` (2,944 lines, audited) — 60 complaints, 16 defects, 13 conflicts.
3. `BRIEF-AUDIT.md` — 25 corrections, 11 claims found wrong/overstated.
4. `research/R1–R9` — code research with `file:line`.

Where this plan and the brief disagree, the brief wins unless a ruling says
otherwise. Where a `file:line` here is load-bearing, it was re-verified against
the repo, not copied.

---

# 0. What "world-class" means here, measurably

Added after two independent reviews. The second one's verdict was blunt and
correct: *"a strong experience-remediation plan, but not yet a complete plan for
a world-class agent chat. It invests heavily in mascot choreography, visual
polish, and complaint closure. The larger gaps are control, recovery, trust, and
evaluation."*

Closing 60 complaints yields a **fixed** experience, not an **excellent** one.
These are the targets the pass is judged against, and each is testable:

1. **Immediate acknowledgment.** The transcript changes within 150ms of send —
   before any model byte arrives.
2. **No unexplained silence beyond 3 seconds.** Something truthful updates, or
   the UI says why it cannot.
3. **Every autonomous action is visible, attributable, and cancellable.** Nothing
   Deck-E does to the page happens without a row naming it and a way to stop it.
4. **Every failure has a recovery path.** No dead end that requires a reload.
5. **Approval shows the exact payload that will be committed** — not a
   description of it.
6. **Direct navigation stays fast.** "Take me to it" must not become slower
   because escorted journeys exist.
7. **Guided motion never fights user input.** Any real user gesture wins.
8. **Answer quality is judged separately from animation quality.** A beautiful
   character giving wrong answers is a failure of this pass.

Target 8 is the one the original plan had no instrument for at all — see §14.

---

# 1. Verification doctrine

The project's own standard, from `scripts/decke-gates.mjs`:

> A gate fails if the answer is RIGHT BUT UNVERIFIED. "He said he went to
> /decks" is not evidence; `page.url()` is. That is why this hooks the network
> rather than reading the transcript. The transcript is the model's account of
> what happened, which is precisely the witness under suspicion.

Five instruments, **all proven working before planning finished** — not assumed:

| | Instrument | Proves | Status |
|---|---|---|---|
| **V1** | `tsc --noEmit`; `node --test` (8 suites) | logic, wire shapes, schema sync | existing, green |
| **V2** | `scripts/decke-gates.mjs` — 17 network-hooked gates | *did it actually happen* | existing, in daily use |
| **V3** | `scripts/visual-harness/` + CDP safe-area override | layout, spacing, safe areas, blur | **built and proven** (commit `34d3914`) |
| **V4** | video → contact sheet → vision judge (`judge-motion.mjs --assert`) | motion: entry, travel, facing, gaze | **built and proven** |
| **V5** | owner, real iPhone, installed PWA | `backdrop-filter` under a translucent status bar | his, at the end |

**V4 usage rule.** Assert claims a human could settle in two seconds. A `fail`
is a reason to look, not a fact. `unclear` is a real answer. Claims must be
falsifiable — "the layout looks correct" cannot fail; "the composer's bottom
edge is ≥30px above the screen bottom" can.

**V3 PREREQUISITE, and it is unbuilt work, not a detail.** The harness
*"runs entirely signed out"* (`run-visual-smoke.mjs:13`) and its proof run
photographs the public landing page. **Every chat surface in this plan is behind
auth and behind the entitlement gate**, so no V3 claim on a chat surface counts
until a **signed-in visual spec** exists. The plumbing is there —
`decke-gates.mjs`'s signed-in page helper plus the QA account under B12 — but
combining it with the harness is unnamed work. **It is the first V3 task**, and
until it lands, "Verify (V3)" on A4/B2/B3/B5 is aspiration.

**V5 is not delegable and not optional.** CDP safe-area emulation (verified:
47px top / 34px bottom) makes the *geometry* testable, which R5 had concluded
required hardware. It does not reproduce compositing. Every mobile item below
names whether it needs V5.

---

# 2. Cross-cutting constraints

These bind every phase. A change that violates one is wrong even if it looks
right.

### X1 — `prefers-reduced-motion` ships in the same commit as the motion
19 enforcement sites (`theme.css:647,690,846`; `premium.css:853`;
`landing.css:12,212`; `motion-safe:` on every animated host element —
`DeckeBubble.tsx:120`, `DeckeButton.tsx:78,85`, `DeckeChat.tsx:389,415,441,442`;
`elementHighlight.ts:147`; `Sheet.tsx:62`; `DeckE.ts:1933`). This pass is almost
entirely motion and the brief originally carried **no** reduce constraint.

- **Strategy is per-element `motion-safe:` + targeted `@media`.** Do **not**
  import beautifului.dev's blanket `0.01ms` rule along with its components.
- **C3 under reduce** = presence without the entrance, not absence.
- **C32 under reduce** = keep the hops, keep the outlines, drop the *flight* —
  arrive cut rather than flown. A genuinely different code path, not a disabled
  animation.
- **C50's fade mask** is `mask-image`, not motion. It stays on.
- **This needs a real engine capability, and no phase allocated it.** There is no
  `prefersReducedMotion` read anywhere in `character/decke/` or
  `character/host/` — the only mention is a comment noting native smooth
  scrolling honours it *"without this module having to know that exists"*
  (`DeckE.ts:1933`). Both "appear at final size" (A3) and "arrive cut rather than
  flown" (E8) require an **instant-arrive mode** that does not exist.
  **Work item:** the host reads the media query and passes a `reduced` flag (or
  `{ instant: true }`) into `DeckE`, honoured by entry, flight, and escort legs.
  This keeps the engine media-query-ignorant, consistent with its own stated
  philosophy — the host owns the query, the engine owns the behaviour.

### X2 — Truthfulness of every status surface
`adapters/aisdk.ts:51-64`: *"EMITTED FROM HERE, not from the model. A chip the
model could ask for would be a second surface to fabricate on."* Any new row —
including E5's travel/click rows and D-phase narration — must be **sourced from
a real invocation's real result**, never model prose. Gate 7 extends to cover
them.

### X3 — Approval semantics must not regress
`DECISIONS.md` 2026-08-22 *"He would not call the write tool"*: the model stopped
calling `log_cards` because the prompt said ask-first, duplicating the SDK's own
hold. The fix was **the call itself IS the approval request**, plus *"never end
a turn with Confirm?"*. **The approval card is a rendering of the SDK's real
`tool-approval-request`** — not a question the model wrote. Any prompt change
here is re-measured with the original's route-varied methodology.

### X4 — The clickable audit must be widened *before* anything is marked
`apps/web/src/character/host/__tests__/uiTools.test.ts:99` asserts exactly
`['CardDetail.tsx', 'SeriesIndex.tsx']` carry `data-decke-clickable`, with the
reason in the comment: *"the spec that designed the click tool listed the
quantity stepper and the add-card control as clickable in its own table. Both
are writes. It caught itself."*

**It scans `routes/` only, non-recursively.** The most important element to mark
is the sidebar nav, which lives in `components/AppShell.tsx` — so as written it
would **escape the discipline it exists to enforce**. Widen the scan root first,
as its own commit, then mark.

### X5 — Contracts
- **B9** — no infra mutation. Nothing here needs one.
- **B11** — no new env var is anticipated. If one appears: `DEPLOYMENT.md` table
  + `/health` field **in the same commit**, and the maintainer sets it, not me.
- **B12** — the QA account (`.qa-account`, entitled via
  `DECKE_ENTITLED_USER_IDS`, seeded `me05` "Pitch Black", 12/120 owned) for every
  write-touching gate. Never the owner's.
- **CI** — a new test suite needs its own `test:*` script **and** its own
  `ci.yml` step. CI does not run `pnpm -r test`; unwired tests never run.
- **Docs** — `DECISIONS.md` + wiki Decision-Log together, same sitting.

---

# 3. Phase A — Presence and lifecycle

### A1 — Delete the automatic load
**Complaint:** C2, his stated #1. **Root cause:** `DeckeHost.tsx:166-177` sets
`phase='loading'` on a `requestIdleCallback`/1.5s timer gated only on
`entitled && !chromeless`. Never on a click.

**Real cost: 7,104,290 bytes** (6.78 MiB) — glb 2,918,432 + HDR 1,608,057 +
atlas 1,069,793 + playbook 186,833 + cards 44,311 + card-back 77,824 + JS
1,199,040. (The "6.9 MB" in R1 and the brief was wrong.)

**This fix RESTORES two documented decisions** (§6.9), which is why it is low
risk:
- `DeckeHost.tsx:433-436` hides the launcher while chat is open because *"two
  Deck-Es… is the exact thing the whole well design exists to avoid."* Proven at
  `t00108.000_preclick`: the 3D body **and** the doze-state chip are on screen
  together, in the default closed state, on every page.
- `vite.config.ts:163-166` excludes these assets from precache on the premise
  *"the route is lazy, so the cost is paid only by whoever actually opens it."*
  That premise is currently false. This makes it true.

**Change:** delete the effect. Load triggers only on `DeckeButton`'s `onWarm`
(pointer-enter / touch-start / focus) and `onOpen`.

**Sanctioned casualty (OR6).** A1 also removes the only thing that loaded
Deck-E before a booster-pack rip — `ripPresence` is a no-op when he is not
loaded, so rip-watching dies with the timer. This appeared in **no** document
until Fable's review. The owner's ruling: *"the rip-watching feature completely
doesn't work, and very clearly needs an overhaul, so I'm ok with gutting the
implementation as is."* So this is a **deliberate removal, not a silent
regression** — and it must be recorded that way. **Do not leave `ripPresence` as
dead code that silently no-ops**; remove it or disable it explicitly with a
comment. A no-op that looks live is how this hid in the first place. Retire any
gate that asserts rip presence in the same commit.

**Landmine:** `vite.config.ts:220-231`'s `advancedChunks` name `Decke-runtime` is
load-bearing for `globIgnores: ['models/**','assets/Decke-*.js']`. If the import
graph changes shape the emitted chunk must still match `assets/Decke-*.js`, or
the PWA silently precaches 1.14 MB of three.js for everyone.

**Verify (V2):** a new gate — load `/series` as QA, wait past the old 4s window,
assert **zero** requests to `models/decke/*` and `assets/Decke-*.js`; then hover
the button and assert they fire. Network evidence, not a screenshot.

### A2 — Mobile warm: tap-and-wait, arrival animation covers it
**Ruling OR2.** Defect D12: there is no hover on a phone and `touchstart` beats
`click` by ~100ms, so A1 trades "already there" for "tap, then wait".

**Accepted:** a beat of delay on first open; several seconds on a slow link.
Nobody who never taps pays anything.

**Consequence — the chip's loading state is now load-bearing UI**, the only
thing between tap and arrival. It must read as *coming*, not *broken*, and must
survive a slow connection without looking stalled. Desktop keeps pointer-enter
warming, which usually hides the load entirely.

**Out of scope, explicitly:** payload reduction. The 1.57 MB HDR is the softest
target for a later pass; the glb and 16-bit atlas have documented reasons they
cannot shrink (`DeckeButton.tsx:1-21`).

**Verify (V4 + V3):** video of cold-load → tap → arrival; assert *"the character
is absent at first, a small button animates as loading, then the character
appears and grows."* Plus a throttled-network run.

### A3 — Scale up from zero, then travel
**Complaint:** C3, C35. **Current:** he is parked at `homeCorner`
(`dom.ts:295-304`, `DeckE.ts:690`) and only the canvas opacity fades over 500ms
(`DeckeHost.tsx:423-426`). No whole-body screen-space scale exists; the `sq`
channel (`constants.ts:148`) is a shape squash, not a scale.

**The travel half already works** — `DeckeHost.tsx:227-263` genuinely flies him
to the stand point.

**Change:** add the entry beat via a **rig-root screen-space scale**, not
`setCharacterHeight`. *(Corrected after review — the plan originally preferred
`setCharacterHeight` and that is the wrong mechanism: it dollies the camera, so
scaling from ~0 drives the camera toward infinity. It cannot express "grows from
nothing"; at best it zooms, at worst it diverges.)* Sequence: **absent → scale 0→1 at the
button's rect → travel to the stand point.** Fix `theme.css:697-713`'s
transform-origin to the button's real rect so panel and character agree.

**Reduce path (X1):** appear at final size, no scale, no flight.

**Verify (V4):** assert *"the character starts absent, grows from nothing, then
travels."* Plus a reduce-motion run asserting he is present without an entrance.

### A4 — Smaller on desktop
**Complaint:** C4. **Root cause:** `characterHeightFor()`
(`DeckeHost.tsx:81-84`) applies the 0.5× `CHAT_COMPACT` shrink only when
`w < NAV_BREAKPOINT` (1068). Desktop chat-open height = idle height, up to 300px.

**Change:** size him from the **composer card's measured rect**, not a constant.
Phase B makes the composer the anchor, so this and A5 stop being magic numbers.

**Verify (V3):** stills at 1440×900 and 1920×1080.

### A5 — Facing: one fix, two symptoms
**Complaints:** C26, C27. **Root cause:** both chat-open `flyTo` calls
(`DeckeHost.tsx:243-253`) pass `centre:true`; `solvePark`'s centre branch
deliberately returns no `facing` (`dom.ts:276-277`); `flyTo` then re-asserts the
boot default `facing = 1` = **screen-left** (`DeckE.ts:454`, `:1158`).

**DO NOT** make `solvePark`/`parkOn` return a facing for centre parks —
`park.test.ts:119` pins it, and `dom.ts:274` records that unifying the callers
was itself a bug fix.

**Change:** at the two call sites. Add `facing?: number` to `FlyOptions`
(`DeckE.ts:1101` has no such field), honoured even when `centre:true`. Derive it
from the composer rect so it is right at any width.

**Verify (V1** unit test on the option **+ V4** *"is the character facing toward
or away from the text input?"* at both breakpoints**).**

### A6 — Thinking gaze: up and away
**Complaint:** C24. **Root cause:** gaze is always camera-relative by
construction (`look.ts:165-178`). `thinking` carries `gx:-1.7, gz:1.05`, which at
camera distance ≈8.87 is **≈6.8°** — technically up, visually dead-on.

**Change:** increase the offset materially; stop the 2160/2320/2480ms beats
tapering *back* to camera; add lateral offset so it reads "away", not just "up".

**Landmine:** `playbook.json` (187KB) is generated and **the generator has been
broken since 2026-08-16** (`playbook.ts:6-9`). Hand-edit the committed JSON and
**record that**, or it silently drifts when the generator is fixed.
`look.test.ts` pins `aimPupil`/`gazeTarget` against the bind pose, not playbook
states — safe. Do **not** touch `GAZE_GAIN`/`PUPIL_ROAM`.
`PARITY.md` is already known-stale on gaze (its own header) — a record, not a
gate.

**Honest framing (R8):** gaze aversion under cognitive load is real, replicated
HCI research, and a 2025 study found it beat progress bars 66.7% vs ≤12.5% on
naturalness. Justify the specific *up* angle as **animation convention** — "up =
accessing memory" is discredited NLP pseudoscience.

**Also fix D14:** the iris is clipped by the sclera rim during `thinking`.

**Verify (V4):** contact sheet of the thinking loop; assert gaze direction.

### A8 — Route-change invalidation (D4; DROPPED by the first draft, and Phase E amplifies it)

**Verified:** the **only** route subscription in the whole character host is
`DeckeHost.tsx:101-102`'s `useRouterState({ select: s => isChromelessPathname(...) })`
— a boolean deciding whether to render at all. **Nothing reacts to navigation.**
Consequently, when the page changes underneath him:
- the speech bubble stays pinned, over content it no longer describes (the
  owner saw exactly this — a stale answer bubble hanging over a page he had
  navigated away from);
- the minimised bar survives;
- and the **parked station still holds a selector for an element on the page he
  just left**, so his anchor points at something that no longer exists.

**Why this must land before Phase E, not after.** E8 makes route changes routine
*mid-turn*. `§7 E8.2` already contains the sequencer's private version of this
rule ("route waits must not match stale DOM") and never generalises it to
**user-initiated** navigation — which is the common case and the one the owner
hit.

**Change:** one route-change subscription in `DeckeHost`. On pathname change:
clear the bubble, clear any highlight, and invalidate a park whose anchor
selector no longer resolves — return home or re-solve rather than pointing at a
ghost. Exempt an in-flight journey step, which owns its own transition.

**Verify (V2):** a gate that opens the chat, gets a bubble, navigates by clicking
a nav link, and asserts the bubble is gone and his anchor re-solved.

### A7 — An emotion beat when the answer arrives
**Complaints:** C21, and **OR3** (his recovered lost request — *probable, not
certain*). At the thinking→answering transition he should visibly change state
rather than staying in the same rocking loop. Uses `express` and the existing
sustained-state system; no new engine work.

---

# 4. Phase B — The chat shell

### B1 — Desktop: content-pane takeover, chrome sharp
**Ruling OR1**, converging with the audit's §6.13 recommendation (A).

Scrim covers **only the content pane**. Header **and full-height sidebar** stay
sharp and interactive. Composer centred **in the content pane**. Deck-E stands
just outside its left edge, positioned from its measured rect.

**No desktop decision is reversed.** Desktop keeps scrim `z-15` below
`--z-chrome: 20`. Only strength (B2) and layout change. "Full screen" (C5) means
the content pane, reconciling C5 and C8.

**Note for the record:** claude.ai is a precedent for *where the composer goes*
and for nothing else — it has no host application showing through.

### B2 — Stronger scrim, tokenized; mobile matches desktop
**Complaints:** C7, C29. Current: `bg-black/45 backdrop-blur-[3px]` for both
breakpoints (`DeckeChat.tsx:414`) — at 4K the 3px blur is effectively invisible,
which the frame scribe confirmed independently (set logos stay crisply legible).

**Change:** raise alpha and blur. Reference: `Sheet.tsx:264-266` uses
`--color-overlay-scrim-strong` = `rgb(26 23 22 / 0.75)`. **Tokenize both** —
today they are inline arbitrary values backed by no variable, which is how the
two overlays drifted apart.

**Mobile (reverses §6.2):** the scrim starts **below the app header**.
**Geometric, not a z-index swap** — `backdrop-filter` samples whatever
composites behind it regardless of paint order, so the blur element must not
extend under the header. Top offset `calc(64px + env(safe-area-inset-top))`,
matching `AppShell.tsx:359`.

**The panel's own geometry, decided here rather than left to an implementer.**
B2 moves the *scrim*; the panel is separately `inset-0` at `z-[25]`, above
`--z-chrome: 20` (`DeckeChat.tsx:436-441`), so without these four decisions the
"Deck-E" row and ✕ would paint on top of the now-sharp app header:

1. **The panel's top edge takes the same offset as the scrim** —
   `calc(64px + env(safe-area-inset-top))`. It starts below the app header, not
   at the viewport top.
2. **The chat keeps its own slim header row**, now below the app header. The ✕
   stays there. B3's safe-area padding then applies to the *app* header, and the
   chat header inherits correct position by sitting under it — which is what
   C47's collision was really about.
3. **Header-tap policy while the chat is open:** the app header is live, so a nav
   tap **minimises the chat deliberately** — reusing the existing `travelling`
   minimised mode — rather than navigating out from under an open conversation
   or being swallowed. The turn survives; the panel gets out of the way.
4. **C56 — "have Deck-E down here" — is a named verification assertion**, not an
   assumption. The park landmark lives *inside* the panel whose top edge this
   change moves (`DeckeChat.tsx:576`), so his mobile position is a regression
   risk of exactly this change. Assert it is unchanged.

**Verify (V3** before/after stills **+ V4** *"is the second image's backdrop more
blurred and darker, while the top bar stays sharp in both?"* **+ V5).**

### B3 — Safe areas
**Complaints:** C47, C48, C30. **Root cause:** `DeckeChat.tsx`'s header
(`:445-460`) and composer `<form>` (`:647-652`) have **zero**
`env(safe-area-inset-*)` padding. Every other fixed header/sheet in the codebase
has it (`AppShell.tsx:428-434,359,371`; `Sheet.tsx:318,326`; `authUi.tsx:73`;
`Landing.tsx:227`). DeckeChat is the sole exception.

It only surfaces in a standalone PWA because `index.html:5,13` sets
`viewport-fit=cover` + `black-translucent`. **The ✕ literally overlaps the
battery glyph** — worse than first reported.

**Changes:** header `padding-top: env(safe-area-inset-top)`; composer
`padding-bottom: max(<n>px, env(safe-area-inset-bottom))` (the `max()` idiom is
already used at `DevBackendRibbon.tsx:44`); fix `DeckeButton.tsx:74` (same gap,
same family); normalize the desktop panel's `100vh` → `100dvh`.

**Testability change worth making anyway:** route `env()` reads through
overridable custom properties (`--safe-top: env(safe-area-inset-top, 0px)`) so a
test can inject values.

**Verify (V3 with CDP safe-area override — 47/34px — + V5).**

### B4 — The dead grey band
**Complaint:** C30. **Not a rendered element.** The mobile panel is deliberately
glass (`DeckeChat.tsx:28-32`) and the composer `<form>` has no background — so
the padding, the right gutter, and the entire unpadded safe-area strip are the
user **looking through to the scrim**. B3 + B5 make it stop existing rather than
covering it.

### B5 — Composer as a card, conversation fading behind it
**Complaints:** C50, C51, C52. Current (`DeckeChat.tsx:647-700`): a `<form>` with
**no background, border, radius or shadow**, containing a `rounded-full` input
and a `rounded-full` button — literally "a pill and a circle floating on the
scrim."

**The reference is named, because the owner named it.** C51 is *"I don't really
like the design of the input at all… this is something we should definitely
steal from beautifului.dev. They have some really good text input. Prompt Bar."*
The first draft never once wrote "Prompt Bar" — build against
`research/R6-beautiful-ui.md`'s Prompt Bar section and the recovered source.
**Adapt, do not copy:** it imports unpublished internals
(`@/components/atoms/Button`) and uses tokens this app does not have
(`bg-field`, `text-ink`, `shadow-hairline`). Its optional WebGL flourish
(`glimm`) is **not** adopted.

**C6 — the composer starts centred and drops on first message.** Unspecified in
the first draft. Empty conversation: the card sits **centred in the content
pane**, the way Claude's new-chat screen does. On the first send it animates
**down to bottom-centre** and the transcript fills above it. Reduced motion (X1):
it is simply already at the bottom. This is also C37 — *"since we're changing
that layout on desktop, I would have it go to the bottom center"* — so desktop
and mobile end in the same place, which was the point.

**Change:** a real card (`--radius-2xl` 16px, or the 18px the desktop panel
already uses) on a real surface with `--shadow-panel`. Add a `mask-image` /
`-webkit-mask-image` fade on the transcript's bottom edge, starting above the
card. **New to this codebase** — no scroll mask exists anywhere (R5). Safari
needs the prefix.

**Settled by §6.3:** the panel stays glass; the **composer** becomes opaque. That
is compatible with the original decision and is what Claude iOS does. The
approval block (`DeckeChat.tsx:595-645`) becomes **its own card with a visible
gap**, matching the reference.

**Honest gap:** the scribe could never see Claude iOS's true home-indicator
spacing — the mirror window's chrome cut it off. Match the *structure*; tune the
number against a real device (V5).

**C52 — add-photo: OUT OF SCOPE** (OR5). The app has a whole `/scan` route and
pipeline; a second image-input path is a feature, not a restyle. The card is
built so the slot exists. No model picker, per his explicit instruction.

### B6 — Scrolling
**Complaints:** C46, C48. Compound, not one bug. The body-lock itself
(`Sheet.tsx:91-123`, shared) is **correct** iOS technique. What breaks it:
1. Both ends of the only scrollable region are damaged (B3).
2. `useLayoutEffect` (`DeckeChat.tsx:329-333`) hard-sets
   `scrollTop = scrollHeight` on **every** message/gutter change with **no
   "user scrolled away" guard** — reading back yanks you down on the next token.
3. The outer scroll container inherits `pointer-events-none` from the mobile
   panel; only the inner `<ul>` has `pointer-events-auto`, so drags in the
   padding band silently fail.

**Proven:** the post-drag frame at t=1245.823 is **pixel-identical** to
t=1245.678 despite a real 1.3s drag.

**Changes:** stick-to-bottom only when already near bottom; explicit
`pointer-events-auto` on the scroll container.

### B7 — A keep-out region for the character (§6.11)
**Nobody had noticed this.** `DeckeHost.tsx:417` puts the canvas at **z-30,
deliberately above `--z-chrome: 20`** — *"he has to be able to park beside and
point at a nav item."* B2 excludes the header from the **scrim**; it does not
exclude it from **him**. He will still paint over the header that C29 exists to
make prominent.

**One mechanism fixes four symptoms** — C29, D6 (clipped by viewport top), D7
(covers the "Install" pill), D11: clamp his solved positions into a keep-out
region — a top band of `calc(64px + env(safe-area-inset-top))` and a bottom band
for the composer card. `parkBeside` already clamps **horizontally**
(`dom.ts:192`); there is no vertical equivalent, and D6 is that missing clamp
seen from the other side.

**Also:** if A3's open transition ever shows the launcher chip while the chat is
open, its `z-20` must be revisited in the same change or it vanishes under the
mobile scrim.

### B8 — Narrow-desktop header collision (D15)
At narrow desktop widths the chat panel's header collides with the app's own.
Falls out of B1's layout change; verify it does.

---

# 5. Phase C — What the chat renders

### C1 — Markdown, in **both** places
**Complaint:** C11. **Root cause:** `DeckeChat.tsx:492-503` renders `{m.text}`
raw. **And `DeckeBubble.tsx:129` does the same** (D10) — which the original brief
missed and which matters because **Phase E routes more text through the bubble,
not less**.

**Mostly pre-solved:** `react-markdown@^10.1.0` + `remark-gfm@^4.0.1` are
installed, and `routes/deck/MarkdownView.tsx` is a complete token-styled
component map, `React.lazy()`-loaded so ~40KB gz never touches the main bundle —
a pattern already proven here.

**Change:** a chat-tuned variant wired into **both** surfaces, lazily. Highest
value per line in the pass.

### C2 — Tool chips: order, affordance, honesty
**Complaints:** C10, C15, C16, C23. Four problems:

**(a) Order.** `DeckeChat.tsx:504-518` says chips render *"ABOVE his words on
purpose"*; the JSX puts text at `:492` and chips at `:519`. **The code
contradicts its own comment**, and he independently noticed. Fixing this
*restores* documented intent.

**(b) Reordering on update.** `useDeckeChat.ts:263-278` does
`filter(c => c.id !== chip.id)` then appends — so every `ok`/`error` **moves that
chip to the end**. This is why the order visibly shifted across frames, and
worse, **it pushed the failed `Analyse the collection` chip to last position**,
where it read as *most recent* rather than *broken*. Preserve first-seen order.

**(c) Affordance.** A static `<li>`, `rounded-full border bg-surface-secondary`,
no `onClick`/`role`/`tabIndex`. Its real content sits in a native `title`
attribute — **invisible on mobile, undiscoverable on desktop**.

**Change:** drop the resting pill; quiet inline rows; summary visible/expandable
rather than hover-only. For "this is the thing being discussed" reuse
`HighlightRing`/`elementHighlight.ts` — a chasing multi-hue border deliberately
unlike any static UI state, whose header says *"Deck-E is its first caller and
will not be its last."* That is exactly *"highlightable, but not a pill by
default."*

**(d) Failure is the deliberate exception to quiet.** (c) says drop the resting
pill and go quiet — **that is the wrong default for a failed call**, and as
originally drafted this plan would have shipped a *more* subdued surface for the
exact frame in which the owner read *"The analyze tool timed out"* as "a great
response." Error and partial states get **more** weight, not less: a distinct
tone, an explicit label, and a retry affordance. R8's rule — collapse by
default, **never collapse a failure** — is binding here. This is the other half
of the D2 blocker; `§8b H3` fixes the status lying, this fixes it being
invisible.

**(e) Do not fake sequence.** They batch because the SDK runs parallel tool
calls in one step and each chip fires when its `execute` begins
(`adapters/aisdk.ts:338-344`). Fix it in Phase D by changing what happens, plus
a small presentation stagger.

### C3 — A real thinking state
**Complaints:** C12, C14. **There is no per-message loading affordance in the
transcript at all** — the assistant message is inserted with `text: ''` and no
bubble renders for empty text, so between send and first token the transcript
shows *nothing*.

**Change:** a thinking row that appears immediately on send, animates, carries
Phase D's live status line, and expands to show step detail. Modelled on
beautifului.dev's Thinking (label cycling *"Thought for 4 seconds"* → *"Ran 3
tools"* → *"Searched the web"*) and Streaming Text. Reduce path per X1.

### C4 — Inline card rows
**Complaint:** C39, C40, C42. `CardImage.tsx` (fixed 245/337 aspect, graceful
fail) + `cardSource.ts`'s `artForIds()` + `useCardArt()` are the proven pair the
`cardGrid` block already uses. **Gap:** variant name is not on `CardArt` and not
resolved by `artForIds()` — it lives only in the rip/scan flow
(`ripSession.ts:34-39`, via `api.card(cardId).variants`). New layout, reused
plumbing.

### C5 — Ad-hoc screens as compact previews
**Complaint:** C40. Already renders inline (`DeckeChat.tsx:544-548`) with a
locked-down schema where *"no field anywhere carries HTML, a class name, a
style, a URL or a selector."* `sourceSync.test.ts` keeps client and server in
sync. **Gaps:** no compact/summary mode; no visual distinction between a
"about to do" preview and a completed result; no expand-in.

### C6 — Accessibility (D13)
The chat has no accessibility story and this pass adds a dozen controls. Every
new control ships its role/label/focus handling. Not a follow-up.

---

# 6. Phase D — Liveness

### D1 — The 210-second silence
**Complaints:** C18, C19. **Root cause, exact** — `deep.ts:172-174`:

```ts
for await (const delta of result.textStream) { text += delta }
```

A deep tool's own model stream is **collected into a local string and never
forwarded**. For up to `DECKE_DEEP_BUDGET_MS` (default **210,000ms**) the only
signal is one `start` chip, then nothing.

**Measured (D1 in the brief):** the UI was **pixel-identical for 61 seconds**
(t=529→590), by direct frame comparison.

**And the reply he praised as "a great response" was a tool-failure message** —
*"The analyze tool timed out before it could finish reading your full
collection…"* (D2). **He did not notice it failed.** That is the argument for
this phase: the liveness gap hid a real failure from the person who built it.

**Change:** forward progress — a `progress` phase on `data-decke-tool`, or a new
transient event, carrying deltas or at minimum a heartbeat + step label.
**Care:** sub-agent prose is deliberately **not in Deck-E's voice**
(`deep.ts:216-220`) — it belongs in C3's expandable row, never his speech bubble.

### D2 — Interstitial narration
**Complaint:** C20. `narration.ts` is a **leak filter**, not a narration system —
no concept of tool boundaries, never emits user-facing text. None exists.

**Change: server-composed beats at the tool boundary**, keyed to the tool that
actually started (emit where `deep.ts:261` already fires
`onEvent({phase:'start'})`). Per X2 and X3 — *not* model-composed, and the
*"never end a turn with Confirm?"* clause survives untouched.

**R8:** Perplexity's engineers measured that users tolerate waits better when
shown real intermediate steps. This is evidence-backed, not decoration.

### D3 — Show web search
**Complaint:** C17. No `web_search` tool exists. The only live-web path is
`research_meta` → `openai/o3-deep-research`, which browses **provider-side**
with zero app visibility, surfaced as one opaque chip.

**Probe first:** `runSubAgent` reads only `result.textStream` and discards other
part types — check whether search progress is already on the stream. If not,
a first-party web-search tool is a **provider change** against the "US frontier
labs only" constraint (`models.ts`) — **his call**, and already spec §14.1.

### D4 — Answer the model question (C22)
`spacexai/grok-4.20-non-reasoning` (`models.ts:138`), adopted 2026-08-22 to fix
`flyTo` reliability 0/5 → 5/5. **1148ms median TTFT vs 811ms, and 7.49× the
cost**, on every turn. Plus ~90ms blocking meter round-trip (`meter.ts:24-30`)
and up to 12 sequential steps.

**Not reverting in this pass** (§6.4) — it reopens the exact regression it fixed,
and Phase E makes navigation *more* central. Measure after, with `flyTo`
re-tested. He gets the number.

### D5 — History hygiene (C25)
`DeckeHost.tsx:143-144` calls `navigate({ to })` with no `replace: true`; the
router default is push, so every page he visits becomes a history entry.

**Honest attribution:** the hiccup he saw was **almost certainly not Deck-E** —
the traced tab chain runs through `127.0.0.1:5210/auth` and a Claude.ai tab,
origins the route allowlist cannot produce. It was his own back-gesture. The
change is still correct hygiene and **matters more** once Phase E hops.

---

# 7. Phase E — Wayfinding

The flight engine, highlight ring and cross-route continuity are **complete and
correct** (R3) and need no *repair*. But two items in this phase are genuine
engine work and the preamble originally denied it: **E6** (cancel an in-flight
journey on trusted user input) and **X1's instant-arrive mode** for the reduced
-motion path. Both are additions, not fixes.

### E1 — Doctrine: distinguish intents (reverses §6.1)
`prompt.ts:528-532` currently says *"build its url and go — do not stay where
you are and flyTo something that looks related."* Deliberate, and gate 5 pins it.

**Do not delete the rule. Split it.** "Take me to it" still jumps — gate 5 keeps
passing. **"Help me find X" / "show me where X is" escorts.** New doctrine, new
gate, superseding entry. `prompt.ts:518` (*"Nobody wants to watch you click
through something you could have executed"*) is qualified.

### E2 — Document `click`
It exists and works (`tools.ts:385-396`, `uiTools.ts:245-259`, real
`el.click()`, href allowlist) but is **never mentioned in `prompt.ts`** —
verified by grep. And the landmark payload carries **no clickability
information**. A model cannot choose a capability its prompt never names.

### E3 — Mark navigational elements
`data-decke-clickable` appears on **exactly two elements app-wide**
(`SeriesIndex.tsx:397-400`, `CardDetail.tsx:596-600`) — both same-page
accordions that navigate nowhere. His choreography is **architecturally
impossible today**.

**X4 applies: widen the audit's scan root first, as its own commit.** Then mark
nav rows, series cards, set rows — each with the security review §6.5 demands,
confirming no marked element can trigger a write.

### E4 — Teach the addressing convention (superseded by E8; no sitemap graph)
**Complaint:** C34. *(Rewritten after review — E8's one-plan design supersedes
the sitemap this section originally demanded.)* The model gets `ROUTE_SHAPES` — 13 URL *templates* — and
never the sidebar's actual structure (`AppShell.tsx:90-97`). Needs a sitemap
encoding the **click path** between pages.

**Constraint (§6.8):** `LANDMARK_CAP = 40`, surplus **silently dropped with no
truncation marker**. On a 120-tile set page the nav element the next hop needs
may be dropped. Consider a priority tier above `container` for nav-critical
landmarks.

### E5 — Action rows, and the message-model change
**Complaint:** C36. Chips come **only** from the server wrapper for the 23
data/write tools. `flyTo`/`highlight`/`goTo`/`scrollToMe`/`click` are pure
client tools with **no server `execute`** — so **no chip is ever emitted for any
movement**. The transcript records nothing of a journey.

**Change:** a client-side emission path. `runUiTool` already returns
`{ok, reason}` with sayable text (`"pressed ${label}"`, `uiTools.ts:257-258`).
Needs a transient part type, a `LegHandlers` handler
(`useDeckeChat.ts:486-492`), and a renderer that **interleaves rows with prose in
occurrence order** — which the current model cannot express, because chips are
grouped per message, not ordered against text.

**This is the real structural work of the phase: the message model needs an
ordered part list, not three parallel arrays.** X2 binds it — every row is 1:1
with a real invocation.

### E6 — Cancel on user input (R8, hard rule)
Guided motion fails when it **overrides a gesture the user is mid-performing**.
Any user click or scroll mid-flight **cancels the journey**. A hard requirement
and its own gate, not a nicety.

### E7 — Brevity (C33)
The one brevity rule (`prompt.ts:543-544`) is conditioned on `travelling`, so a
direct jump gets none. E1 routes more traffic through the short path and may fix
this for free — **verify after E1–E3 rather than over-fixing now.**

### E8 — ONE journey plan, executed client-side (owner's design, supersedes the leg-budget problem)

**The owner's proposal, and it is better than a per-hop model turn:** Deck-E
emits the **whole journey as one ordered block** — speak, flyTo, highlight,
wait, click, wait, flyTo, speak … — and the client consumes it as a timeline.
One leg, not four.

**Why this works, and why it is not speculative:**

1. **Direct precedent in this codebase.** `express` already takes
   `z.array(commandSchema).min(1).max(6)` (`tools.ts:260`) — a batch of
   validated commands executed client-side by `runCommands` (`commands.ts:182`).
   A journey is that shape with navigation verbs.
2. **The selectors are already predictable from IDs the model looks up before
   moving**, which is the thing that would otherwise make a pre-planned path
   impossible:
   - `AppShell.tsx:177` — `[data-decke-nav="${item.to}"]`
   - `SeriesIndex.tsx:100` — `[data-decke-series="${s.slug}"]`
   - `SeriesDetail.tsx:26` — `[data-decke-set="${set.setId}"]`
   So given `seriesSlug: mega-evolution, setId: me05` from a data tool, the
   entire path is constructible **without having seen any of those pages.**
   This is an addressing scheme, and it is better than the "sitemap" E4
   originally proposed.

**What this deletes:** the leg-budget constraint, and with it the
measure-first task this section used to hold. Hops stop being expensive because
there are no per-hop round trips. `MAX_LEGS = 4` stops being the binding limit
on journey depth.

**What it requires:**

- **A `journey` tool** taking an ordered, capped step list. Cap it the way
  `express` caps commands — a runaway journey must not be expressible.
- **Conditional waits, never timed ones.** A fixed delay after a click is wrong
  on a slow connection. Steps wait *for a selector*, bounded —
  `travelAfterRoute` (`uiTools.ts:299-341`) already does exactly this with a
  MutationObserver capped at 6000ms. Reuse it.
- **Fail-stop with honest reporting.** If a step's element never appears, the
  sequence **stops there**, says so, and hands back to the model for a fresh
  turn. It must never continue blindly.
- **Truthful rows (X2).** Each executed step emits its real result as an action
  row. Steps never reached emit **nothing**. The transcript reflects what
  happened, not what was planned. This is the same property the chip system
  already guarantees by construction.
- **E6's cancel rule applies to the whole sequence** — one user gesture aborts
  every remaining step.
- **Reduced motion (X1) becomes trivial**: same plan, skip the flight beats,
  keep the hops, outlines and clicks. Arrive cut rather than flown.

**Hybrid, deliberately:** plan-first, and re-enter the model **only on failure.**
Navigation is deterministic once the destination is known, so per-hop reasoning
buys nothing — but a failed step is exactly the case where the model should get
another look.

#### E8.1 — The determinism premise is FALSE in two places. Both must be handled.

*(Added after review. The premise "navigation is deterministic once the
destination is known" is falsified twice in this repo, and one of them fires on
the very first page of the canonical journey, for the account the gates run as.)*

**(i) State-dependent disclosures.** On `/series`, uncollected series exist in
the DOM **only after a one-shot disclosure click** (`SeriesIndex.tsx:397-400`,
the "Show N series with no cards collected" control — one of only two
`data-decke-clickable` elements in the app). For the QA account, *every* series
is uncollected. So a pre-made plan cannot know whether the disclosure step is
needed, and **fails its wait whichever way it guesses**.

**Fix: an `ensure` step verb.** `ensure { selector, byClicking }` means "if
`selector` is absent, click `byClicking` and wait for it; if present, continue."
Idempotent by construction, and it is the general answer to any
disclosure/tab/filter gate — not a special case for this one button.

**(ii) Virtualized grids.** Card tiles are **unaddressable**: only the grid
container carries a landmark, and `GridView` virtualizes with
`@tanstack/react-virtual`, so off-screen tiles are not in the DOM at all and
wait-for-selector can **never** fire for them.

**Fix: state the addressability floor explicitly.** A journey may address
**routes, sidebar nav rows, series cards, and set rows.** It may **not** address
an individual card tile inside a virtualized grid. A journey targeting a card
ends at the set page and hands off — `goTo` the card's own route, which is a real
page and needs no tile. Extending the floor to tiles means teaching the
sequencer to drive the virtualizer, which is out of scope for this pass and
should be said out loud rather than discovered.

#### E8.2 — Sequencer wiring, which the plan left to the implementer

- **Abort.** The sequencer observes the turn's `AbortController`
  (`useDeckeChat.ts`'s `abortRef`). Stop must halt the sequence *and* the turn,
  not one of them.
- **Result schema.** Fail-stop needs a defined shape to re-enter the model with:
  which step index failed, the verb, the selector, and why (absent / timed out /
  refused / cancelled). Prose is not enough — the model has to be able to plan a
  recovery.
- **Relationship to `runCommands`' queue.** `express` already has a client-side
  command queue; the journey sequencer must define whether it shares that queue
  or runs beside it. Two independent queues driving one character is a race.
- **A held write landing mid-journey.** Decide explicitly: a journey step must
  not begin while an approval is pending.
- **Trusted events only (review finding).** "Any user click or scroll cancels"
  must key on `isTrusted` events, or the sequencer's *own* synthetic
  `el.click()` cancels the journey it is executing.
- **Route waits must not match stale DOM.** After `goTo`, waiting for a selector
  can succeed against the *outgoing* page. Wait for the route commit first, then
  the selector — `travelAfterRoute` (`uiTools.ts:299-341`) is the reference.
- **Cap the plan.** `express` caps at 6 commands; the journey cap is **10 steps**.
  A runaway journey must not be expressible.
- **No arbitrary selectors.** The journey schema takes **landmark references**,
  not free CSS. A free selector is a capability, and the landmark allowlist
  exists precisely to bound it (`uiTools.ts:73-89`).

# 8. Phase F — The approval card

> **RESOLVED — see `DESIGN-approval-protocol.md`.** Both independent reviews
> converged here: the settled card (per-row picking, per-row removal, partial
> commit) **cannot be expressed** through the current approval protocol.
> `settle()` resolves every pending approval to one shared boolean
> (`useDeckeChat.ts:159-166`); `approvalReplayPart` replays the original
> unmodified `input` (`approval.ts:162-185`); and the SDK signs
> `HMAC(approvalId, toolCallId, toolName, hashCanonical(input))` — **the input
> is cryptographically bound**, so client-side edits invalidate the signature by
> construction. That binding is the fix for a shipped bug and must not be routed
> around casually.
>
> **The design that resolves it — `(c′)+(d)+(a)`:**
> - **The server runs the dry run at hold time**, in `tool.onInputAvailable`,
>   which the SDK awaits *before* it signs. Structured rows stream as a transient
>   `data-decke-approval-preview` part keyed by `toolCallId`. No prompt change,
>   so X3 is untouched.
> - **Accept with no edits — the common case — settles the held call
>   `approved: true` down today's signed path, completely unchanged**, guarded by
>   a canonical-JSON exact-match predicate. Every existing security property
>   survives intact.
> - **Accept with edits never touches the held call's arguments.** It commits the
>   corrected batch from the browser via `/collection/batch`, **then** settles
>   `approved: false` with a `reason` built from the real response. The SDK
>   delivers that to the model as a genuine
>   `tool-result {type:'execution-denied', reason}`, so his account stays true.
>
> **The risk to own:** the edited path is correct **by discipline, not by
> primitive**. Commit-then-settle is the only ordering that keeps the transcript
> honest; invert it, or lose the leg carrying the denial, and Deck-E claims a
> corrected write that may not have landed. Pin the ordering with a test and say
> so in the DECISIONS entry.
>
> **Options rejected, with reasons — do not revisit without reading the note:**
> **(b) re-sign an edited call** is not expressible: `signToolApproval` and
> `hashCanonical` are module-internal, so it means owning a copy of an
> unversioned internal format *plus* its legacy newline variant. That is exactly
> the 2026-08-22 failure class. **(c) as originally framed** assumed an unheld
> dry run runs first — but `prompt.ts:462-469` now says *"Call the tool. The
> asking is automatic"*, and the "Preview first" sentence was **deleted on
> 2026-08-22 because it stopped him calling at all (0/15 → 21/30)**, with a test
> asserting its absence.
>
> **Six corrections from the design's own adversarial review — all verified,
> all must land** (`reviews/DESIGN-REVIEW-approval.md`; verdict: implement with
> changes, the architecture is sound):
>
> 1. **The idempotency key would have caused a production write bug.** The design
>    borrowed `ripCommit.ts:82`'s **pure-content** key, but a caller-supplied key
>    is honoured **unbucketed and unbounded** — the replay check
>    (`collection.ts:370-376`) has no time bound, and the file's own comment
>    distinguishes *"a caller that scopes its own key"* from *"the unbucketed
>    content hash"* (`collection.ts:357-360`). So the **second time a user ever
>    makes an identical correction**, `/collection/batch` returns the original
>    response with `replayed: true`, **nothing is written**, and the correction
>    reason recites last week's numbers as fresh. **Fix:** scope the key to the
>    held call — `decke-approval-${toolCallId}#${contentHash}` — plus a
>    `replayed` guard before reporting anything as applied. **No proposed gate
>    repeats an identical corrected batch, so add one that does** — nothing would
>    have caught this.
> 2. **The "signed after `onInputAvailable`" claim was checked against
>    `generateText`; this route uses `streamText`,** where signing races ahead of
>    the awaited callback. The conclusion survives only because the client asks
>    *after* the stream closes (`useDeckeChat.ts:346`). **State that invariant
>    and pin it with a test**, or a future mid-stream card render breaks it
>    silently.
> 3. **"No prompt change at all" is not available.** `prompt.ts:476-481` says
>    *"Pick the obvious variant and go… use the primary"*, which directly
>    contradicts section-2 semantics. X3 therefore applies: any wording change
>    here is re-measured with the original's route-varied methodology.
> 4. **A timed-out commit that actually landed makes "nothing was written"
>    false.** Split the outcome three ways — applied / confirmed-failed /
>    **unconfirmed** — and never assert a negative that was not observed.
> 5. **Route Path A vs B on the user's actual choices**, not on a reconstruction
>    (`isUnedited(acceptedItems(...))`), which fails toward **auto-approving a
>    struck row**. Keep canonical-JSON equality as a *throwing cross-check*, not
>    as the router.
> 6. **Gate 9's prompt names the card, not the printing**, so its held input
>    classifies as unstated and the gate goes red on Path B behaviour. Name the
>    printing, as the signed probe already does.
>
> A stronger citation than any the design used: `convertToModelMessages` turns a
> denied `approval-responded` part **directly** into
> `tool-result {type:'execution-denied', reason}` (`ai/dist/index.js:10970-10981`).
> The denial-as-truth property is load-bearing and now has a precise anchor.
>
> **A behaviour change the owner should know about:** a row that today silently
> becomes the primary printing **and is written** will, after this, be asked
> about — and not written if ignored. That is what he asked for, but it is a
> semantic change to an existing write path, not just new UI.
>
> **Second correction, same phase:** the proposed
> `variantSource: 'stated'|'defaulted'|'ambiguous'` is **insufficient**. An
> omitted variant on a multi-variant card resolves *successfully* to the primary
> (status `ok`), so it would be labelled `defaulted` and filed under "known" —
> **which is exactly the row the owner wants asked about**. Classification must
> key on **candidate count, not resolution status**: explicit → known; omitted
> with one candidate → known; omitted with several → selection required,
> regardless of what was silently resolved. Rows carry their candidate list.

**~80% built.** Server classification (`aisdk.ts:214-231`), forced dry-run
(`:342`), a **real** SDK hold verified against pinned `ai@7.0.66`, a tested
replay protocol carrying the signature (dropping it once broke every approved
write), and a dialog showing the **real dry-run summary**, never model prose.

**What's missing is the visual half**, and **OR4 defines it.**

### F1 — Segment by provenance, not by a confidence score
**No numeric meter ships.** Two sections:
1. **Cards where the variant is known** — plain rows, no interaction, per-row
   "that's wrong".
2. **"What was the variant on these?"** — inline picker per row.

**The mechanism mostly exists.** `pickVariant`
(`packages/agent-tools/src/resolve.ts:330-361`) already distinguishes explicit
`variant_id` / `variant_kind` (stated) from omitted (silently
`isPrimary ?? all[0]`), and an `ambiguous` status already returns
`variants: [...all]` — exactly the picker's data source.

**Change:** add `variantSource: 'stated' | 'defaulted' | 'ambiguous'` to the
dry-run rows.

**HARD CONSTRAINT:** a **new field**, NOT a change to `pickVariant`'s status
semantics. Other flows depend on the silent primary default; turning those into
errors is a regression outside this pass.

**Settled details:** a defaulted-but-unambiguous row (single-variant card) goes
in section 1 — nothing to ask. **`Accept` commits section 1 even if a printing
in section 2 is unpicked.** "That's wrong" wires into `onRemoveCard` — a prop
`DeckeScreen` accepts and **nothing currently passes** (a dead branch).

**Why this is right (R8):** miscalibrated AI confidence measurably degrades
decisions, and ~93% of permission prompts are approved regardless of content.
Provenance is a real fact that cannot be miscalibrated, makes uncertainty
*actionable*, and asks only where asking is warranted.

**Reuse:** `ripCommit.ts`'s resolve-then-one-atomic-batch with an idempotency key
derived from resolved items.

---

# 8b. Phase H — Control, recovery, and trust

*(New. The second review found the plan had no design for any of this, and it is
the difference between a fixed experience and a good one. Every item here maps
to a target in §0.)*

### H1 — Stop means stop, everywhere
Today `stop()` aborts the fetch. It does **not** stop a running deep tool, and it
cannot un-run a `goTo` that already committed (`useDeckeChat.ts:404` checks
`aborted` only *after* each tool returns).

**Change:** one Stop that halts the stream, the sequencer, and — where the wire
allows — signals the server to abandon the deep call. Where something genuinely
cannot be recalled, say so honestly rather than implying it stopped.

### H2 — A recovery path for every failure
Enumerated, each with a designed path back: stream loss mid-answer; tool timeout;
tool error; offline; a client tool that never ran; an approval abandoned when the
chat closes; a journey that fail-stopped. **No dead end may require a reload.**

### H3 — The timeout must stop reading as success
**Root cause:** a deep tool that hits `DECKE_DEEP_BUDGET_MS` returns its partial
text and the chip still resolves `ok`. That is exactly how the owner came to
praise *"The analyze tool timed out before it could finish reading your full
collection…"* as "a great response."

**Change:** a timed-out or partial deep call resolves as **`partial`**, renders
as visibly incomplete, and offers a retry. D1 fixed the silence; this fixes the
lie. **These are separate defects and the plan originally conflated them.**

### H3b — Two latent bugs found while designing the protocol, both verified

**(i) The consent dialog can show the wrong preview.** `previewOf()`
(`DeckeChat.tsx:173-180`) scans backwards for *the most recent finished tool
call* and shows its summary. Its own comment concedes the assumption: *"the most
recent finished tool call at the moment the question appears is, by
construction, the preview of the thing being asked about."* That is an
assumption, not a guarantee — any tool finishing after the dry run displaces it.
**Showing the wrong preview in a consent dialog is a trust defect**, and the
protocol's keyed `data-decke-approval-preview` part fixes it by construction:
keyed to `toolCallId`, it cannot show another call's result.

**(ii) Closing the chat with an approval pending hangs the turn.**
`DeckeHost.tsx:447` is `onClose={() => setChatOpen(false)}` — it does not stop
the turn and does not settle the approval. The listener that *would* settle it
(`useDeckeChat.ts:217-223`) only fires on the AbortController, which closing does
not trigger. **Verified:** the promise parks for the life of the page, `busy`
stays true, and `thinking` stays sustained. Close must settle the approval as a
denial, or explicitly keep it and say so.

### H4 — Concurrency
Decide and implement: double-send while busy; two tabs; reopening the chat with
an approval pending; a new message while a deep tool runs. Today these are
undefined, and undefined concurrency around a write path is how double-writes
happen.

### H5 — Transcript usability
Selectable and copyable text; a clear visual difference between finished and
still-running; expandable detail that stays expanded. The owner drag-selected
text on camera **three times** to diagnose problems (C60) — selection is a
diagnostic gesture here, not an afterthought.

### H6 — Empty and first-run states
The pre-first-message state is the most-seen screen in the whole feature and the
plan never mentioned it. It needs a design: who Deck-E is, what he can do, and
two or three real starting prompts drawn from the user's actual collection.

---

# 9. Phase G — Ideation

R8 §8 has **22 concrete TCG-collector use cases**, each with phrasing,
mechanism, UI surface and rationale, grounded in a competitive survey and named
community gaps. **Delivered as a menu for him to choose from — not built.** This
pass is the experience, not new features.

---

# 10. Sequencing

*(Reordered after review: the A↔B dependency was stated backwards, and the
ordered-part-list refactor was assigned to two different phases.)*

1. **X4** — widen the clickable audit's scan root. First, alone, before any
   marking.
2. **A1/A2/A3/A6/A7** — the lifecycle and expression work that does **not**
   depend on layout: kill the timer, mobile warm, scale-from-zero, gaze, emotion
   beat.
3. **B** — the shell. **Before A4/A5**, because A4 (size) and A5 (facing) anchor
   to the composer's measured rect and B1 relocates the composer. Doing A4/A5
   first strands them.
4. **A4/A5** — size and facing, now anchored to a composer that has stopped
   moving. B7's keep-out region lands here too, since it clamps the same solved
   positions.
5. **The ordered-part-list refactor** — a message model with an ordered part
   list instead of three parallel arrays. **Its own step, before C2/C3**, not
   inside E5 as originally written. Building the chip and thinking renderers
   against the old model and reworking them in Phase E is wasted work.
6. **C** — markdown (both surfaces), chips, thinking state, card rows.
7. **D** — liveness. Independent; C3 consumes its events.
8. **E** — wayfinding. Needs A5 and the part-list refactor. **E8's step
   semantics must be settled before the journey tool's schema is written.**
9. **F** — the approval card. **Blocked on `DESIGN-approval-protocol.md`.**
10. **H** — control and recovery.
11. **G** + docs, decisions, gates.

Fable reviews the code at the end.

Fable reviews this plan before any code, and reviews the code at the end.

---

# 11. Decisions to record

`## YYYY-MM-DD — Title` / `**Decided by:**` / `**Decision:**` / `**Why:**` /
`**Implications:**`, and the wiki Decision-Log in the same sitting.

1. Deck-E does not load until invited — **a restoration**, not a reversal (§6.9);
   plus OR2's accepted mobile trade.
2. The mobile scrim sits below app chrome; the fix is geometric (§6.2).
3. "Help me find" escorts; "take me to it" still jumps; gate 5 splits (§6.1).
4. Navigational elements become clickable; the audit's scan root widened; the
   per-element security review recorded (§6.5, X4).
5. Deep-tool progress is forwarded, not buffered (D1).
6. Narration is server-composed at a tool boundary; the Confirm? clause survives
   (§6.6, X3).
7. Deck-E-initiated navigation replaces rather than pushes (D5).
8. `thinking` gaze hand-edited into the committed playbook while the generator
   is broken (A6).
9. The character gets a keep-out region (§6.11).
10. The approval card segments by provenance; no confidence number (OR4).
11. Reduced-motion strategy stays per-element `motion-safe:`; beautifului.dev's
    blanket rule is **not** imported (§6.12).

Already recorded: the visual harness (commit `34d3914`).

---

# 11b. Answer quality — the instrument the plan was missing

§0's target 8 says the agent's answers are judged separately from whether his
animation looked good. The original plan had **five instruments for how he looks
and none for whether he is useful** — it would have closed every complaint and
still not known if he gives good answers about Pokémon cards.

**Good news: this is mostly extension, not invention.** Gates 3, 4, 13, 14 and
15 already assert answers against ground truth — *"the figures match the
catalogue"*, *"the completion figure matches `user_set_progress`"*, *"the panel's
ids match what the account owns"*. That is exactly the right shape.

**Change:** extend the gate suite with a small **task set** run against the QA
account's seeded fixture (`me05` "Pitch Black", 12 owned of 120 — known
ground truth, per `.qa-account`). Each task has a checkable assertion:

| Task | Falsifiable assertion |
|---|---|
| "How many cards do I have in Pitch Black?" | says 12, not a hallucinated figure |
| "How close am I to completing it?" | 10%, matching `user_set_progress` |
| "Help me find Pitch Black" | ends on `/series/mega-evolution/me05`, via real clicks |
| "What should I buy next for this set?" | every card named is really missing from the account |
| "Add one Pikachu" | preview → approval → exactly one row, right variant |

Plus two qualities that need a judge rather than an assertion, and where the
existing V4 vision judge does **not** apply — these are text, so they get a
text judge with the same discipline (falsifiable claim, `unclear` allowed):
**brevity** (a navigation answer is ≤2 lines) and **grounding** (no card named
that no tool returned — `grounding.ts` already computes this server-side).

**This is the one place I would push back on the owner's framing.** He asked for
a great *experience*. An assistant that feels wonderful and quietly misreports
your collection is worse than a plain one that is right, because the polish
buys trust the answers have not earned. This section is cheap and it is the
difference between the two.

---

# 11c. Rulings the plan was silently closing

**Q13 — does the page behind the overlay scroll?** Never actually ruled; the
plan closed it by omission. **Ruling: the scroll lock stays.** It is correct iOS
technique, it is shared with `Sheet.tsx` (`:91-123`), and the owner's complaint
(*"I'm trying to scroll and I can't"*) is caused by the **damaged ends** of the
only scrollable region — the notch-occluded top (B3) and the dead band at the
bottom (B4) — not by the lock. B3/B6 fix the symptom at its cause. Unlocking
would trade a real bug for a worse one: a scrim that slides off its own content.

---

# 12. Explicitly out of scope

- **Add-photo in the composer** (OR5) — **owner: deferred.** He wants it
  eventually; not this pass. The composer card is built so the slot exists.
- **Payload reduction** (OR2) — the 1.57 MB HDR is a later pass.
- **Reverting the chat model** (§6.4) — measure after E, don't re-litigate now.
- **Conversation persistence** (D5 in brief) — **owner: out of scope.** He wants
  a proper chat-history feature planned separately; losing a conversation on
  reload is acceptable for now.
- **Catalog/asset defects** (D16) — visible in frames, unrelated.
- **The two retired `travel_*` states** (spec §14.6) — still open, untouched.
- **Building the 22 ideas** (Phase G) — menu only.

---

# 13. Still open for him

1. ~~Add-photo~~ — **answered: deferred.**
2. ~~Conversation persistence~~ — **answered: out of scope**, to be planned as
   its own chat-history feature later.
3. ~~Leg budget trade~~ — **dissolved** by E8's one-plan design.
4. **Web search visibility** — probe first, ask only if the probe fails. See
   D3; the SDK exposes `fullStream` with `'source'` parts and `providerExecuted`
   tool flags, so the search activity may already be on the wire and simply
   discarded by `deep.ts:172`'s `textStream`-only loop. No provider change is
   proposed unless that probe comes back empty.
