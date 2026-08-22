# BRIEF.md — adversarial audit report

**Audited:** `scratchpad/deck-e-pass/BRIEF.md` rev 1, 2,077 lines, claiming 53 complaints, 9 unreported defects, 10 conflicts.
**Result:** rev 2, 2,944 lines. **+7 complaints (C54–C60), +7 defects (D10–D16), +3 conflicts (§6.11–6.13), +3 open questions (Q12–Q14), 25 `[AUDIT]`-marked corrections**, and Parts 4b and 7.6 written from R6/R9.
**Method:** transcript read line by line; every load-bearing `file:line` re-read in the repo at `209150f`; every load-bearing frame re-rendered and re-cropped; R6 and R9 read in full, plus spot-checks against the recovered `research/src/*.tsx`.

**Headline judgement.** Rev 1 is a strong document. Its transcript coverage is genuinely near-complete, its root-cause work is real, and it repeatedly refuses to over-claim (D3, D6, D8, C35 and Q8 all carry honest confidence caveats that turned out to be warranted). **It is not, however, sound enough to build from unaudited**: it contains one arithmetic error in its most-cited table, two wrong file paths, one wrong token value, two overstatements that would send an implementer at the wrong mechanism, and — most seriously — **an unreconciled contradiction between two of the owner's own asks that it states twice and never notices.**

---

## Task 1 — Transcript completeness sweep

All 237 lines read in order. **Rev 1's coverage is very good**: every want, dislike, preference, instruction and rhetorical question maps to a numbered item, including the withdrawals (C45), the mid-sentence self-correction (C8), the explicit refusals (C52's model picker), the hedges (C41), and the throwaway context (C1, C38, C49).

**What did not map. Seven items, now C54–C60.**

| # | Transcript line | What it is | Why rev 1 missed it | Now |
|---|---|---|---|---|
| 1 | **[10:11]** *"I honestly would have loved him to,* heck, my browser just, like, hiccuped…" | **A requirement destroyed mid-clause and never resumed.** | Rev 1 quotes the line inside C25 as the *lead-in to the hiccup*, treating it as narrative rather than as a truncated want. | **C54 + Q12** |
| 2 | **[00:51]** *"I just want to walk through the experience… so that you know what to fix."* | The framing statement that makes the asides binding. | Read as preamble. | **C55** |
| 3 | **[21:37]** *"I did say that earlier, **but have Deck E down here.**"* | A **second, distinct** instruction inside a quote rev 1 folds wholly into C29. | The first clause restates C29, so the second was absorbed. It is a positional instruction that C29's own fix can break. | **C56** |
| 4 | **[11:00]** *"Let's ask another thing."* | A stated intent he **abandons** — C26 derailed his own test plan. | Filler-looking. It is behavioural severity evidence for C26. | **C57** |
| 5 | **[19:55]** *"there's a lot of issues on mobile"* | His only grading of a whole section, stated **before** demonstrating any of it. | Treated as a transition. | **C58** |
| 6 | **[20:35]** *"I'll be pointing at things so you can tell what I'm pointing at."* | **An evidentiary limitation over ~25% of the recording**: the mobile source is a LetsView mirror of a physical phone, so there is **no cursor in any mobile frame**. Seven deictic references (C30, C46, C47, C48, C50, C56) rest on his voice alone. | Read as a courtesy remark. | **C59** |
| 7 | *(behavioural, 11 occurrences)* | **Drag-selecting text is his diagnostic gesture** — he grabs a thing to ask "is this text, or is this an object?" | Rev 1 records every individual drag as evidence for its own complaint; it never synthesises them into the cross-cutting rule they imply. | **C60** |

**Deliberately not registered** (checked and judged genuinely non-substantive): [00:00] "time to do some recording"; [03:36]/[06:08]/[12:36] the three prompts he types, which are context already carried inside C10/C18/C31; [09:03] "let's just wait a minute"; [18:09] "I don't know. Let's see."; [20:10] "Just one second"; [21:43] "And let's see."

**One question addressed to us that rev 1 answers rather than defers, correctly:** [10:39] *"Is that something Decky would do?"* → C25 answers **no**, with decisive frame evidence, while preserving R2's separate and real push-navigation finding. That is exactly the right handling and I found nothing to correct in it.

---

## Task 2 — R6 and R9 integrated

### Part 4b (R6)

Written from R6 **plus spot-checks against `research/src/*.tsx` directly** (I read `RecommendationCard.tsx` in full to verify R6's confidence-tier claims byte-for-byte before writing them as fact).

**New:** §4b.0.1 (MIT / Shane Levine 2026; no repo, no npm; the flight-protocol recovery; the four unpublished internal helpers with rebuild costs; `glimm` and `liveline` as pre-1.0 optional deps to skip); §4b.0.2 (the OKLCH token layer, the `color-mix` tag-theming trick, and **the shared animation vocabulary — `fade-up`, `pop-in`, `shimmer-text`, and the one grid-rows accordion used by six components** — which is the most transferable thing on that site and which no screenshot could have revealed); §4b.1 and §4b.2 given maximum depth; §4b.3b covering Thinking, Tool Chips, Task Rows, Approval Card, Streaming Text, Chat, Context Cards, Selection Actions and Loading State from source; §4b.3c (adoption verdicts mapped to complaint numbers); §4b.3d (source-vs-scribe disagreements).

**Three findings inside R6 that change the plan, not just the catalogue:**
1. **Task Rows has a failed → retried → completed arc** that the frames missed entirely (the demo's failure beat fell between captured stills). **That is the reference implementation for D2**, the brief's most important defect.
2. **Recommendation Card's confidence tiers drive the CTA's label and weight**, not just a meter — `Accept`/`Configure`/`Accept full restock`, with `signal ∈ {3,2,0}` and no bare percentage anywhere. **That is R8 §4's "coarse and behaviour-linked" recommendation already built**, and it materially answers Q7.
3. **Tool Chips' diff popover portals to `document.body` specifically so an animated/translated parent cannot corrupt its fixed-position coordinates.** DeckPal's messages, panel and character all animate. **Any hover card or expanded detail in this chat must portal out or it will drift** — a bug pre-solved.

**One place I refused to let R6 supersede rev 1, and said so in the brief.** R6 §3 states DeckPal's chips "already stream progressively via SSE… not all at once," offered as a correction. That is true of the *transport* and false of the *observation*: C18's cause is that **parallel tool use fires several `phase:'start'` events in one model step**, which `wire.test.ts:188-212` pins and `t00396.242_framechange` shows. Rev 1's PENDING banner instructed that conflicts be resolved "in R6's favour"; **following that instruction here would have deleted a correct blocker-severity root cause.** The banner is rewritten.

### Part 7.6 (R9)

Split into §7.6.1 (wire gates), §7.6.2 (the visual harness), §7.6.3 (the vision judge).

**The correction that propagates furthest:** `Emulation.setSafeAreaInsetsOverride` **works**, verified at `env(safe-area-inset-top) = 47px` **on the live page**, so R5 §7's conclusion that the mobile safe-area defects essentially require a real iPhone is now only partly true. **Every place asserting the old limitation was found and rewritten:**

| Location | Was | Now |
|---|---|---|
| **§7.4** | 4-option ranking with DevTools as a "degraded partial check" and a phone as the only faithful one | Re-ranked; the harness is **the new floor** and genuinely exercises the failing mechanism; the honest residual is named (below) |
| **C49** | "a context Chrome DevTools device emulation does not faithfully reproduce" | "this environment is now scriptable, and the mobile defects are reproducible without a phone" — with the residual |
| **§7.6 closing paragraph** | "no Playwright/e2e in the repo's own dependency tree… no CSS/layout/viewport/safe-area/scroll tests of any kind" | rewritten: safe-area behaviour is now **drivable but still not gated** |

**The residual I kept, deliberately:** the harness is **Blink, not WebKit**. `backdrop-filter` compositing under a translucent iOS status bar — which is *exactly* what C7 and C29 are asking to change — is not settled by an emulated engine. **Geometry, insets and layout are now provable in the harness; the blur's appearance is not.** Harness as gate, phone as sign-off.

**Two things I added that R9 does not contain.**
1. **R9's own file listing is incomplete.** It omits `judge-motion.mjs` (152 lines) and `lib/judge.mjs` (174 lines) — **326 lines, ~30% of the harness.** They are a vision-model judge, and its own worked examples are this brief's complaints verbatim: *"the character starts absent, scales up from nothing, then travels"* (C3), *"Which direction is the 3D character facing relative to the text input?"* (C9/C26), *"the overlay in the second image is more blurred and darker than in the first"* (C7). Documented in §7.6.3 with its credential (`AI_GATEWAY_API_KEY`, deliberately the *shared* key, not Deck-E's), its cost ($0.01–0.03/call, "do not put it in a loop"), and — the important part — **its own epistemic warning**: `assert` is for claims a human could settle in two seconds, a `fail` is a reason to go and look rather than a fact. **The acceptance bar for this pass is "a really, really great experience," which is precisely what this tool must not be asked to judge.**
2. **The harness is signed-out by construction, and almost every mobile defect lives behind auth.** Until the maintainer authorises a signed-in spec under B12, it can photograph the landing page and nothing that matters. That is a prerequisite, not a detail, and R9 mentions the authorisation without drawing the consequence.

### The Playwright correction

**Corrected globally and called out in the header.** Rev 1 did **not** repeat the error in §7.5 or §7.6.1 — both were already accurate. It surfaced only in §7.6's closing "What does not exist" paragraph. Verified positively: `decke-gates.mjs` is **2,562 lines / 126,031 bytes**, launches Chromium at `:245`/`:250`, resolves Playwright at `:50-54`; `.gate-shots/` holds **148 files, 2026-08-22 01:44 → 11:15**; **`playwright` appears in zero `package.json` files in the repo.** Only the *dependency* is absent.

---

## Task 3 — Load-bearing claims, verdicts

| # | Claim | Verdict |
|---|---|---|
| 1 | 6.9 MB automatic load; timer at `DeckeHost.tsx:166-177` | **timer VERIFIED exactly / total WRONG** |
| 2 | Two Deck-Es at `t00108.000_preclick` | **VERIFIED** |
| 3 | 61-second pixel-identical freeze | **OVERSTATED** |
| 4 | The praised reply was a tool-failure message | **VERIFIED — and understated** |
| 5 | Facing root cause + `park.test.ts:119` | **VERIFIED in substance / OVERSTATED in wording** |
| 6 | Thinking-gaze ≈ 6.8° | **VERIFIED in code / frame description WRONG** |
| 7 | `click` unmentioned in `prompt.ts`; two `data-decke-clickable` | **§5.7 OVERSTATED / C32(b) correct; two elements VERIFIED** |
| 8 | `react-markdown` + `remark-gfm` installed, `MarkdownView.tsx` exists | **VERIFIED — and incompletely applied (D10)** |
| 9 | Chip-reorder at `useDeckeChat.ts:263-278` | **VERIFIED** |
| 10 | Mobile ✕ visible, collides with battery glyph | **VERIFIED — rev 1 understated it** |

**1 — the timer is exactly as described.** `:167 if (!entitled || chromeless || phase !== 'idle') return`; `:171 requestIdleCallback(start, { timeout: 4000 })`; `:175 setTimeout(start, 1500)`. Load effect `275-406`, `setPhase('ready')` at `:375`, opacity gate at `:425`, launcher-hide comment ("two Deck-Es") at `:435`, `hidden={chatOpen}` at `:438`. One nuance: the canvas carries no `entitled && !chromeless` condition itself — the gate is the early return at **`:408`**.
**But the byte table's total is wrong.** The six model assets plus the `Decke-runtime-CFre3AQz.js` chunk (1,199,040 B — matching rev 1's figure exactly) sum to **7,104,290 B = 7.10 MB decimal / 6.78 MiB binary.** "6.9 MB" is neither. Corrected throughout, including §5.8's derived "5.7 MB" → **5.91 MB**. Also `[AUDIT]`: the `vite.config.ts` chunk pin is `:224-231`, not `:220-231`.

**2 — VERIFIED on all four sub-claims.** 3D character present bottom-right over the series grid; 2D chip present at 4K ≈(2640,1840) inside the viewport; **the chip's eyes are genuinely closed** (two short horizontal dashes plus a flat mouth mark); no chat panel anywhere in frame.

**3 — the finding is real, the word "pixel-identical" is not.** `t00531.967` vs `t00537.387`: different md5; panel-crop PSNR **51.9 dB** (sub-LSB codec noise, visually indistinguishable but not identical); **whole-frame PSNR 26.0 dB**, because the character idle-rocks throughout and a difference image lights up almost entirely on his head and body. The panel also visibly changes across the span — focus ring present at 529, absent after; all three chips drag-selected blue at 531/537; selection cleared by 590 — **all of it the owner's own doing, none of it app output.** Clocks confirmed: 12:27 PM → 12:28 PM, which alone bounds the gap to 1–120 s; **the 61.05 s precision comes from the still timestamps.** Rewritten in D1 to the defensible and stronger form: *61 seconds of zero app output, with an idle animation as the only motion — so a reader cannot distinguish "working" from "hung."*

**4 — VERIFIED verbatim**, including *"The analyze tool timed out before it could finish reading your full collection and suggesting fresh ideas, so I don't want to guess and feed you bad advice."* **And rev 1 understated it.** Rev 1 reasoned the chip *should* have rendered as `text-text-muted line-through`. Re-cropped: **no chip carries any error or strikethrough style at all** — three identical grey outlined pills, `Collection summary` → `Browse decks` → `Analyse the collection`. That forks the root cause into (a) error emitted but styled invisibly, or (b) **error never emitted**, because `deep.ts:79-82` returns partial findings labelled incomplete on budget expiry rather than being killed — which would surface as `phase: 'ok'`. **Under (b) no renderer change fixes it.** One network capture settles it; gate 7 already hooks the wire. Recorded in D2.

**5 — VERIFIED in substance, corrected in wording, and the correction changes what the bug is.** `solvePark(..., {centre:true})` returns `{position}` with no `facing` (`dom.ts:279-293`); `park.test.ts:119` asserts `assert.equal(on.facing, undefined, …)` exactly, with `:120` asserting the converse for `parkBeside`; both chat `flyTo` calls pass `centre: true` (`DeckeHost.tsx:243`, `:250`). **But rev 1 says the `??` fallback means "the boot default `+1` is simply re-asserted."** It re-asserts **`facingTarget`** — `private facing = 1` at `DeckE.ts:454`, `private facingTarget = 1` at **`:455`** — i.e. *whatever his current heading is*, and `DeckE.ts:1156-1157` says so in the code. **The defect is "facing is never decided for the chat," not "facing is forced to +1."** Two consequences now in the brief: a fix at the initialiser would be wrong and would break every non-chat caller; and the behaviour is **path-dependent**, so anyone reproducing it may find it intermittent.
**Also added at §6.7:** a third fix option rev 1 did not evaluate — `parkBeside` with an explicit `side: 'left'` already returns position, inward facing **and** a body-width margin from one existing call, which is a startlingly literal match for *"outside of the margins of the text input."* Three caveats stated (the edge exception flips on a 390 px viewport; it regresses what the mobile "well" exists for; it changes the resize re-solve branch), so it is offered as an evaluated option, not a recommendation.

**6 — the code is right, rev 1's description of the frame is wrong.** The 6.8° figure and its derivation (`gz = 1.05`, camera distance ≈8.87, `atan` → 6.8°) check out. But rev 1's evidence sentence — *"both pupils centred, gazing at the camera"* — is not what the stills show. Close crops of `t00529.107` and `t00542.791`: the **left iris is jammed against the right rim of its sclera and clipped by it**, sitting high; the **right iris** is offset right and **low**; **the two eyes do not agree vertically**. The eyes are **counter-rotating toward the viewer** while the body is turned away. Corrected in C24, because rev 1's wording sends an implementer at `aimPupil` when the actual finding is that the gaze *target* is camera-anchored. **The rim-clipping is now D14** — a possible clamp defect, and a prerequisite check for C24, since "up and away" is a *larger* pupil offset than "slightly up."

**7 — the "exactly two elements" claim is VERIFIED; the "never mentioned" claim is OVERSTATED in one place.** `data-decke-clickable` on real DOM elements: `SeriesIndex.tsx:399` and `CardDetail.tsx:599`, both same-page accordions. All other occurrences are the enforcement site (`uiTools.ts:126`), the tool description, tests, and docs/logs.
**But §5.7 says "Grep-confirmed absent from `prompt.ts` entirely."** It is not: `prompt.ts` is 617 lines and `click` occurs once, at **`:518`** — *"Nobody wants to watch you click through something you could have executed"* — prose that **argues against** what he now wants. **C32(b) states this correctly; §5.7 contradicts its own document.** Corrected. Bonus finding added: the `## Moving around` list at `:510-514` advertises only `flyTo`, `highlight`, `goTo`, while `tools.ts:437` ships five client tools — **`scrollToMe` is unadvertised too.**

**8 — VERIFIED.** `react-markdown ^10.1.0` (`package.json:25`), `remark-gfm ^4.0.1` (`:26`); `MarkdownView.tsx` is 52 lines with 17 element overrides; imported **only** by `StrategyTab.tsx:10` via `lazy()`; no sanitiser, `marked`, or DOMPurify anywhere in any manifest. **But the fix as scoped is incomplete — see D10.**

**9 — VERIFIED.** `useDeckeChat.ts:274`: `tools: [...(x.tools ?? []).filter((c) => c.id !== chip.id), chip]`. Filter-then-append, updated chip lands last. `[AUDIT]`: the handler closes at `:279`, not `:278`. **This is rev 1's own original discovery and it holds up completely.**

**10 — VERIFIED, and rev 1 understated it.** The in-app ✕ is present at the right of the title row and **actually overlaps the battery glyph in pixels** — its upper-left stroke passes *through* the battery capsule's right end and terminal nub. "Collides" is literal. "Deck" is readable, then the red iOS recording pill (12:39) covers the rest. **No gap, bar, divider or inset of any kind** between the app title row and the iOS status bar; chat content starts immediately below, clipped mid-line. Rev 1's correction of the range6 scribe stands.

---

## Task 4 — What everyone missed

**Implicit complaints, from behaviour rather than words**
- **He abandoned a test he had announced** ([11:00]) because C26 interrupted him. Behavioural severity evidence stronger than his words. → **C57**
- **He drag-selected eleven times**, always asking the same question: *is this text or an object?* → **C60**, now a cross-cutting acceptance criterion.
- **He narrated his pointing** because a mirrored phone renders no cursor — an evidentiary limitation over a quarter of the recording. → **C59**
- Rev 1 already caught the two strongest behavioural signals (the repeated window-resize demonstrating D6/D7; the four Capsules/List toggle clicks). No credit lost there.

**Frames showing defects no source registered**
- **D15 — at narrow desktop widths the chat panel's glass header lets the app's own DeckPal logo, wordmark and two toolbar buttons show through beside "Deck-E."** Two frames 43 s apart, so not a transition artifact. It is the desktop-narrow analogue of C47 with a different trigger, **it reproduces in ordinary desktop Chrome with no phone and no PWA** — making it the cheapest of the whole family to prove — and **C29's fix makes it more visible, not less.** It is also direct evidence that the glass-panel decision (§6.3) has a cost its own text never mentions.
- **D16 (out of scope, fenced off)** — two Mega Evolution sets show a **grey-on-dark-grey text fallback** where a logo should be (the lowest-contrast text on the page, so a design-system fallback failure rather than a data gap); the "Miscellaneous" series card shows **no logo and no fallback at all**; and that card reads **"SETS 2, CARDS 1 — 100%"**.
- Two candidates were **checked and dismissed**: a hard horizontal seam across Deck-E's body at `t00542.791` (falls on a 16-px macroblock row, absent in the neighbouring frame, background steps only ~2 levels — codec artifact), and an apparently truncated "ollection summary" chip at `t00343.458` (a drag-selection starting after the "C").

**Inference stated as observation, or observation as certainty**
- **C24's pupil description** — stated as observation, contradicted by the frames. → corrected.
- **D1's "pixel-identical"** — repeated from the scribe as fact, false when measured. → corrected.
- **§5.7's "absent from `prompt.ts` entirely"** — stated as grep-confirmed, false, and contradicted by C32(b) in the same document. → corrected.
- **§5.6's "a horizontal scrolling row is new layout"** — an inference about *which* layout he wants, stated as a fact about what is missing. He said *"card thumbnails **in a row down** with the names of the cards and the variant"* — **a vertical list of rows**, which is the only shape that holds a name *and* a variant per item, and is what the Recommendation Card's own alternatives drawer does. → corrected.
- **Part 6's "beautifului.dev is dark-themed"** — false; it ships both, switched by a `.dark` class. The conclusion (no light theme needed) survives; the reasoning did not, and the practical consequence — **copied components arrive carrying two palettes and must be mapped to DeckPal's ~77 semantic roles** — was missing. → corrected.
- Genuinely well-hedged and left alone: D3 (medium-high, falsifiable, with the falsification named), D6 ("root cause not established"), D8 ("probable, not proven"), C35 ("confidence LOW — explicitly unconfirmed"), C52/Q1 ("flagged as an interpretation"), and Q8's admission that the spacing he praised was never actually visible in the frames.

**Where two sources disagree and rev 1 silently picked one**
- **C46 — "the page cannot be scrolled" vs "the transcript is unreachable."** He says *"the only things that are scrolling is Deck E himself and the chat window, and that's really bad."* Rev 1 endorses R5's reading (it is the composition of C46+C47+C48+C30) without registering that the sentence also supports "I expected the page behind to scroll." That reading gets sharper once C29 keeps the mobile top chrome present and sharp. **Rev 1 is probably right and the body-lock is probably correct — but "probably" is doing work in a blocker.** → **Q13**.
- **C25 — R2 vs the range3 scribe.** Rev 1 handles this *exemplarily*: separates "could Deck-E do this?" from "did Deck-E do this?", answers no to the second with decisive evidence, and preserves the first as separately actionable. Nothing to fix.
- **R6 vs C18 on tool chips** — R6's PENDING banner would have had R6 win by default and delete a correct root cause. → banner rewritten (Task 2).

**`file:line` citations that do not check out** — 15 spot-checks planned, ~60 individual anchors actually verified.

| Citation | Problem |
|---|---|
| `runtime.ts:51` (hdr) | **Wrong path** — `character/host/runtime.ts`, not `character/decke/` (which does not exist) |
| `DeckE.ts:653` (card_back.webp) | **Wrong file** — the literal is `cardArt.ts:107` (`CARD_BACK_URL`), imported at `DeckE.ts:39` |
| `theme.css:141` = `rgb(26 23 22 / 0.75)` for `--color-overlay-scrim` | **Wrong token** — `:141` is `-strong`; the plain token is `:140`, `rgb(52 47 45 / 0.7)`. `Sheet.tsx:265` uses `-strong` |
| `apps/web/src/styles/theme.css` | **Wrong path** — no `styles/` directory; it is `apps/web/src/theme.css` |
| `decke-chat-in` "280 ms" in `theme.css:704-713` | **Overstated** — the keyframes carry no duration; three call sites use 200/220/280 ms, so editing the keyframe hits all three |
| `vite.config.ts:220-231` | Off — the pin is `:224-231`; `:220-223` is its comment |
| `DeckeHost.tsx:72-80` (dolly comment) | Off — the dolly sentence is `:72-76` |
| `useDeckeChat.ts:263-278` | Off by one — closes at `:279` |
| `DeckeChat.tsx:471-480` "`<ul>` bottom-aligned via `mt-auto`" | **Imprecise, and it matters for C50** — the container is `:471-474` and carries no `mt-auto`; it is on the two *children* (`:476`, `:480`). A fade mask attaches to the scroller, not to what it holds |
| `DeckeChat.tsx:476` (placeholder text) | Off by one — the `<p>` opens at `:476`, the text is on `:477` |
| `DeckeChat.tsx:541-548` (screen panel) | Includes the comment; the render is `:544-548` |

**Everything else verified exactly**, including all of `DeckeButton.tsx`'s warm wiring and its quoted doc comment, `STAND_DESKTOP`/`STAND_MOBILE`/`PARK_LANDMARK`, the scrim classes and z-ternary, the desktop panel geometry, the `<li>` render order, **the stale "Rendered ABOVE his words on purpose" comment at `:514` (confirmed stale — bubble at `:492-503` precedes chips at `:519-540` in a `flex-col`)**, the park landmark at `left: 10 / bottom: 6`, entitlement's dev/self-host short-circuits at `:45`/`:48`, `AppShell.tsx:271`/`:428` at `--z-chrome`, `CHANNEL_RANGE.sq`, `rig.squash.scale.set`, `flyTo`'s span, and every remaining asset-loading anchor.

---

## Task 5 — Under-explanation sweep

Items that were present but too thin to act on. All eight now deepened in place.

1. **C3 — "no scale-from-zero exists" with no note that the obvious implementation is poisoned.** Animating `characterHeightFor` → `setCharacterHeight` **dollies the camera**, so driving it toward zero pulls the camera to infinity and invalidates every solved position — the exact bug the "resize first, then solve" ordering at `:227-263` was written to prevent. Rev 1 states both facts in different sections and never joins them. Now: three candidate mechanisms with their costs, and a recommendation that the third (compose from the existing opacity fade + `boot` squash + a short `flyTo`) is the only one adding no new machinery.
2. **§6.7 — one prescribed fix, no alternatives.** Now includes the `parkBeside`-with-explicit-side option, with three named risks and a per-platform recommendation.
3. **C11 / §5.1 — a root cause and a fix that cover only half the surface.** `DeckeBubble.tsx:129` renders `{text}` raw too. → **D10**, plus the lazy-boundary problem (a suspending component in a 280 px bubble mid-flight) and the recommendation of a smaller inline subset.
4. **D4 — "root cause INFERRED, not located," with the resolving grep named but not run.** I ran it. **Four hits in the whole host directory, none of which dismisses anything.** Upgraded to "established by absence" with the search bounds stated — plus a new consequence rev 1 missed: the surviving `station` holds a **selector**, which after a user navigation may match nothing or, worse, a *different* element on the new page.
5. **C7 — "more darkened" with no target.** The token correction turns this from an arbitrary-value guess into a design-system decision: **the app's existing "serious overlay" scrim is already 75% near-black** (`--color-overlay-scrim-strong`, used by `Sheet.tsx:265`) against the chat's inline `bg-black/45`.
6. **D2 — a defect with a single assumed root cause.** Now forked into two branches with different fixes and a named way to settle it.
7. **No z-order inventory anywhere**, in a pass that reworks a scrim, a panel, a chrome relationship and a character position at once. → assembled in **D11**, with the three consequences that follow from the character sitting at z-30 above chrome at 20.
8. **No reduced-motion constraint anywhere**, in a brief whose actionable half is overwhelmingly animation. → **§6.12 / §7.9.1**, with the 19 enforcement sites, and the observation that for C3 and C32 the reduce path is a *different behaviour*, not a disabled one.

**And one thing that was missing rather than thin: §6.13.** C5 asks for a full-screen desktop takeover. C8 — stated, self-corrected, then confirmed twice — requires the header **and the full-height sidebar** to stay sharp, which rev 1's own C8 evidence frame confirms is current behaviour. **Rev 1 states both, cites the same frame for both, and never notices they conflict.** The answer decides whether the scrim covers the sidebar, what "centred" means for the composer, and whether §6.2's desktop half is being reversed. **This is the most likely thing in the brief to be built wrong, and it is one sentence from the owner.** → §6.13 + **Q14**.

---

## Could NOT verify, and why

1. **What he was about to say at [10:11] (C54).** The audio is cut off by the hiccup. No amount of frame work recovers it. **Only he can answer.** → Q12.
2. **Whether D2's failed tool ever emitted an `error` chip.** A still cannot distinguish "styled invisibly" from "never emitted," and no network capture of that turn exists. Both branches are recorded; the way to settle it (gate 7 / a `decke-signed-probe`-style probe) is named.
3. **Whether D14's iris rim-clipping is real or a codec artifact.** It is read off a re-encoded 4K still of a WebGL render. `/dev/decke?parity=1` settles it in five minutes on a live canvas; **I did not run the dev server**, because doing so is outside a read-only audit's remit.
4. **D6's root cause** (viewport-top clipping at narrow widths). Rev 1 says "not established" and that stands — no research document explains it. I can now say it is **the vertical analogue of a clamp that exists horizontally** (`dom.ts:192`) and does not exist vertically, which is a lead, not a cause.
5. **D8's tumbling lean.** Still "probable, not proven." Verifying it means driving the solver, not reading stills. **The new `judge-motion.mjs` + contact-sheet path is exactly the tool for it** (§7.6.3) and nobody has pointed it at this.
6. **D3's triple chip.** Still needs one network capture. Rev 1's reasoning (three real `toolCallId`s, not a repaint artifact) is sound and I found nothing to contradict it, but I could not confirm it either.
7. **The Claude iOS bottom spacing (Q8).** Confirmed unresolvable from these stills: the LetsView mirror's own chrome cuts off the region in every range-7 frame. Needs a fresh screenshot.
8. **Whether the visual harness actually runs on this machine.** R9's proof run is documented in detail and the files exist at the stated line counts, but **I did not execute it** — that needs a dev server, a Playwright scratch install and a live page, all outside a read-only audit.
9. **Anything behind auth in the frames.** I re-verified what the stills show. I did not sign in, did not use the QA account, and did not touch the live product.
10. **The four unpublished beautifului.dev internal helpers.** R6 read them only at their call sites; their source is not published anywhere. `ButtonVariant`'s exact union is inference. Recorded as such in §4b.3d rather than smoothed over.
11. **`res.flush?.()` at `api/chat.mjs:784`.** Rev 1 flags it as an unconfirmed silent-degrade point. It still is. Confirming it needs a running Vercel Node function, not a grep.

---

## Summary of changes to BRIEF.md

**Added:** Part 2b (C54–C60); D10–D16; §6.11–6.13; Q12–Q14; §4b.0.1, §4b.0.2, §4b.3b, §4b.3c, §4b.3d; §7.6.1, §7.6.2, §7.6.3; §7.9; a rev-2 verification table in the Appendix; a four-item addendum to Part 1.

**Rewritten:** the header source list and PENDING block; §4b.0's site facts; §4b.1 and §4b.2 (source-derived depth); §7.4 (the mobile verification ranking); §7.6's closing paragraph; C49's reproducibility note; D1's freeze statement; D2's failure branch; C24's frame evidence; D4's root cause; §6.7's fix options; §5.1's gap size; §5.6's row geometry; §5.7's `click` claim; C7's scrim tokens; C3's landmine; Part 3's and Part 6's item counts.

**Corrected in place, 25 `[AUDIT]` marks:** one arithmetic error (7.1 MB, and its 5.91 MB derivative), two wrong file paths, one wrong token line and value, one wrong directory path, six off-by-a-few line ranges, and five overstatements.

**Preserved:** every existing C, D and § number. Nothing renumbered; nothing deleted.
