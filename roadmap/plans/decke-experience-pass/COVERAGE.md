# Complaint-coverage map — BRIEF.md → PLAN.md

**Purpose.** An adversarial review found the plan carried no line-by-line proof
that it addresses what the brief requires, and spot-checks found real droppage.
This is that proof, built by reading both documents end to end. One row per
complaint (C1–C60) and per defect (D1–D16).

**Sources audited:** `BRIEF.md` (2,944 lines), `PLAN.md` (1,099 lines),
`OWNER-RULINGS.md` (OR1–OR6). Owner rulings are authoritative; something an
owner ruling puts out of scope is **correctly** uncovered.

---

## Notation

Plan items are cited as `§<section> <item>` so a reader can jump straight to
them. The plan's own section numbering:

| Anchor | Contents |
|---|---|
| `§0` | Experience targets 1–8 |
| `§1` | Verification instruments V1–V5 |
| `§2` | Cross-cutting constraints X1–X5 |
| `§3` | Phase A — presence and lifecycle (A1–A7) |
| `§4` | Phase B — the chat shell (B1–B8) |
| `§5` | Phase C — what the chat renders (C1–C6) |
| `§6` | Phase D — liveness (D1–D5) |
| `§7` | Phase E — wayfinding (E1–E8, E8.1, E8.2) |
| `§8` | Phase F — the approval card (F1) |
| `§8b` | Phase H — control, recovery, trust (H1–H6, H3b) |
| `§9` | Phase G — ideation menu |
| `§10` | Sequencing |
| `§11` | Decisions to record (1–11) |
| `§11b` | Answer-quality instrument |
| `§11c` | Rulings the plan was silently closing (Q13) |
| `§12` | Explicitly out of scope |
| `§13` | Still open for him |

**Beware the number collision.** The plan's Phase C items are named C1–C6 and
its Phase D items D1–D5; these are *not* the brief's C1–C6 / D1–D5. Every
citation below is prefixed with its plan section (`§5 C1` is the plan's markdown
item; `C11` unqualified is the brief's complaint).

**Status key.** COVERED · PARTIAL · DEFERRED · CONTEXT · DROPPED, as defined in
the audit request.

---

## Part 2 — Complaints C1–C60

| # | One-line summary | Severity | Covered by | Status |
|---|---|---|---|---|
| C1 | Recording jutter while Deck-E runs | context | — (weak corroboration for `§3 A1`) | **CONTEXT** |
| C2 | Deck-E loads on a timer, not on a click | blocker | `§3 A1`, `§3 A2`, `§11.1`, OR2, OR6 | **COVERED** |
| C3 | Absent → scale from zero → travel in | major | `§3 A3`, `§2 X1` (reduce path) | **COVERED** |
| C4 | He is too big, desktop included | major | `§3 A4` (size from the composer's measured rect) | **COVERED** |
| C5 | Full-screen takeover like Claude | major | `§4 B1`, OR1 (content pane, not viewport) | **COVERED** |
| C6 | Composer starts large/centred, drops to bottom on first send | major | `§4 B1` (centred composer), `§8b H6` (empty state) | **PARTIAL** |
| C7 | Backdrop must be far more blurred and darker | major | `§4 B2` (tokenized alpha + blur) | **COVERED** |
| C8 | Do not blur the desktop top bar | minor (already correct) | `§4 B1` ("no desktop decision is reversed"), OR1 | **COVERED** |
| C9 | He belongs just left of the text input, outside its margins | major | `§4 B1` (stands outside the composer's left edge, from its measured rect), `§3 A4`, `§3 A5` | **COVERED** |
| C10 | Chip appears first, then sits under the answer | major | `§5 C2(a)` | **COVERED** |
| C11 | Raw markdown asterisks reach the screen | blocker | `§5 C1` — **both** `DeckeChat` and `DeckeBubble` | **COVERED** |
| C12 | Thinking/loading state needs more to it | major | `§5 C3` | **COVERED** |
| C13 | Directive: study beautifului.dev and apply it | directive | `§5 C3` (Thinking, Streaming Text), `§2 X1`, `§11.11` | **CONTEXT** |
| C14 | Expandable "you can see what's going on" traces | major | `§5 C3` (expands to show step detail) | **COVERED** |
| C15 | Chip reads as a static tag; unclear if clickable | major | `§5 C2(c)` (drop the resting pill; quiet rows; visible/expandable summary; HighlightRing) | **COVERED** |
| C16 | Highlightable, but not a pill by default | major | `§5 C2(c)` | **COVERED** |
| C17 | Show when he is searching the web | major | `§6 D3` (probe first), `§5 C3` (surface), `§13.4` | **PARTIAL** |
| C18 | Chips dumped all at once; no sense of process | major | `§5 C2(d)`, `§6 D1`, `§6 D2` | **COVERED** |
| C19 | It hangs and he starts doubting it works | blocker | `§6 D1`, `§8b H3`, `§0` targets 1–2 | **COVERED** |
| C20 | Interstitial narration between tool calls | major | `§6 D2` (server-composed at the tool boundary), `§2 X2`, `§2 X3`, `§11.6` | **COVERED** |
| C21 | Break up thinking with brief expression changes | minor→major | `§3 A7` | **COVERED** |
| C22 | Which model is running, and why is it slow | minor (high value) | `§6 D4` ("he gets the number") | **COVERED** |
| C23 | Chips read as intent, not current state | major | `§5 C2(b)` (preserve first-seen order), `§5 C2(d)` | **COVERED** |
| C24 | Thinking gaze should be up and away | minor | `§3 A6` | **COVERED** |
| C25 | Browser hiccup / apparent back-navigation | context + major (push-nav gap) | `§6 D5` (`replace: true`, with honest attribution), `§11.7` | **COVERED** |
| C26 | He faces the wrong direction, both platforms | major | `§3 A5` (`facing?: number` on `FlyOptions`, honoured under `centre:true`) | **COVERED** |
| C27 | On desktop he is in a totally wrong spot | major | `§3 A5`, `§4 B1` | **COVERED** |
| C28 | Responsive-width demonstration | context | produces D6/D7 → `§4 B7` | **CONTEXT** |
| C29 | Keep mobile top chrome unblurred; move panel below it | major | `§4 B2` (geometric top offset), `§4 B7` (keep-out), OR1, `§11.2` | **COVERED** |
| C30 | Mobile composer too close to the bottom; needs chrome | blocker | `§4 B3`, `§4 B4`, `§4 B5` | **COVERED** |
| C31 | The navigation did not happen the way it should have | major (umbrella) | `§7 E1`, `§7 E8` | **COVERED** |
| C32 | Hop link to link, outline and click, not teleport | blocker | `§7 E1`, `§7 E2`, `§7 E3`, `§7 E8`, `§7 E8.1`, `§2 X4`, `§11.3`, `§11.4` | **COVERED** |
| C33 | Response far too long for a navigation request | major | `§7 E7` ("verify after E1–E3 rather than over-fixing now") | **PARTIAL** |
| C34 | He needs the nav position and the site map | blocker | `§7 E4`, `§7 E8` (addressing scheme supersedes the sitemap), `§7 E8.1`, `§7 E2` | **COVERED** |
| C35 | The transition into "big" was not a smooth animation | minor→major | `§3 A3` (entry beat) | **PARTIAL** |
| C36 | Transcript should record structured action rows, interleaved | major | `§7 E5`, `§10.5` (ordered-part-list refactor as its own step), `§2 X2` | **COVERED** |
| C37 | Desktop composer goes bottom-centre, mirroring mobile | major | `§4 B1`, OR1 | **COVERED** |
| C38 | Praise: this feedback round is more targeted | context | — | **CONTEXT** |
| C39 | Ad-hoc screens: the concept and a use case | feature direction | `§5 C4`, `§5 C5` | **COVERED** |
| C40 | Present the ad-hoc screen as a compact inline widget | major | `§5 C4` (inline card rows), `§5 C5` (compact/preview modes) | **COVERED** |
| C41 | Chips should possibly lead to the ad-hoc screen | nice-to-have (hedged) | — | **DROPPED** |
| C42 | Recommendation Card: "want me to put these cards in?" | major | `§8` (protocol), `§8 F1`, `§5 C4`, OR4, `§11.10` | **COVERED** |
| C43 | He likes the confidence indicator | nice-to-have | `§8 F1` + OR4 (provenance, no numeric meter) | **COVERED** |
| C44 | Directive: mine beautifului.dev; invent domain use cases | directive | `§9` (22 ideas delivered as a menu, not built) | **CONTEXT** |
| C45 | Withdrawn verbosity complaint — brevity proportional to request | context | `§7 E7` (does not record the boundary) | **CONTEXT** |
| C46 | Mobile: the page cannot be scrolled at all | blocker | `§4 B6`, `§4 B3`, `§4 B4`, `§11c` (Q13 ruling: the lock stays) | **COVERED** |
| C47 | Deck-E header and ✕ render inside the iOS status bar | blocker | `§4 B3`, `§4 B2` (panel top offset) | **COVERED** |
| C48 | Content cut off at the top with no way to reach it | blocker | `§4 B3`, `§4 B6` (stick-to-bottom only when near bottom) | **COVERED** |
| C49 | He is in installed-PWA mode | context | `§1 V3` (CDP safe-area override), `§1 V5` | **CONTEXT** |
| C50 | Claude iOS is the spacing/fade/card reference | major | `§4 B5` (mask fade, card, approval as its own card), `§4 B3`, `§1 V5` for the number | **COVERED** |
| C51 | Does not like the input design; steal the Prompt Bar | major | `§4 B5` (composer becomes a card) | **PARTIAL** |
| C52 | Keep it simple: no model picker, a `+`, photo attach | major | `§4 B5` (no picker; slot built), OR5 + `§12` (photo deferred) | **COVERED** |
| C53 | Directive: how the work should be run | directive | `§10`, plan preamble ("Fable reviews this plan… and the code at the end") | **CONTEXT** |
| C54 | The requirement lost mid-sentence at [10:11] | unknown | `§3 A7` + OR3 (emotion beat at thinking→answering, as *probable*) | **COVERED** |
| C55 | Framing: the walkthrough *is* the fix list | context | — | **CONTEXT** |
| C56 | "have Deck-E down here" — a distinct mobile positional instruction | minor request / major regression risk | `§4 B2` item 4 (named verification assertion) | **COVERED** |
| C57 | A stated intent he abandoned mid-test | context | — (severity signal for C26) | **CONTEXT** |
| C58 | "there's a lot of issues on mobile" | context | — | **CONTEXT** |
| C59 | No cursor in any mobile frame; deixis rests on voice | context | `§1 V5` (owner confirms on hardware) | **CONTEXT** |
| C60 | Drag-selecting is his diagnostic gesture — a design rule | major | `§5 C2(c)` (pill chrome only where pressable), `§8b H5` (selection is diagnostic) | **COVERED** |

### C-column totals

COVERED **42** · PARTIAL **5** · DEFERRED **0** · CONTEXT **12** · DROPPED **1**

---

## Part 3 — Defects D1–D16

| # | One-line summary | Severity | Covered by | Status |
|---|---|---|---|---|
| D1 | 61 s of zero UI output during a deep-tool call | blocker | `§6 D1` (forward progress off `deep.ts:172-174`), `§0` target 2, `§11.5` | **COVERED** |
| D2 | The "great response" was a tool-failure message | blocker | `§8b H3` (timeout resolves `partial`, renders incomplete, offers retry), `§5 C2(c)` | **PARTIAL** |
| D3 | A suggestion chip rendering 2–3× identically | minor | — | **DROPPED** |
| D4 | A stale response bubble stays pinned after navigating away | major | — | **DROPPED** |
| D5 | Reopening after a reload loses the conversation | major (gap) | `§12` — "owner: out of scope", to be planned as its own chat-history feature | **DEFERRED** |
| D6 | Deck-E clipped by the viewport top at narrow widths | major | `§4 B7` (the missing vertical clamp) | **COVERED** |
| D7 | Deck-E overlaps the PWA "Install" pill | major | `§4 B7` | **COVERED** |
| D8 | Visibly tilted / tumbling animation on close and reopen | minor | — | **DROPPED** |
| D9 | "No visible relaunch icon" — investigated and dismissed | dismissed | brief itself; no plan work required | **CONTEXT** |
| D10 | The speech bubble renders raw markdown too | major | `§5 C1` (explicitly names `DeckeBubble.tsx:129`) | **PARTIAL** |
| D11 | The canvas paints above app chrome | major (constraint) | `§4 B7` incl. the launcher-chip `z-20` note, `§11.9` | **COVERED** |
| D12 | After the C2 fix mobile has no warm-on-intent path | major | `§3 A2` + OR2 (tap-and-wait; arrival animation covers it) | **COVERED** |
| D13 | The chat has no accessibility story | major | `§5 C6` ("every new control ships its role/label/focus handling") | **PARTIAL** |
| D14 | The iris is clipped by the sclera rim during `thinking` | minor (prerequisite check) | `§3 A6` ("Also fix D14") | **PARTIAL** |
| D15 | Narrow-desktop chat header collides with the app header | major | `§4 B8`, and mechanically `§4 B2`'s panel top offset | **COVERED** |
| D16 | Catalog/asset defects visible in frames | out of scope | `§12` — "visible in frames, unrelated" | **DEFERRED** |

### D-column totals

COVERED **6** · PARTIAL **4** · DEFERRED **2** · CONTEXT **1** · DROPPED **3**

---

## 1. The DROPPED list, with an opinion on each

Four items are actionable, not deferred by any ruling, and covered by nothing in
the plan.

### D4 — A stale response bubble stays pinned on screen after navigating away *(major)*

**Add it. This is the one that matters.** The brief establishes the root cause
by exhaustive absence: there is **no route-change subscription anywhere in the
character host** that touches `open`, `minimised`, `travelling`, the bubble text,
or the station. `DeckeHost` is mounted once above the route tree and deliberately
survives navigation — correct — but nothing reacts when the route changes under a
piece of transient chat presentation. The bubble, the minimised bar and the
parked station all just stay. Worse, `this.station` holds a **selector** for an
element on the page he left; after a route change that selector may match nothing
or, worse, match a *different* element on the new page, and the re-solve will
happily park him beside it.

The plan searched for this and did not find it: `§7 E8.2` contains "Route waits
must not match stale DOM" — the *sequencer's* version of exactly this bug — and
stops there. It never generalises to user-initiated navigation, which is the case
the brief documented on camera.

And the plan makes it worse by design. The brief's own note reads: *"It will get
much worse under C34's escorted journeys, where route changes become routine
mid-turn."* Phase E is the largest new feature in the pass and its entire
mechanism is repeated route changes. Shipping E8 on top of a host that never
reacts to a route change means every fail-stop, every cancel (`§7 E6`), and every
user gesture that wins mid-journey leaves a stale bubble and a stale station
behind. The brief rated this major on the *pre-Phase-E* codebase. Post-E it is a
blocker in everything but name, and it is the single most defensible addition to
the plan.

**Recommended home:** a Phase B or Phase E item — a route-change subscription in
`DeckeHost` that clears transient presentation (bubble text, minimised bar) and
invalidates an element-kind station whose selector no longer resolves. It is
small, it is well-diagnosed, and `§7 E8.2` already establishes the pattern.

### D3 — A duplicated suggestion chip rendering 2–3× identically *(minor)*

**Fine to leave as work, but the plan should have kept the probe.** The brief's
severity is right — visually minor. But the brief does something the plan
discards: it rejects both scribes' "repaint artifact" reading and offers a
falsifiable alternative (three genuine `toolCallId`s from three real calls, e.g.
`set_progress` once per set), then says *"Recommend confirming before designing
around it, because the fix differs completely"* — a renderer-side grouping
treatment versus a prompt change. `§5 C2` redesigns the entire chip surface and
never asks the question, so whoever builds C2 will make an implicit choice about
repeated calls to the same tool without knowing which one they made. The cost of
keeping it is one line in `§5 C2`: "group repeated calls to the same tool; a
network capture settles whether that is one call rendered thrice or three real
calls." Leave the visual fix out; do not leave the question out.

### D8 — Tilted / tumbling animation on close and reopen *(minor)*

**Genuinely fine to leave, and the brief's own severity is right.** The brief
labels the root cause *"probable, not proven"*, identifies it as the authored
flight lean (`flight.ts:101`, acceleration-driven, deliberately asymmetric), and
predicts *"likely changes character once C3 and C9/C27 land"* — that is, once he
travels a much shorter distance to a composer-adjacent stand point. `§3 A3` and
`§3 A5` land exactly those changes. So this is a symptom the plan's other work
plausibly dissolves, and re-tuning an authored motion profile before that work
lands would be optimising against a distance that is about to change. The
honest gap is that nobody has been told to *look* afterwards. One line in `§1
V4`'s assertion set — "is the character's body roughly upright through the
close/reopen flight?" — buys the check for free.

### C41 — Chips leading to the ad-hoc screen *(nice-to-have, explicitly hedged)*

**Fine to leave as a feature. Not fine to leave as a silently closed question.**
He hedged it himself — *"That maybe is overkill for what deck E does, but it's an
interesting thought"* — and the brief routed it to **Q6**, warning that Task Rows
overlap heavily with the Thinking component (C14) and structured action rows
(C36), and that *"building all three risks three competing progress surfaces."*
That warning is live: the plan builds `§5 C3` (thinking with step detail) **and**
`§7 E5` (action rows) **and** `§5 C2` (restyled chips) — three progress surfaces —
and never states how they relate. The plan's `§13` "Still open for him" lists four
questions and Q6 is not among them; it was closed by omission, which is precisely
the failure mode `§11c` was created to stop. The right fix is not to build C41.
It is to add one sentence to `§5 C3` or `§7 E5` saying which surface owns
progress and what the other two are for, and to restore Q6 to `§13`.

---

## 2. The PARTIAL list, with what specifically is missing

### D2 — the failure that fooled the owner *(blocker)*

`§8b H3` is correct and important: a timed-out deep call must resolve `partial`,
not `ok`. That closes the brief's fork **(b)**. Fork **(a)** — *"the error phase
was emitted and its styling is simply too quiet to see"* — is closed by nothing.
`§5 C2(c)` moves in the opposite direction: it makes chips *quieter* ("drop the
resting pill; quiet inline rows"). No plan item states R8 §3's rule, which the
brief quotes twice: **failure is the deliberate exception to collapse-by-default
— loud, auto-expanded, with a retry.** *Missing:* a failure-state specification
in `§5 C2` — what an `error` and a `partial` row look like, that they are not
subject to the quiet-row treatment, and that they auto-expand. Today the plan
would ship a *more* subdued surface for the exact frame in which the owner missed
a failure.

### D10 — markdown in the speech bubble *(major)*

The plan gets the important half right and names `DeckeBubble.tsx:129`
explicitly. What it does not resolve is the design decision the brief says is
*"not just an import"*: `MarkdownView` is `React.lazy()` precisely to keep ~40 KB
gz out of the main bundle, and **a lazy component inside a 280 px bubble that
appears mid-flight will suspend, with no fallback designed for that.** The brief
offers two answers — one hoisted, already-resolved lazy boundary shared by both
surfaces, or a deliberately smaller inline subset for the bubble (bold, italic,
code, line breaks) — and says the second is probably right. `§5 C1` says only *"a
chat-tuned variant wired into both surfaces, lazily"*, which restates the problem
as the solution. *Missing:* which of the two, stated.

### D13 — accessibility *(major)*

`§5 C6` is two sentences and covers exactly one of the brief's three findings:
new controls ship their roles and labels. *Missing:* (1) **the transcript is not
a live region** — there is no `aria-live` in `DeckeChat.tsx`, while the *minimised
bubble* is `role="status" aria-live="polite"`, so the small surface announces and
the main one does not; (2) **`role="dialog" aria-modal="true"` with no focus trap
and no focus restore** — the assertion that the rest of the page is inert is
false for focus; (3) the chip result living only in a native `title` attribute
(this one *is* dissolved as a side effect of `§5 C2(c)`, but only if built as real
labelled controls). Items (1) and (2) are pre-existing gaps, not obligations
created by new controls, so "every new control ships its role/label/focus
handling" does not reach them.

### D14 — iris clipped by the sclera rim *(minor, but a prerequisite)*

`§3 A6` says "Also fix D14" and then, four lines earlier, says **"Do not touch
`GAZE_GAIN`/`PUPIL_ROAM`."** Those are the same two constants the brief names as
the probable cause — *"either the roam limit is too generous for a head at ~30°
yaw, or the clamp is applied in a frame that does not account for the head's
rotation."* The plan therefore commits to a fix and forbids the likeliest
mechanism in the same item, without noticing. *Also missing:* the brief's
ordering requirement — *"If the clamp is already at its limit, C24's fix will
make D14 worse. Check this before authoring the new beats, not after"* — and its
method (`/dev/decke?parity=1` plus `?diag=1`, explicitly **not** from a
screenshot). `§3 A6`'s V4 assertion covers gaze direction only; nothing asserts
the iris.

### C6 — the empty-state composer *(major)*

`§4 B1` gives "a centred composer" and `§8b H6` designs the empty state's
*content* (who Deck-E is, what he can do, two or three real starting prompts
drawn from the user's collection). *Missing:* the actual ask — the Claude
home→conversation transition, where a **large, vertically centred** composer
**drops to the bottom once you type**. Nothing in the plan describes a
composer that changes position between the empty and active states, and nothing
says whether "centred" in `§4 B1` means horizontally centred at the bottom or
vertically centred in the pane. This is also the ambiguity that makes C37's row
worth re-reading: the plan never writes the word "bottom" about the desktop
composer at all.

### C17 — showing web search *(major)*

`§6 D3` is a probe and `§13.4` is an open question; `§5 C3`'s label cycling
(*"Searched the web"*) is the surface that would render it. That is a reasonable
sequence. *Missing:* what happens on either branch. If the probe finds `'source'`
parts and `providerExecuted` flags already on `fullStream`, no plan item owns
rendering them — `§5 C3` is modelled on beautifului.dev's labels, not on
DeckPal's `research_meta`. If the probe comes back empty, the plan's only stated
next step is asking him, with no scoped alternative. A major-severity complaint
currently resolves to "probe, then decide."

### C33 — the over-long navigation answer *(major)*

`§7 E7` reasons that E1 routes more traffic through the already-short bubble path
and may fix this for free, then says *"verify after E1–E3 rather than
over-fixing now."* That is the brief's own recommendation and it is sound as
sequencing. *Missing:* what happens if the verification fails. There is no
committed fallback — no brevity rule for a non-`travelling` turn, which is
exactly the hole `prompt.ts:543-544` leaves. *Also missing:* C45's boundary. The
owner **withdrew** a verbosity complaint for a deck-ideas answer, and the brief
records it as a scope boundary: brevity proportional to the request, not
terseness everywhere. `§7 E7` does not carry that boundary forward, so an
implementer over-fixing C33 has nothing telling them where to stop.

### C35 — the transition into "big" *(minor→major)*

`§3 A3` addresses the **chat-open** entry beat (absent → scale 0→1 → travel), and
that is real work. But C35's frames are the **navigation** jump: he was already
open and beside the panel, and became large and centred over a loading spinner.
The brief's (low-confidence) root cause is a `goTo`-driven `travelAfterRoute`
flight forced `via: 'background'`, a 24–27 unit depth change played at ~2.95×,
compounded by the panel minimising entirely. `§3 A3` touches none of that.
*Missing:* the brief's explicit instruction — *"R3 §7 item 7 recommends
re-testing this after C32 lands, since the flight profile changes completely if
the destination is reached by same-depth hops"* — is not a plan item anywhere,
even though `§7 E8` is precisely the change that would alter the profile.

### C51 — the composer's input design *(major)*

`§4 B5` makes the composer a real card with a real surface, a shadow, and a
transcript fade mask. That answers C50. It does not answer C51, which is a
different complaint: *"I don't love the design of the input at all… this is
something we should definitely steal from beautiful UI.dev… Prompt bar."* The
string "Prompt Bar" does not appear in `PLAN.md`. The brief devotes its single
largest component section to it (§4b.1, "MAXIMUM DETAIL", from a recovered
30,976-byte source) and `§4b.0.2` warns that copied components arrive carrying
two palettes of tokens that must be mapped onto DeckPal's ~77 semantic roles
rather than pasted. *Missing:* the input itself — multiline auto-grow behaviour,
the control-row layout inside the card, resting/focus/typing states, and which
Prompt Bar affordances are in versus out (Q1's `@`-mentions and `/`-commands
reading is never confirmed or closed). `§4 B5` is load-bearing for C50, C51, C52,
C6, C37, `§4 B4`'s fix and the rects that `§3 A4` and `§3 A5` anchor to — and it
is two paragraphs long.

---

## 3. Coverage statistics

### All 76 items

| Status | Count | Share |
|---|---:|---:|
| COVERED | 48 | 63% |
| PARTIAL | 9 | 12% |
| DEFERRED | 2 | 3% |
| CONTEXT | 13 | 17% |
| **DROPPED** | **4** | **5%** |
| **Total** | **76** | |

Of the 76, **61 are actionable** (excluding the 13 CONTEXT rows and the 2 the
owner or the plan put out of scope). Against that denominator: COVERED 79%,
PARTIAL 15%, DROPPED 7%.

### Restricted to blocker and major

Counting the brief's own severity lines. Blockers: C2, C11, C19, C30, C32, C34,
C46, C47, C48, D1, D2 (**11**). Majors, including the two rated "minor-to-major"
(C21, C35) and C56 rated "major as a regression risk": C3–C7, C9, C10, C12,
C14–C18, C20, C21, C25, C26, C27, C29, C31, C33, C35–C37, C40, C42, C50, C51,
C52, C56, C60, D4, D5, D6, D7, D10, D11, D12, D13, D15 (**40**). Total **51**.

| Status | Blocker | Major | Total |
|---|---:|---:|---:|
| COVERED | 10 | 33 | 43 |
| PARTIAL | 1 (D2) | 7 (C6, C17, C33, C35, C51, D10, D13) | 8 |
| DEFERRED | 0 | 1 (D5) | 1 |
| **DROPPED** | **0** | **1 (D4)** | **1** |
| **Total** | **11** | **41** | **51** |

**No blocker is dropped.** One blocker (D2) is partial. **Nine** blocker-or-major
items are DROPPED or PARTIAL.

Both dropped minors (D3, D8) and the dropped nice-to-have (C41) are survivable as
*work*; as argued above, two of the three should still leave a one-line residue
in the plan (a probe for D3, a V4 assertion for D8, a restored Q6 for C41).

---

## 4. The thirteen conflicts, §6.1–§6.13

Verified against the plan and the rulings. "Addressed" means a plan item or a
ruling actually resolves it; "mentioned" means the plan names it without closing
it.

| § | Conflict | Where it is resolved | Verdict |
|---|---|---|---|
| 6.1 | Jump straight to the canonical URL (reverses C32) | `§7 E1` splits the rule rather than deleting it; gate 5 keeps passing; a new escort gate supersedes. Recorded as `§11.3`. | **Addressed + recorded** |
| 6.2 | Mobile chrome recedes behind the scrim (reverses C29) | `§4 B2` — geometric top offset `calc(64px + env(safe-area-inset-top))`, explicitly *not* a z-index swap; OR1 makes it "mobile matches desktop". Recorded as `§11.2`. | **Addressed + recorded** |
| 6.3 | The phone panel is glass with no background (partially reverses C30, C50) | `§4 B5` settles it — panel stays glass, composer becomes an opaque card; the approval block becomes its own card with a gap, which is the sub-question §6.3 raises. | **Addressed, NOT recorded** — no `§11` decision entry exists for it, though §6.3 says a clarifying entry must be written. The remaining sub-question — *what surface fills the strip between the composer card's bottom edge and the home indicator* — is only implied by `§4 B3`'s `padding-bottom: max(…)`, never stated. |
| 6.4 | The chat model was swapped to a slower, costlier one | `§6 D4` + `§12` — not reverted in this pass, measure after with `flyTo` re-tested; OR5 carries it forward. | **Addressed** (deliberately deferred, with the reason and the re-measurement stated) |
| 6.5 | Pointable ≠ pressable; "never a write" is review discipline | `§2 X4` widens the audit's scan root first, as its own commit; `§7 E3` marks elements "each with the security review §6.5 demands". Recorded as `§11.4`. | **Addressed + recorded** |
| 6.6 | The prompt was rewritten to stop the model asking first | `§2 X3` + `§6 D2` (server-composed narration) + `§8`'s protocol ("no prompt change, so X3 is untouched"). Recorded as `§11.6`. The brief calls this the highest-risk conflict; the plan treats it as such. | **Addressed + recorded** |
| 6.7 | A centre park must leave facing to the caller (constrains C26) | `§3 A5` honours the landmine correctly — do not change `solvePark`; add `facing?: number` to `FlyOptions`. | **MENTIONED ONLY.** Three things §6.7 demands are absent: (a) the `[AUDIT]` third option — `parkBeside` with `side:'left'` against the composer rect, which the brief argues *"collapses C9, C26 and C27 into one change"* — is never evaluated or rejected; (b) the three checks it attaches to that option (the edge exception flips him to the far side on a 390 px viewport; centre parking exists *because* `parkBeside`'s gap pushes him out of the mobile well; `parkBeside` re-solves on every resize/scroll) are unaddressed; (c) §6.7's stated requirement — *"which mechanism was chosen **per platform**, why the two differ if they do"* — has no `§11` decision entry. Given `§4 B1` positions him "from its measured rect", the plan is implicitly choosing per-platform mechanisms without saying so. |
| 6.8 | The landmark cap is 40, silently truncated (constrains C34) | `§7 E4` states the constraint and says *"Consider a priority tier above `container` for nav-critical landmarks."* | **MENTIONED ONLY.** "Consider" is not a decision. §6.8 asks three questions — does the cap change, does truncation become visible to the model, do nav-critical landmarks get a priority tier — and the plan answers none. `§7 E8` reduces the pressure (no per-hop round trips) but does not remove it: journey steps take **landmark references**, so a nav element silently dropped from the 40 is still a step that can never resolve. No `§11` entry. |
| 6.9 | Two decisions the C2 fix RESTORES | `§3 A1` states both restorations and the `advancedChunks` landmine. Recorded as `§11.1`. | **Addressed + recorded** |
| 6.10 | Chips are emitted from the server wrapper, never by the model | `§2 X2` binds every new row to a real invocation and extends gate 7; `§7 E5` builds the client-side emission path under that constraint. | **Addressed, NOT recorded** — §6.10 asks for an entry saying the client-tool row type is server-of-record in the same sense and that gate 7 is extended. `§11`'s eleven entries contain no such item. |
| 6.11 | The character deliberately paints above the app chrome | `§4 B7` — the keep-out region, chosen as §6.11's recommended option 1, resolving C29, D6, D7 and D11 with one mechanism, plus the launcher-chip `z-20` note (§6.11's third sub-question). Recorded as `§11.9`. | **Addressed + recorded** |
| 6.12 | `prefers-reduced-motion` is an enforced convention | `§2 X1` — per-element `motion-safe:`, the named reduce paths for C3/C32/C50, and the finding that **no `prefersReducedMotion` read exists in the engine**, with an instant-arrive work item. Recorded as `§11.11`. | **Addressed + recorded** — and it is the plan's strongest conflict closure, since it adds a capability the brief only implied was needed. |
| 6.13 | "Full-screen" (C5) vs "leave the top bar sharp" (C8) | OR1 rules it directly — the scrim covers the content pane only; header and full-height sidebar stay sharp; C8 wins on the letter, C5 on the feel. `§4 B1` implements it. | **Addressed by ruling** — this was the brief's "most likely thing to be built wrong" and it is now settled. One residue: OR1 says "a centred composer" without settling *vertically* centred versus bottom-centred, which is C6's PARTIAL. |

**Summary:** 9 of 13 addressed and recorded, 2 addressed but with no `DECISIONS.md`
entry planned (§6.3, §6.10), and **2 merely mentioned** (§6.7, §6.8). §6.7 is the
more serious of the two — it is a live design fork sitting under `§3 A5` and
`§4 B1`, both of which are in the plan's critical path.

---

## 5. Cross-cutting observations

Three patterns show up more than once and are worth stating separately from the
rows.

**a. The plan is strongest where a ruling exists and weakest where a question was
closed by omission.** Every conflict OR1–OR6 touches is cleanly resolved. The two
merely-mentioned conflicts (§6.7, §6.8) and three of the four DROPPED items (C41,
D3, D8) share one shape: the brief asked a question, recommended settling it
before designing, and the plan proceeded without recording an answer. `§11c`
exists precisely because the plan was caught doing this once (Q13); the same
habit is still present in at least four other places. **Q6 is missing from `§13`
entirely.**

**b. Three progress surfaces are being built with no stated relationship.**
`§5 C2` (restyled chips), `§5 C3` (thinking with expandable step detail) and
`§7 E5` (interleaved action rows) all render "what is happening right now", and
`§6 D2` composes narration prose into the same region. The brief warned about
exactly this under Q6. Nothing in `§10`'s sequencing or in the phases themselves
says which surface owns what.

**c. `§4 B5` carries far more weight than its length.** It is the named coverage
for C50, C51, C52, part of C6 and C37, the fix mechanism for `§4 B4`, the
approval card's container, and the source of the measured rect that `§3 A4`
(size) and `§3 A5` (facing) both anchor to — and `§10` orders Phase B *before*
A4/A5 for that reason. Two paragraphs of specification is thin for a component
that much depends on, and it is where the Prompt Bar work (C51) has to live.

---

## 6. Verdict

The plan is honest, well-cited, and closes 79% of the brief's actionable items
outright. It drops **no blocker**. But the exercise found what it was created to
find:

- **D4 is a real, major, undefended drop**, and Phase E is the thing that makes it
  worse.
- **D2's failure styling** is a blocker-severity half-fix, and the plan currently
  pushes the surface in the *wrong direction* for it.
- **`§4 B5`** — the composer — is underspecified relative to how much of the pass
  depends on it, and C51's Prompt Bar, the brief's single most detailed component
  study, is not referenced anywhere in the plan.

Fixing those three is a day of planning, not a phase of work, and all three are
cheaper before implementation than after.

---
---

# PART II — IMPLEMENTATION-STATUS AUDIT

*(Added 2026-08-22, after the pass. Everything above this line is the
**pre-implementation** map: it traces each complaint to a PLAN item and its
columns are about **intent**. That work stands and is not revised here.*

*This half asks the different question: **did the code that now exists actually
close the complaint?** It was produced by reading the branch's diffs and the
files themselves, not the commit messages — the commit messages are the claims
under test. `README.md` §8 requires this file to be updated as each phase
closes; it was not updated once during implementation, which is the process gap
that made this audit necessary.)*

**Scope audited:** `decke-experience-pass` against `main` — 15 commits, 103
files, +27,870/−518. Product code: `apps/web/src/character/**`,
`apps/web/src/{theme,premium}.css`, `apps/web/src/components/AppShell.tsx`,
`apps/web/src/routes/{SeriesIndex,SeriesDetail,Scan,deck/MarkdownView}.tsx`,
`apps/api/src/decke/**`, `api/chat.mjs`, `packages/agent-tools/src/**`.

**Revision 2 — re-audited at `0d64f6c`, sixteen commits after `12f71b3`.**
Revision 1 read the code at `12f71b3`. That commit is also the one that *added
this file*, and it carried fixes for four things the audit had just found — so
several rows below described code that stopped existing in the same commit that
recorded it. Sixteen commits have landed since. Every row revision 1 marked
**NOT SHIPPED** or **PARTIAL**, and every gap it ranked in §II.6, has been
re-read against `0d64f6c`. Rows still marked **SHIPPED** were not re-read: their
`file:line` citations were taken at `12f71b3`, and `DeckeChat.tsx` has since
grown 154 lines and `useDeckeChat.ts` 217, so a citation into either may be off
by up to that much. **The statuses are unaffected; only the numbers drift.**
Rows this revision touched carry citations taken at `0d64f6c`.

**Three workstreams were editing this checkout while revision 2 was written**,
and `git status` moved twice during it — see II.0(e) for what was in flight and
what it means for four of the rows. Where a row's outcome depends on
uncommitted work it says **in progress at time of audit** rather than recording
a guess as a fact.

---

## II.0 What "verified" can and cannot mean in this repo

Four limits bound every row below. They are not caveats; they decide which
status an item can honestly carry.

**(a) `pnpm dev` proxies `/api` to the LIVE production deployment.**
`apps/web/vite.config.ts:77` — `backend = process.env.DECKPAL_DEV_BACKEND ?? (laneApiPort ? 'local' : 'live')`, and `:104` points the proxy at
`LIVE_ORIGIN`. `/api/chat` is served **only** by the Vercel function
`api/chat.mjs`; `apps/api` has no chat route. **Therefore every server change in
this branch is inert in the running app until it is deployed.** That covers: the
`partial` phase (`deep.ts:501-503`), all progress beats (`beats.ts`,
`deep.ts:313-314`), the approval preview part (`api/chat.mjs:430`), the
step-budget message (`api/chat.mjs:737-748`), the `journey` tool
(`apps/api/src/decke/tools.ts:664`) and every prompt change (`prompt.ts`). Their
evidence here is unit tests, which are real evidence of *logic* and no evidence
at all of *end-to-end behaviour*.

**(b) The visual harness can target a preview deployment** — `lib/session.mjs:85`
reads `.vercel-bypass` and sends `x-vercel-protection-bypass` — but `--base`
defaults to `http://localhost:5199` (`capture-decke.mjs:74`) and **no commit
records which base it was run against.** The commit for Phase E claims *"VERIFIED
BY RUNNING REAL JOURNEYS against the live backend, five of them"*; the `journey`
tool is server-side, so that run must have used a preview or a local function
host. There is no gate for it, no harness scene for it, and `.visual-harness/`
is gitignored. **The claim is not contradicted by anything; it is also not
reproducible from this repo.**

**(c) A real iPhone is still the only instrument for `backdrop-filter`
compositing under a translucent status bar.** `DECISIONS.md`'s own harness entry
says so. Everything mobile in this pass was checked at a 390/393px emulated
profile with CDP safe-area insets — which settles *geometry* and settles nothing
about *blur*.

**(d) One assertion needs a real write** and was left open by name in the Phase F
commit: that a reader's **non-primary** printing pick moves the non-primary
variant's quantity in the database. Everything else about the approval card is
pure-function tested.

**(e) The working tree moves while this audit is being written.** It did in
revision 1 and it did again, harder, in revision 2.

*Revision 1's three in-flight items have all landed*, and each is now recorded
in its own row rather than here: the `DECISIONS.md` entries (`12f71b3`, and see
II.5(c)); the C33 prompt paragraph *"A DESCRIPTION IS NOT AN ANSWER TO 'HELP ME
FIND'"* (`12f71b3`, `prompt.ts:615-620`); and the `sayInstead` repair in the
stream-error branch (`12f71b3`). Revision 1's warning that its line numbers were
read from the working tree rather than the tip is therefore spent — but see the
revision 2 note above for the drift that replaced it.

*Revision 2 was written against a checkout with three other workstreams live in
it.* `HEAD` advanced from `bac94b5` to `0d64f6c` mid-audit, and at the moment
the rows below were finalised `git status` carried:

- `apps/web/src/character/host/screenCompact.ts` (new) and a modified
  `DeckeScreen.tsx` — **C40's compact-screen mode, in progress.** The C40 row
  says so and does not predict its outcome;
- a modified `uiTools.ts` plus a new `__tests__/hopProfile.test.ts` — **C35's
  flight profile, in progress.** In the working tree `travelAfterRoute` already
  reads `via: far ? 'background' : undefined`; **at `0d64f6c` it does not**
  (`uiTools.ts:386` still forces it), so C35 stays PARTIAL against the commit
  and the row records the fix as in flight;
- a modified `scripts/visual-harness/capture-decke.mjs` and its README;
- a modified `DeckeChat.tsx` with a new `__tests__/chatAccessibility.test.ts` —
  **D13's remaining transcript live region, in progress**;
- `apps/web/src/character/host/deckeChatState.ts` with its own test, new and
  unattributed.

That list grew twice while these rows were being written and should be assumed
stale. Every status below is assigned against **`0d64f6c`**, which is what "did
this pass ship it" means. **Nothing uncommitted is counted as shipped**, and
four rows — C35, C39, C40 and D13 — say in their own words that they are
snapshots of unfinished work rather than verdicts on it.

**What I did run, today, from this working tree:**
`apps/web` decke suites — **295/295 pass**;
`apps/api` decke suites — **157/157 pass**. Both match the branch's own claims
for those suites. I did not start a dev server.

---

## II.1 Status key

| Status | Means |
|---|---|
| **SHIPPED** | Code exists, I opened it, and it does what the complaint asks. Cited by `file:line`. |
| **SHIPPED (server)** | As above, but the code is server-side and therefore **not exercised by the running dev app** — see II.0(a). Unit-tested only. |
| **PARTIAL** | Some of it landed. The row says precisely what did not. |
| **NOT SHIPPED** | Nothing addresses it. The row says whether that is a ruling, a deferral, or an unnoticed gap. |
| **UNVERIFIABLE HERE** | Needs a real device, a live write, or a deployed preview. The row says which, and what would settle it. |
| **N/A** | A CONTEXT row from Part 2 that was never actionable. |

---

## II.2 Complaints C1–C60

| # | Status | Evidence, or what is missing |
|---|---|---|
| C1 | **N/A** | Context. A1 removes the plausible cause: nothing is fetched or rendered until intent. |
| C2 | **SHIPPED** | The idle-load effect is deleted; `DeckeHost.tsx:224-261` is the tombstone comment where it stood. Loading starts only at `DeckeButton`'s `onWarm`/`onOpen` (`DeckeHost.tsx:789-794`). Gate 18 (`decke-gates.mjs:2814`) asserts both halves — 0 requests idle, then requests after hover — and was measured PASS (0 idle, 7 after hover). |
| C3 | **SHIPPED** | `character/decke/entry.ts` + `DeckE.playEntry`; sequenced at `DeckeHost.tsx:452-484` — placed at the launcher's rect `instant: true`, grown, then travelled. He finishes *loading* at scale 0 (`DeckeHost.tsx:693`) and shrinks back on close (`:393`). Reduce path is the same code path (`playEntry` returns 0 and calls `onDone` synchronously). `entry.test.ts` plus a vision-model judgement on a recording, both PASS including the reduced-motion run. |
| C4 | **SHIPPED** | `characterHeightBeside` (`DeckeHost.tsx:107-110`): `min(composerH x 2.9, w x 0.28, h x 0.24)`. The old desktop branch — full 300px while the chat was open — is gone. |
| C5 | **SHIPPED** | `DeckeChat.tsx:629-630`: `left: var(--app-sidebar-w)`, `top: calc(var(--app-header-h) + env(safe-area-inset-top))`. Panel is the content pane, per OR1. |
| C6 | **SHIPPED (desktop)** | The FLIP is real and measured, not hardcoded: `DeckeChat.tsx:350-366` captures the previous commit's `top` in a `useLayoutEffect` and animates the delta via `--decke-drop` (`theme.css:1036`), guarded `motion-safe:` (`DeckeChat.tsx:957`). Empty state centres the column (`:689`). **On a phone it deliberately does not move** — stated at `:679-689`. Part 2 rated this PARTIAL; on desktop it is now closed. |
| C7 | **UNVERIFIABLE HERE** | Tokens shipped and the drift cause is fixed: `--color-decke-scrim: rgb(26 23 22 / 0.68)` and `--decke-scrim-blur: 12px` (`theme.css:311-312`), consumed at `DeckeChat.tsx:651-653`. From 0.45/3px to 0.68/12px. Whether that reads as "far more blurred" **on his 4K desktop and on a real iPhone** is a looking question nobody in this repo can settle. **Settled by:** V5, plus one 4K desktop screenshot. |
| C8 | **SHIPPED** | Unchanged by construction, and I checked the mechanism rather than trusting it: desktop scrim stays `z-[15]` (`DeckeChat.tsx:591`) below `--z-chrome: 20`, and `.app-header` is opaque with `backdrop-filter: none` (`premium.css:294-298`), so it is not in the scrim's backdrop. |
| C9 | **SHIPPED** | Desktop: an ordinary beside-park, `side: 'left'` against the composer landmark (`DeckeHost.tsx:433-443`). Mobile: the park box at the panel's bottom-left (`DeckeChat.tsx:1028-1047`), whose overlap with the composer is deliberate per C56. |
| C10 | **SHIPPED** | The ordered part list (`DeckeChat.tsx:187-196`) plus update-in-place (`useDeckeChat.ts:560-573`). A row can no longer be pushed below the words it preceded. |
| C11 | **SHIPPED** | `ChatMarkdown` at `DeckeChat.tsx:821`. Lazy, with a raw-text `Suspense` fallback (`ChatMarkdown.tsx:49`), hardened by `lib/markdownSafety.ts`. |
| C12 | **SHIPPED** | `chat/ThinkingRow.tsx`, mounted at `DeckeChat.tsx:868-873` with a stable `data-decke-thinking` hook. Elapsed counter ticks at 2 Hz and survives reduce (`ThinkingRow.tsx:57,80-84`). |
| C13 | **N/A (directive), partly honoured** | The Thinking *shape* is adapted and its *mechanism* deliberately rejected (`ThinkingRow.tsx:29-40`); its tokens deliberately not imported. The Prompt Bar half of the same directive is **not** taken — see C51. |
| C14 | **SHIPPED, with a defect** | `ToolRow.tsx:134-176` — a real `<button aria-expanded aria-controls>` over a real region, plus `ThinkingRow.tsx:101-137` for step detail. **But see II.5(a): while a turn is busy every row is rendered twice.** |
| C15 | **SHIPPED** | `ToolRow.tsx:113` — flat `<li>`, no border/background/radius at rest; chrome only for `warn`/`danger` (`toolRowState.ts` `TONE_ROW`). The `title`-attribute content is now a real expandable region. |
| C16 | **SHIPPED** | Same. `toolRowState.ts:55` — *"`quiet` — resting inline text. No chrome. The default, per C16."* |
| C17 | **SHIPPED (server)** | The probe §6 D3 asked for was run and came back positive: `deep.ts:313-314` now consumes `'source'` parts off `fullStream` and emits `sourceBeat(part.url)` — *"Read a source: pokebeach.com"* — rendered by `ThinkingRow`/`ToolRow`. No provider change was needed, so the "US frontier labs only" question never had to be asked. **Undeployed** — see II.0(a). |
| C18 | **SHIPPED (client) + SHIPPED (server)** | Client: update-in-place preserves first-seen order. Server: `beats.ts` emits at real tool boundaries; `heartbeatBeat` answers the pixel-identical case directly. |
| C19 | **SHIPPED** | Client half is fully verifiable here — the counter cannot look stopped. Server beats add the *content*. |
| C20 | **SHIPPED (server)** | `apps/api/src/decke/beats.ts` — every exported function takes a fact and returns words about it; unknown cases return `null` rather than something plausible. X2 respected structurally. **Undeployed.** |
| C21 | **SHIPPED — both halves, in two commits after the audit** | Revision 1 was right that nothing implemented it, and wrong by one commit. **The answer-arrival half** landed in `12f71b3`: `decke.setState('curious', { mode: 'once' })` fired at the first text chunk (`useDeckeChat.ts:762`), `once` rather than sustained, and deliberately *not* setting `movedRef` (`:757-760`) so the turn boundary still restores `idle`. **The during-the-wait half** — C21's own words, *"he can kind of show a different emotion for a sec and then go back to thinking"* — landed in `0d64f6c` as `character/host/thinkingBeat.ts`, a pure function called at `useDeckeChat.ts:669`. It hangs on the **single chip writer** every real tool event already passes through rather than on a timer, because a timer would fire while nothing was happening, which is the fabricated status surface X2 forbids; at most one per 4 s; and **never on failure** — Crolic et al. 2022, warmth aimed at someone whose thing just broke lowers satisfaction, and a flourish beside the auto-expanded failure row competes with the one row that has to be read. Seven mutations run against it, all caught. |
| C22 | **PARTIAL** | §6 D4's deliverable was *"he gets the number"* — a recorded decision, not a surface. II.5(c) is now closed in general (16 entries), but **none of the 16 is this one.** The only `DECISIONS.md` entry about the swap — *"Deck-E's chat model: 4.1 → 4.20, and the trade that came with it"* (`DECISIONS.md:8616`) — arrived on `main` in `209150f`, **before this branch existed**, so it records the swap and not §6 D4's deliberate deferral of it. `README.md` §6 item 2 still lists the latency as still-open with *"Measure after Phase E with `flyTo` re-tested"*, and **nothing has been measured after Phase E** — which is now the same blocked measurement as C31/C33, waiting on the same meter. |
| C23 | **SHIPPED** | Two mechanisms: update-in-place (order no longer shifts), and `hintFrom` — *"a few real words clipped from its OWN result"* (`toolRowState.ts:79-90`) so a row reads as state, not intent. |
| C24 | **SHIPPED** | A hand edit in `apps/web/public/models/decke/playbook.json` — `thinking` plateau `gx -1.7 -> -6.0`, `gz 1.05 -> 5.0` — recorded in a `hand_edits` array *inside the generated file*, with a WARNING that regeneration reverts it. `gaze.test.ts` asserts where the pupils end up through the real `aimPupil` at both facings, so a silent revert fails loudly. |
| C25 | **SHIPPED — and not as one line, because one line was wrong** | `DeckeHost.tsx:226` — `navigate({ to, replace: !first })`. The unconditional `replace: true` §6 D5 asked for shipped in `12f71b3` and was **corrected in `52af8fc` within the hour**, for the reason the comment beside it had predicted: replacing every hop turns history `[A, B]` into `[A, C]`, so Back from wherever he took you lands on A and **B — the page you asked from — is unreachable by any number of presses.** The fix skipped the very page it was written to protect. The scheme now is **push the first hop of a turn, replace the rest** (`:203-204` for the per-turn ref, `:224-227` for the call), so one Back undoes him however far he walked and a five-step escort still leaves one entry. **A known gap is stated rather than papered over** (`:228-233`): a journey's `click` steps press real `<Link>`s, which push through the router's own default where this callback never runs, so a mixed `goTo`+`click` journey still accretes an entry per click. The honest attribution survives too — the original hiccup was almost certainly his own back-gesture. |
| C26 | **SHIPPED** | Two things: `facing?: number` added to `FlyOptions` (`DeckE.ts`), and — the actual fix — the chat park stopped asking him to stand ON a point and asks him to stand BESIDE the composer (`DeckeHost.tsx:433-443`), which is the `solvePark` branch that returns a facing. `arrive.test.ts` pins it. |
| C27 | **SHIPPED** | Same call site. `STAND_DESKTOP` survives only as the fallback when the composer landmark has not laid out (`DeckeChat.tsx:83`, `DeckeHost.tsx:444`). |
| C28 | **N/A** | Context; produced D6/D7, both shipped. |
| C29 | **UNVERIFIABLE HERE** | The mechanism is right and is the one OR1 demanded — **geometric, not a z-index swap**: the scrim's `top` is `calc(var(--app-header-h) + env(safe-area-inset-top))` (`DeckeChat.tsx:654`), fed by custom properties `AppShell` publishes (`AppShell.tsx:582`), so the blurred element does not extend under the header at all. **Settled by:** V5. **Residue:** PLAN §4 B2 item 3 — *"a nav tap minimises the chat deliberately"* — is **not implemented**; the header is live and a nav tap will navigate out from under an open conversation. |
| C30 | **SHIPPED** | `.decke-composer-card` (`theme.css:973-1004`) with `surface-secondary` plus border and shadow rather than `surface-raised`; the premium skin's recessed-well rule is defeated by counted specificity, not `!important` (`premium.css:224-243`); safe-area padding at `DeckeChat.tsx:941`. |
| C31 | **PARTIAL (verification) — and the instrument turned out to be the problem** | The umbrella is addressed by E1–E8 in code. The finding has since got worse in a useful way: **gate 22 was structurally incapable of passing for the behaviour it exists to demand.** It filtered wire tools to `goTo`/`click` to decide "did he move" — but a `journey` or an `escort` is ONE call whose hops run in the browser, so a perfect escort scored identically to a description. Fixed in `4f3f129`: `const MOVEMENT = ['goTo', 'click', 'journey', 'escort']` (`decke-gates.mjs:3252`). `probe.mjs` was blind twice over as well (II.5(i)). **The gate still has not been re-run.** Every escort reading on record, the RED in `27b4527` included, predates both repairs and cannot distinguish a failed escort from an unmeasurable one. |
| C32 | **SHIPPED (server) + SHIPPED (client)** | Server: `journeySchema`, landmark-allowlist validation at *parse* time, no `wait` verb (`apps/api/src/decke/tools.ts:260-430,664`). Client: `character/host/journey.ts` — bounded conditional waits via MutationObserver (`:104-140`), `ensure` as the idempotent disclosure verb (`:259-295`), a zero-box refusal so a `display:none` sidebar link cannot be "pressed" invisibly (`:299-312`), and E6 cancellation on `isTrusted` gestures only (`:211-231`). **Undeployed**, and see II.5(e) for the mobile consequence. |
| **C33** | **PARTIAL — three things landed, none of them observed working** | (1) **A prompt directive**, committed in `12f71b3`: *"A DESCRIPTION IS NOT AN ANSWER TO 'HELP ME FIND'… A turn that ends with them still on the page they started on has not answered them"* (`prompt.ts:615-620`) — this is the paragraph revision 1 caught uncommitted. (2) **An `escort` tool** (`tools.ts:691-720`, `cbd3ce0`) that takes `{ seriesSlug, setId, opener? }` and has the **browser** expand it into journey steps (`escortPlan.ts`, wired at `useDeckeChat.ts:954`, no server `execute`). `ESCORT-PLAN.md` §0–§2 is the evidence for why: an internal control group holding model, prompt, SDK and turn position constant found `goTo` (one route string) at 100% and `journey` (a compiled multi-step program) skipped 8/10, so **the barrier is construction cost, not reluctance** — and every prompt lever measured at roughly nothing because every prompt lever was aimed at "may I" when the question was "can I". (3) **The gate repair** (C31). What is still absent is exactly what revision 1 named: **no brevity rule for a non-`travelling` turn** — `prompt.ts:689` is still *"When you move, keep what you say SHORT"*, scoped to moving — and **C45's countervailing boundary is still recorded nowhere.** The design now routes the case into the travelling path instead of legislating for the other one, which is §7 E7's theory restated rather than verified. `ESCORT-PLAN.md` §2 says it in its own words: ***"BUILT, AND NOT YET MEASURED… What has NOT happened is a single real turn: the meter was exhausted."*** |
| C34 | **SHIPPED (server)** | Better than the sitemap that was planned: an **addressing scheme** (`prompt.ts:230-263`, `ADDRESSING_LINES`) built from ids the data tools already return, plus the explicit negative that `[data-decke-nav="/series"]` does not exist at any width — confirmed by observation in a real DOM at 1440 and 393. |
| C35 | **PARTIAL — fix in progress at time of audit** | The **chat-open** entrance is shipped (C3). The complaint's own frames — becoming large and centred over a loading spinner *after a navigation* — are still **not addressed at `0d64f6c`**: `uiTools.ts:386`'s `travelAfterRoute` forces `via: 'background'` unconditionally, which is the mechanism the brief names, while the distance threshold at `uiTools.ts:270` covers bare `flyTo` only. Unchanged from revision 1 apart from the line numbers. **But the working tree is mid-fix**: an uncommitted `uiTools.ts` reads `via: far ? 'background' : undefined` on that same call, with a new `__tests__/hopProfile.test.ts` beside it — see II.0(e). Nothing uncommitted is counted here; re-read this row at the next commit. The brief's other instruction — *"re-test this after C32 lands"* — is still not carried out either way, and now waits on the same meter as C31/C33. |
| C36 | **SHIPPED** | `useDeckeChat.ts:814-827` emits a row **after** `runUiTool` returns, from its real result, through the same single writer as server chips. A step that never ran emits nothing, because the emitting line is only reached by a step that ran. |
| C37 | **SHIPPED** | The conversation column is `mx-auto max-w-[760px]` in the content pane and the composer is its foot (`DeckeChat.tsx:676-690, 939-1009`). |
| C38 | **N/A** | Context. |
| C39 | **PARTIAL — work in progress at time of audit** | At `0d64f6c` the ad-hoc screen concept is still untouched: `DeckeScreen.tsx` is **not in the branch diff** and its block kinds are unchanged. What landed for this complaint is the new part-list slot that lets more than one screen ride a turn (`ChatPart` `kind: 'screen'`). **`DeckeScreen.tsx` is modified in the working tree** alongside a new `screenCompact.ts` — the C40 workstream — so this row and C40's move together and both are in flux. |
| **C40** | **NOT SHIPPED — the dead code is gone; the complaint is not** | **Two different things, and they must not be confused.** *The dead-code finding* (II.5(b)) is **resolved**: `chat/CardRow.tsx` (153 lines), `chat/cardRowText.ts` and `__tests__/cardRowText.test.ts` were **deleted** in `12f71b3` — deleted, not wired — on the reasoning that `cardGrid` in `DeckeScreen` already draws real card art from catalog ids with a `dense` mode (`DeckeScreen.tsx:107-108`), and that shipping tested, unreachable code is worse than not shipping it because the tests make it look maintained. *The complaint itself* — *"present the ad-hoc screen as a compact inline widget"* — **is still open**, and deleting the widget did not close it; it removed the false signal that it had been closed. **In progress at time of audit:** an uncommitted `apps/web/src/character/host/screenCompact.ts` and a modified `DeckeScreen.tsx`. **This row is a snapshot of an unfinished thing and its outcome is not predicted here.** |
| C41 | **NOT SHIPPED — deliberate drop, and its consequence is now closed** | He hedged it himself. Revision 1 asked for one sentence stating which surface owns progress, plus Q6 restored to §13; **neither has been written**. What *has* changed is that II.5(a) — the three-progress-surfaces hazard arriving in code as a doubled tool row — was fixed in `12f71b3` by deciding the question in the code instead: the inline part list in occurrence order is the record, and the thinking row takes no `steps` (`DeckeChat.tsx:956-971`). The decision exists; the sentence in the plan and the restored Q6 still do not. |
| C42 | **SHIPPED (client) + SHIPPED (server)** | `chat/ApprovalCard.tsx` plus `chat/approvalCardState.ts` (779 lines, 26 pure tests, all passing here), the preview part at `api/chat.mjs:430`, and `variantSource` on the dry-run rows (`packages/agent-tools/src/resolve.ts`, classification keyed on **candidate count**, not resolution status, pinned by `resolve.test.ts`). |
| C43 | **SHIPPED** | Provenance, not a score — OR4 honoured to the letter, including the "no numeric meter" paragraph written into `ApprovalCard.tsx:16-27` as the answer to the future temptation. **One assertion left open by name:** a non-primary pick actually moving the non-primary variant's quantity needs a real write. |
| C44 | **N/A (directive), delivered** | `IDEAS.md`, 22 use cases re-verified against the real tool surface, three cost claims corrected, three ideas rejected. A menu, not a build, as asked. |
| C45 | **N/A** | Context — and its boundary is still not carried anywhere, which is half of C33's gap. |
| C46 | **PARTIAL (mechanism, not complaint)** | Unchanged in substance; line numbers refreshed. The scroll lock **stays** (`DeckeChat.tsx:424-436`, `lockScroll`/`unlockScroll` from the `Sheet` primitive), per §11c — a ruling made by the planner, **not by him**, and still never put to him. What was fixed is the transcript: `pointer-events-auto` on the scroller and a stick guard on the unconditional `scrollTop = scrollHeight` (`:531-558`). If his complaint was literally "the page behind will not scroll", it is deliberately unmet; if it was "I drag and nothing happens", it is met. |
| C47 | **UNVERIFIABLE HERE** | Fixed *by construction* rather than by padding: the panel starts below the app header, so the close button cannot be in the status bar (`DeckeChat.tsx:717`, with an explicit note that the row takes no second safe-area inset). **Settled by:** V5 on an installed PWA. |
| C48 | **SHIPPED** | Three separate causes, all fixed: `mt-auto` on the list rather than `justify-end` on the scroller (`DeckeChat.tsx:773`, with the `scrollHeight === clientHeight` trap written down at `:692-699`), pointer events, and the stick guard. |
| C49 | **N/A** | Context. CDP safe-area emulation exists (V3) and is not a substitute for V5. |
| C50 | **SHIPPED** | Composer card, transcript fade **mask** (`theme.css:1019-1023` — a mask rather than a gradient, because what is behind it is a live blurred page), and the approval block as its own card with a gap (`ApprovalCard.tsx:291`). |
| C51 | **PARTIAL — the control itself changed, the control *row* did not** | `90c0f3a`, the commit immediately after the audit, is titled *"The input itself, which was the one thing the restyle had not touched"*. **What shipped:** the single-line `<input>` at a fixed `h-[40px]` is now a `<textarea>` (`DeckeChat.tsx:1092-1119`) that **auto-grows** — height measured from its own `scrollHeight` in a `useLayoutEffect` so it lands before paint rather than showing one frame at the old height per keystroke (`:385-408`), 1 row to 6 then scrolls, bounded because his own height is measured from this card; **Enter sends, Shift+Enter breaks the line** (`:1096-1101`); a **focus state on the card rather than the field** (`theme.css:998-1005` — `:focus-within` moves the border and adds a ring, and the inner control's own ring is suppressed so the reader sees one control, not two nested boxes); and a placeholder shortened on a measurement, not a hunch — 129 px of a 393 px phone is legitimately him, leaving the field 174 px against the old string's 190 (`336b398`, `:1109`). **What did not ship:** there is still **no control row inside the card** — `:1120-1157` is textarea plus one send/stop button and nothing else — no `+`, no attach, and Q1's `@`-mentions / `/`-commands reading is still neither confirmed nor closed. The string "Prompt Bar" still appears nowhere in the branch. So the sentence he actually said — *"I don't love the design of the input at all"* — is answered; the component he named as the reference is still only half-mined. |
| C52 | **PARTIAL** | Unchanged. "No model picker" is satisfied (there never was one). **The slot is still not built** — no `+` and no attach affordance anywhere in the composer; `DeckeChat.tsx:1120-1157` is the textarea plus one send/stop button, and the `<Icon>` inventory in the whole panel is `chevron-down`, `close` and `chevron-right`. `README.md` §5 still records this as *"deferred, slot built but unwired"*; the code still does not match that claim. |
| C53 | **N/A** | Directive about process. |
| C54 | **SHIPPED** | OR3's recovered request is the thinking→answering transition, and that is exactly where the beat went: `decke.setState('curious', { mode: 'once' })` at the first text chunk (`useDeckeChat.ts:762`, `12f71b3`). The choice is argued in place (`:734-761`): `once` because this is punctuation on an event and not a mood to be left holding, and `curious` rather than `happy` because *"a character who is pleased about a timeout is the failure this pass spent its time on."* |
| C55 | **N/A** | Context. |
| C56 | **SHIPPED** | Two halves, and the second is the one that would have quietly broken it: the park box is the panel's bottom-left corner (`DeckeChat.tsx:1028-1047`), and the keep-out **bottom band is zero while the chat is open** (`DeckeHost.tsx:754`) precisely so a composer-sized band cannot shove him off the placement he asked for by name. |
| C57 | **N/A** | Context. |
| C58 | **N/A** | Context. |
| C59 | **N/A** | Context; folds into V5. |
| C60 | **SHIPPED** | `ToolRow.tsx:16-20` states it as a design rule and the markup honours it — flat inline text, no `select-none` anywhere in the chat surfaces. |

### C-column totals (implementation)

*Recounted row by row at `0d64f6c`. Revision 1's line read `SHIPPED 29 · server 6
· PARTIAL 8 · NOT SHIPPED 6 · UNVERIFIABLE 3 · N/A 8`; it summed to 60 but its
N/A figure was 8 against 12 actual N/A rows, with the difference absorbed into
SHIPPED. The line below is counted, not carried forward.*

SHIPPED **29** · SHIPPED (server-only) **6** · PARTIAL **8** ·
NOT SHIPPED **2** · UNVERIFIABLE HERE **3** · N/A **12**

Server-only rows (code read, unit-tested, **not exercised by the running app**):
C17, C20, C32, C34, and the server halves of C18 and C42.
NOT SHIPPED: **C40** is a live gap with work in flight; **C41** is a sanctioned
drop.
PARTIAL: C22, C31, C33, C35, C39, C46, C51, C52 — of which **C31, C33 and C22
are all blocked on the same thing**, a real turn against a deployed backend with
meter left.
**Closed since revision 1:** C21 and C54 (the emotion beats, `12f71b3` +
`0d64f6c`) and C25 (`replace`, `12f71b3` + `52af8fc`) moved NOT SHIPPED/PARTIAL
→ SHIPPED. C33 and C51 moved NOT SHIPPED → PARTIAL. C40's *dead-code* half is
resolved by deletion; its *complaint* half is not, and the row keeps them
apart.

---

## II.3 Defects D1–D16

| # | Status | Evidence, or what is missing |
|---|---|---|
| D1 | **SHIPPED (client) + SHIPPED (server)** | Server: `heartbeatBeat` says only what the server can see — elapsed and steps started (`beats.ts:141-152`). Client: the thinking row exists at all, which it did not before. |
| D2 | **SHIPPED** | Both forks closed, and Part 2 was right that fork (a) was the harder one. Fork (b): `deep.ts:403` returns `partial: 'timeout'` and `:501-503` emits `phase: 'partial'`. Fork (a): `chat/toolRowState.ts` makes failure the **enforced** exception to quiet — tinted, ruled, an explicit **word** ("Timed out — incomplete", not a colour), auto-expanded, with a retry — as a pure function with its own test, so a later restyle cannot walk it back. This is the strongest single piece of work in the pass. |
| D3 | **SHIPPED** (Part 2 had it DROPPED) | The question the brief wanted asked *was* asked, and answered the second way: three real calls, not one repaint. `hintFrom` (`toolRowState.ts:79-90`) gives each row a few words clipped from **its own** result. **But partly re-created** — see II.5(a). |
| D4 | **SHIPPED** (Part 2 had it DROPPED and called it the one that matters) | `DeckeHost.tsx:291-320`: a `pathname` subscription that clears the highlight, drops `travelling` (which retires the bubble), and re-parks or sends him home. The exemption is a **journey-step flag**, not `travelling` — `:285-290` explains that exempting on `travelling` would have exempted precisely the case he hit. Gate 19 (`decke-gates.mjs:2916`) measured PASS: bubble 1→0, bar true→false, station element→home. |
| D5 | **NOT SHIPPED — owner ruling** | Out of scope (`README.md` §5). **Note:** `DeckeHost.tsx:25` still claims *"Conversation state is persisted for that"*, and no persistence exists anywhere — a grep for `sessionStorage`/`localStorage` over the chat surfaces is empty. Pre-existing inaccuracy, not introduced here, but it is a false comment sitting directly on the defect it describes. |
| D6 | **SHIPPED** | The missing **vertical** clamp: `decke.setKeepOut({top, bottom})` (`DeckeHost.tsx:630-633`), measured from real elements sized by the same custom properties the panel uses (`:740-756`) — so header height, notch and sidebar collapse are all accounted for without this file knowing any of those numbers. Ten new geometry tests in `keepOut.test.ts`, each proved failable by mutation, including a straw-man control. |
| D7 | **SHIPPED** | The closed-state bottom band is `calc(50px + env(safe-area-inset-bottom))` (`DeckeHost.tsx:754`) — the PWA install pill. |
| D8 | **NOT SHIPPED — still unnoticed** | Re-checked at `0d64f6c` and unchanged. No fix, and **no V4 assertion was added either**: `grep -rn "upright\|tilt\|tumbl" scripts/` is still empty. The `via: 'background'` distance threshold (`uiTools.ts:270`) plausibly dissolves it for short hops, exactly as the brief predicted, but nobody has looked and nothing will tell them. The C35 work in flight (II.0(e)) would extend that threshold to the post-`goTo` flight, which is the other half of the same mechanism — so the case for the one-line assertion gets *stronger*, not weaker, and it is still not written. |
| D9 | **N/A** | Investigated and dismissed in the brief. |
| D10 | **SHIPPED, and the open design question was answered** | Part 2 said the brief's fork — one hoisted shared lazy boundary versus a smaller inline subset — was never chosen. The implementation chose a **third** and stated it: one shared lazy boundary whose `Suspense` fallback is the raw text with `whitespace-pre-wrap` (`ChatMarkdown.tsx:18-26, 49`), so the worst case is "no worse than before" rather than a 280px bubble that measures at zero height and gets placed there. Wired at `DeckeBubble.tsx:145`. |
| D11 | **SHIPPED** | Same keep-out mechanism. It is a **clamp, not a veto** (`DeckeHost.tsx:614-618`), which is what keeps "must not cover the header" and "must be able to point at a nav item" from contradicting each other — and the clamp applies to *placements* only, never to the per-frame scroll track, or the off-screen beacon would have become unreachable dead code. |
| D12 | **SHIPPED** | Tap-and-wait per OR2, and the three consequences are each handled: the chip does not unmount at open (`DeckeHost.tsx:785`), it rises to `z-[26]` (`DeckeButton.tsx:164`), and a failed load says so and offers the way back (`DeckeButton.tsx:126-141`, `theme.css:880-895`). Plus the defect the pass created and caught: a question typed before he arrives is now **held and shown** rather than evaporating (`useDeckeChat.ts:291-321, 425-439`), with a 45s ceiling. |
| D13 | **PARTIAL** | **New controls: genuinely good, checked one by one rather than assumed.** `ToolRow` — `aria-expanded`/`aria-controls` over a real region, an always-mounted live region so the failure announcement is not missed (`:119-121`), a retry button whose label names the tool (`:156`). `ThinkingRow` — `role="status" aria-live="polite" aria-atomic` on the label only, with the 2 Hz timer deliberately outside it and an `sr-only` prose duration (`:125-128`). `ApprovalCard` — every removal is a labelled `aria-pressed` button naming the card (`:127`); pickers are a `role="radiogroup"` with an accessible name (`:223-224`). Empty-state openers are real buttons with visible focus rings (`DeckeChat.tsx:753-767`). **Of the three still-missing items, one is closed and it was closed the right way round.** (2) **`aria-modal` is gone**, and `35ce62a` argues — correctly — that *removing it was the fix and a focus trap would have been the wrong one*: `aria-modal` asserts everything outside is inert, which stopped being true the moment OR1 ruled that the header and full-height sidebar stay sharp **and usable**. Trapping focus would have implemented the lie instead of removing it. The reasoning is written into the markup at `DeckeChat.tsx:677-691`, and the commit records that the sidebar was checked as genuinely focusable with the panel open — which is what makes the attribute wrong rather than merely redundant. **Focus restore did land** (`:446-475`), together with the measurement that caught the naive version: the launcher unmounts once he has arrived, so the opening element is usually *gone* by close and focusing a detached node is a silent no-op — the fallback is the remounted launcher, after a frame. **Still open:** (1) **the transcript is still not a live region** — `grep -rn "aria-live" apps/web/src/character/host/` matches `ThinkingRow.tsx:150`, `ToolRow.tsx:119` and `DeckeBubble.tsx:113-114` and **nothing in `DeckeChat.tsx`**, so the minimised bubble announces and the main surface still does not. ***In progress at time of audit:*** *by the end of this revision `git status` carried a modified `DeckeChat.tsx` and a new `__tests__/chatAccessibility.test.ts`, which is very likely this. Nothing uncommitted is counted here — re-read this item at the next commit.* (3) the `role="radio"` buttons (`ApprovalCard.tsx:223,233`) are still all individually tabbable with no arrow-key roving — no `onKeyDown` anywhere in the file — which is still not the ARIA radiogroup pattern. |
| D14 | **SHIPPED — and the plan was backwards about it** | Part 2 flagged that §3 A6 promised the fix while forbidding `GAZE_GAIN`/`PUPIL_ROAM`. The implementation resolved it without touching either: the pupil sitting at the clamp is the **baseline at this staging** (the camera is 45.6° off each eye's axis where the eye saturates at 24.2°), so thinking could not make it worse, and a gaze that genuinely reads as "away" is one that comes **off** the clamp. A6 done properly *is* the D14 fix. Recorded in `playbook.json`'s `hand_edits.why`. |
| D15 | **SHIPPED** | Dissolved by the layout change rather than fixed on its own — the panel starts below the header at every width. Claimed looked-at at 1440 and 1100 (the reported width). |
| D16 | **NOT SHIPPED** | Out of scope, correctly (`§12`). |

### D-column totals (implementation)

*Recounted row by row at `0d64f6c`. Revision 1's line summed to 16 but put D9 in
the NOT SHIPPED bucket while also describing it as not actionable; D9's row says
**N/A**, so it is counted there.*

SHIPPED **11** · PARTIAL **1** (D13) · NOT SHIPPED **3** — of which D5 and D16
are rulings and **D8 is an unnoticed gap** · N/A **1** (D9).

**No D row changed status this revision.** D13's row narrowed: two of its three
open items are now one, `aria-modal` having been fixed by removal (`35ce62a`).
D1 and D2 each have a server half that is undeployed (II.0(a)) — and D2 gained
a failure mode nobody had seen, see II.5(i).

---

## II.4 The cross-cutting constraints

| | Status | Finding |
|---|---|---|
| **X1 — reduced motion ships with the motion** | **SHIPPED, and it holds under audit** | I enumerated every animation added in this branch. Every one has a reduce path, per-element, with **no blanket rule**: `decke-chat-in` / `sheet-panel-up` (`DeckeChat.tsx:641-642`), `sheet-scrim-in` (`:590`), `decke-composer-drop` (`:957`), `decke-button-in` and `decke-bob` (`DeckeButton.tsx:168,183`), `decke-wake-sweep` (`theme.css:860-875` — a `no-preference` block for the travel and a **reduce block that keeps the ring**, because removing the signal is worse than the motion), `ThinkingRow`'s ring (`:160-170`), `ToolRow`'s ring (`:65-76`), `DeckeBubble` (`:121`), `decke-shift` (`theme.css:955`). Engine side: `reduced` is a constructor flag the **host** owns (`DeckeHost.tsx:510-524`), watched live so turning the preference on mid-session stops the motion now, and `playEntry`/`flyTo` take a **different code path** rather than a disabled one. The thinking counter deliberately keeps ticking under reduce, because there the number *is* the signal. **Nothing failed this check.** |
| **X2 — truthfulness** | **SHIPPED** | Movement rows are emitted after the tool returns, from its real result (`useDeckeChat.ts:814`); beats return `null` rather than something plausible; `ApprovalCard` has no prop through which model prose can reach the dialog. |
| **X3 — approval semantics** | **SHIPPED** | The prompt change (`prompt.ts:536-543`) replaces "use the primary and say which you used" with "call the tool anyway", keeping the sentence whose absence took writes from 0/15 to 21/30 and touching neither protected string. The reason it *had* to change is sound: under the new card that row is not written unless picked, so the old instruction would have him narrate a printing in the same turn the dialog asks about it. |
| **X4 — widen the audit first** | **SHIPPED** | Its own commit (`325f01a`), before any marking, and the detector was itself pinned by fixtures. Verified failable. |
| **X5 — contracts** | **SHIPPED** *(was PARTIAL)* | B12 honoured (QA account). B11 not applicable (no new env var). **CI wiring honoured** — `test:variants` got its own `ci.yml` step and `test:decke` was widened to the new `chat/__tests__` directory. **The docs contract is now honoured too**: `git diff main..HEAD -- DECISIONS.md` adds **16 entries, +345 lines**, and `ARCHITECTURE.md` and `SECURITY.md` were both revised in `12f71b3`. See II.5(c) for what is covered and the two things that still are not. |

---

## II.5 Findings the row tables do not carry

### (a) Every tool row is rendered **twice** while a turn is busy — and a failed one is visible twice

> **CLOSED in `12f71b3`, the commit that carried this file.** `ThinkingRow` is
> now handed **no `steps` at all**, and the removal is argued in place as a fix
> rather than an omission (`DeckeChat.tsx:956-971`): the drawer was designed
> before the ordered part list, for a transcript that had nowhere else to put a
> row, and *"a lookup that happened between two sentences belongs between them,
> not collapsed inside a spinner."* `grep -rn "steps={" apps/web/src/character/host/`
> returns nothing. The call site is `<ThinkingRow startedAt={turnStartedAt}
> labels={liveLabels(m)} />` (`:984`) — labels, not rows. The commit records it
> as verified mid-turn, which is the only state the bug existed in, with the
> mid-turn and settled transcripts both photographed. **This also settles, in
> code, the question C41/Q6 left open**: occurrence order in the inline list is
> the record, and the thinking row is a status line rather than a third
> rendering of the same facts.

The finding as it stood, kept because the reasoning is what makes the fix
legible:

`DeckeChat.tsx:825-831` renders each `kind: 'tool'` part as an inline `ToolRow`.
`DeckeChat.tsx:856-875` then renders, on the same `<li>`, a `ThinkingRow` whose
`steps={messageTools(m)}` is **the same list**, each as a `ToolRow` again
(`ThinkingRow.tsx:131-137`).

In the ordinary case the duplicate is inside a collapsed disclosure, so it is in
the DOM but not on screen. In the case that matters it is not:
`shouldAutoExpandSteps` opens the step list precisely when a step is `partial`
or `error` (`ThinkingRow.tsx:94`), so **a failing call renders its loud, ruled,
tinted row twice at once**, each with its own "Try again". `liveLabels` then
shows the same note a third time as the thinking row's label.

This is the hazard Part 2 §5(b) named — three progress surfaces with no stated
relationship — arriving in code, on the exact surface D2 exists to protect. It
is also D3's shape (*"a chip rendering 2–3× identically"*) re-created by
construction. No test can catch it: the chat has no render tests, only
pure-function ones.

**Cheapest fix:** the inline part loop skips `kind: 'tool'` parts while that
message is the live busy one, or `ThinkingRow` takes no `steps` at all and the
inline rows are the record.

### (b) `CardRows` is dead code

> **CLOSED in `12f71b3` — by deletion, not by wiring.** `chat/CardRow.tsx` (153
> lines), `chat/cardRowText.ts` and `__tests__/cardRowText.test.ts` are gone.
> The reasoning: `cardGrid` in `DeckeScreen` already draws real card art from
> catalog ids with a `dense` mode (`DeckeScreen.tsx:107-108`), and *"shipping
> tested, unreachable code is worse than not shipping it: the tests make it look
> maintained and the next reader has to work out that it is not."* **This closes
> the dead-code finding and does not close C40** — see that row, which now keeps
> the two apart explicitly.

`messageIsEmpty` (`DeckeChat.tsx:219` at `12f71b3`) is still exported and never
called; the smaller half of this finding stands.

### (c) Zero `DECISIONS.md` entries for eleven commits of product work

> **CLOSED, and then some.** `git diff main..HEAD -- DECISIONS.md` now adds
> **16 entries, +345 lines** — thirteen in `12f71b3`, one in `cbd3ce0` (the
> `escort` macro), two in `0d64f6c` (dismissal, and C21's thinking beat). They
> cover A1 and the rip-watching removal (§11.1's restorations), the geometric
> scrim (§11.2), the ordered part list, failure as the deliberate exception to a
> quiet transcript, closing-ends-the-turn, the journey contract (§11.3), the
> keep-out region (§11.9), reduced motion in the host (§11.11), the approval
> card's provenance segmentation, and the markdown URL/image allowlist.
>
> **Two residues, stated so they are not assumed closed with the rest.**
> (i) The **history scheme** — push the first hop, replace the rest — has **no
> entry**, and it is a live navigation semantic that was got backwards once
> already inside a single hour (`12f71b3` → `52af8fc`); a future reader who
> "simplifies" it to an unconditional `replace` reintroduces the exact bug.
> (ii) §6.3 and §6.10, which revision 1 flagged as "addressed, NOT recorded",
> are **still not recorded**, and neither is §6.8 (see (f)).

### (d) `COVERAGE.md` was never updated during the pass

`README.md` §8 makes it a per-phase requirement, in the same words this audit
was commissioned in: *"keep it true, or '60 complaints' becomes a number nobody
can check."* Every phase declared itself done without touching this file.

> **Partly remedied, and the remedy shows the cost of the gap.** This file has
> now been updated twice — Part II at `12f71b3`, revision 2 at `0d64f6c` — but
> both times *after* the work, retrospectively, and the second pass found that
> **five rows had been wrong for sixteen commits** (C21, C25, C33, C51, C54)
> and that a sixth (C40) had been describing a file that no longer existed. One
> of those, C54, was noticed independently by the `0d64f6c` commit message,
> which records: *"COVERAGE.md records it as NOT SHIPPED because the audit
> predates the commit."* That is the map costing a reader time in exactly the
> way §8 exists to prevent. The habit is still not per-phase.

### (e) The escort degrades on phones — the platform he complained about most

Below `--breakpoint-nav` the sidebar is `hidden nav:flex`, so its marked `<Link>`s
are in the DOM with `display: none`. Two consequences compound:
`collectLandmarks` scores off-screen/zero-box landmarks last
(`useDeckeChat.ts:1408-1414`), so on a phone the nav rows sink toward the bottom
of the 40-landmark budget; and `journey.ts:299-312` **refuses** a step whose
target has no box, by design, because *"an escort nobody can watch is not an
escort."* Both behaviours are right individually. Together they mean a journey
whose first hop is a sidebar row cannot run on a phone. The canonical journey in
the prompt (`goTo /series` → `ensure` → series card → set row) avoids sidebar
rows and is fine; a plan that reaches for one fails honestly rather than
silently. Worth knowing before the feature is demonstrated on a phone.

### (f) §6.8 (the landmark cap) is no longer "mentioned only"

Part 2's conflict-table row is now stale. The cap moved **24 → 40** with a
three-pass ordering — on screen, then declared `container` rank, then DOM order
(`useDeckeChat.ts:1335-1420`) — mirrored server-side because the browser is not
a trusted source of prompt size. Of §6.8's three questions: the cap **did**
change; truncation is **still** invisible to the model, now with the reasoning
written down; and there is **still no nav-critical priority tier** — see (e).
No `§11` entry, per (c).

### (g) Two Part-2 conclusions were overtaken by implementation

- **D14 was backwards in the brief and the plan** — the clamp is the baseline at
  this staging, not a symptom of thinking. Recorded in `playbook.json`.
- **The plan's `calc(64px + …)` for the keep-out band would have been wrong on
  desktop**, where the header is 78. The implementation measures elements sized
  by the published custom properties instead (`AppShell.tsx:582`).

Both are the brief/plan being wrong and the code being right, which is the
direction this project's audit habit exists to catch.

### (h) Smaller residues, recorded so they are not re-discovered

- **Stop leaves no trace.** `close()` appends *"(stopped when you closed the
  chat)"* (`useDeckeChat.ts:949-960`); pressing **Stop** aborts and appends
  nothing, so a turn halted by the button reads as him trailing off — the exact
  thing `close()`'s note exists to prevent.
- **`retry` re-runs the turn, not the tool**, and ignores the row id it is
  handed (`useDeckeChat.ts:275-280`). Honestly documented; worth knowing that
  "Try again" on one failed row re-asks the whole question.
- **PLAN §8b H4 (concurrency) is partly undefined still** — double-send is
  guarded (`DeckeChat.tsx:510`), an abandoned approval settles as a denial, but
  two tabs are unaddressed. *Partly narrowed since*: `52af8fc` fixed two real
  concurrency defects inside one tab — a question queued during wake-up that
  fired **after the reader closed the chat** (a turn can navigate, so that is
  the page moving under someone who has just said they are done), and
  `settleAll` mapping two held writes to one verdict, which committed a
  correction for the first call and then denied both with the first call's
  narrative. Two tabs remain unaddressed.

Re-checked at `0d64f6c`: the first two residues above are unchanged. `stop` is
still `useCallback(() => abortRef.current?.abort(), [])` (`useDeckeChat.ts:1099`)
with no transcript note, against `close()`'s note at `:1154`; `retry` still
re-sends the last user message and ignores the row id (`:332-337`).

### (i) The instruments were lying, in four separate ways, and all four are fixed

Discovered after revision 1 and material to every measurement claim in this
file.

- **A rejected tool call left no trace anywhere.** The AI SDK's default is
  literally `onError = () => "An error occurred."` — sound for a browser,
  terrible when the same text is what a rejected **tool call** reports back to
  the model. On a real gate run `showScreen` failed schema validation **five
  times in one turn** and the model retried each time trimming the panel's
  *title* while the actual fault — a text block over the 280-character cap —
  sat untouched in every attempt. Nothing in the repo logged it: `grep -rn
  "tool-input-error" apps/web/src` returned nothing at all. Fixed in `af212cc`
  in all three directions — the model is told the validation complaint, the
  server writes it down, and **the reader sees a failed row** rather than the
  call being dropped on the floor (`useDeckeChat.ts:1393-1400`). This is D2's
  own failure class arriving by a route D2 did not cover, and it *probably
  explains gate 23's* twelve-tool-calls-zero-text turn.
- **Gate 22 could not pass for the behaviour it demanded** — see C31. Fixed in
  `4f3f129`.
- **`probe.mjs` was blind twice.** It recognised only `tool-input-available`, so
  a turn where he **attempted** `journey` and was refused by schema validation
  was byte-identical to one where he never tried; and MSYS path conversion
  turned `--route /decks` into `C:/Program Files/Git/decks` before node saw it,
  so the probe was asking the model to escort a reader standing on a route this
  app does not have — **and the run still completed, still streamed, and still
  produced a number.** Both fixed (`ESCORT-PLAN.md` §1), the second by
  *refusing* a non-route rather than un-mangling it. **What that invalidates:**
  the 2/10 escort baseline survives (measured through a real browser via the
  gates, which never touch the probe); **the cheap prompt-tweak comparisons do
  not.**
- **And a fourth, in the visual harness.** `6c83ab3`: the chat-open scene was
  photographing him *during his boot animation*, and a still read from one of
  those frames nearly sent someone to "fix" a thinking-gaze regression that did
  not exist. Scenes now wait for him to leave `boot` and **say so in the output
  when they gave up waiting**, so an unrepresentative still announces itself
  instead of being reasoned about.

The common shape is the one this whole pass is about: **a failure nobody can
see.** Three of the four were in the tools built to detect failures.

---

## II.6 Verdict, and the ranked gaps

**The pass is substantially real.** The blockers are closed: C2 — the
number-one complaint — is a measured deletion with a gate on both halves;
C11/D10 markdown lands on both surfaces with a security fix nobody asked for;
C30/C47/C48 are fixed at their causes rather than padded away; D2, the failure
that fooled him, is enforced by a pure function with its own test; and **D4,
which Part 2 called the one undefended drop, shipped with a gate.** Two of Part
2's four DROPPED items (D3, D4) were closed anyway, and D10's open design
question was answered. X1 — the constraint most likely to be quietly skipped —
holds under a per-animation audit.

**What it is not is finished.** *Re-ranked at `0d64f6c`. Revision 1's list had
twelve items; **six are closed** — old #2 (C21+C54), #3 (the double-rendered
row), #6 (`DECISIONS.md`), #9 (`replace`), and the `aria-modal` half of #7 and
the dead-code half of #4 — and one is closed in code without being written down
(the C41/Q6 question, old #12). What remains has changed character: revision 1's
list was mostly **unbuilt things**, and this one is mostly **built things nobody
has watched run.***

Ranked worst first, by what I judge actually matters to the person who recorded
the critique:

1. **The escort is unmeasured, and so is everything near it (C31, C33, C22).**
   `escort` shipped, the gate that judges it shipped a repair, the probe that
   measures it shipped two repairs — and **not one real turn has been run
   through any of them.** `ESCORT-PLAN.md` §2 says so in bold and §6b lays out
   the ~50-turn, ~58¢ experiment that settles it, blocked only on the QA
   account's daily meter. Everything on record about escort behaviour predates
   the instrument fixes and cannot be trusted in either direction. This is now
   the single largest unknown in the pass and it is a *cheap* one — which is
   what makes it the top item rather than the fifth.
2. **C51 — the input, half-done.** The control he complained about is genuinely
   fixed: a real auto-growing textarea with Enter/Shift+Enter and a focus state
   on the card. What is still missing is the **control row inside the card** —
   there is no `+`, no attach, and Q1's `@`/`/` reading is still unanswered — so
   the Prompt Bar, the brief's single largest component study, is still only
   half-mined. Down from #1 because the sentence he actually said is answered.
3. **C40 — the compact inline widget.** The named feature ask is still not in
   the product. What changed is that it no longer *looks* delivered: the
   unwired `CardRows` was deleted rather than left to imply otherwise. **Work
   is in flight at time of audit** (`screenCompact.ts`), so this rank is a
   snapshot, not a prediction.
4. **The mobile half is still unverified (C7, C29, C47).** Correctly mechanised,
   never seen. Unchanged since revision 1 and unchangeable without V5.
5. **C39 — ad-hoc screens**, still untouched at `0d64f6c` and moving with C40.
6. **D13's remaining two.** The container no longer lies — `aria-modal` was
   removed with the argument for why a focus trap would have been the wrong fix,
   and focus restore landed. Still open: **the transcript does not announce**,
   and the radiogroup has no arrow-key roving.
7. **C52 — the `+` slot** that `README.md` §5 still says was built, and was not.
   Now the same gap as C51's control row, and they should be fixed together.
8. **C35 and D8 — the flight profile.** C35's fix is **in the working tree**
   (II.0(e)); D8 still has not received even the one-line V4 assertion revision
   1 asked for, and the C35 work makes that assertion *more* worth having.
9. **The three `DECISIONS.md` residues (II.5(c)).** Sixteen entries written, and
   the history scheme — got backwards once already, inside an hour — is not one
   of them. §6.3, §6.8 and §6.10 likewise.
10. **C46's ruling was never put to him**, and it is a planner's ruling on a
    blocker-severity complaint. Unchanged.
11. **C41/Q6 is settled in code but not on paper.** `12f71b3` decided which
    surface owns progress by making the inline list the record; PLAN §5 C3 /
    §7 E5 still do not say so, and Q6 is still missing from §13.
12. **The map itself (II.5(d)).** Five rows were wrong for sixteen commits and
    one commit message had to correct this file in passing. Updating it per
    phase is cheaper than auditing it per quarter.

**On the mobile half, stated plainly:** C7, C29 and C47 are correctly
*mechanised* — the geometric scrim offset is the right fix, and I checked that
the desktop stacking argument holds too — and **none of the three is verified.**
Chromium reproduces the geometry and not the compositing. They need V5 and
nothing else will do.

**On the server half, stated plainly:** `partial` phases, every progress beat,
the approval preview part, the `journey` tool, the step-budget message and all
prompt changes are **not exercised by the running app**, because `pnpm dev`
proxies to production (`vite.config.ts:78,104` — unchanged at `0d64f6c`). Their
evidence is passing unit tests — good evidence about logic, none about the wire.
**Two things have been added to that list since revision 1** and neither is
exercised either: the `escort` tool's schema and description (`tools.ts:691`),
and the C33 prompt paragraph (`prompt.ts:615-620`). The `escort` *expansion*
runs in the browser (`escortPlan.ts`), so it is unit-tested client code that no
model has yet been able to reach.

The Phase E commit's "five real journeys against the live backend" is the one
claim in this branch I could neither confirm nor refute: there is no gate, no
scene, no artifact and no recorded `--base`. **A deployed preview plus a re-run
of gates 5, 12 and 22 would settle the whole server half in one sitting**, and
would also close item 1 above — which is now the top of the list rather than the
fifth, because the escort work landed on top of it and the instruments that
would judge it were themselves found broken (II.5(i)).

---

## II.7 Research-surfaced open items — **not from the brief**

*Added in revision 2, and deliberately kept out of the C/D tables. Everything
below comes from `RESEARCH-UX.md` — external evidence gathered **after** the
implementation pass and read against the code that now exists — not from the
sixty complaints. **These are not C or D rows and must never be counted as
such.** He did not ask for any of them; some of them argue against things he
did ask for. They are listed so a future reader can tell "the owner complained
about this" apart from "the literature says this is a risk", which is a
distinction the C/D tables would destroy.*

*`RESEARCH-UX.md` carries two caveats from the researcher who assembled it, and
they travel with every row here: several character/motion citations came from
subagent reports rather than direct fetches, so **spot-check any of them before
they go anywhere public**; and the session exhausted its search budget partway
through, so some items are flagged unretrievable rather than resolved.*

| # | Open item | The evidence | Standing against what shipped |
|---|---|---|---|
| **R1** | **Idle motion, not the entrance, is the risk.** Default to visually still; move only when something real changed. | Rickenberg & Reeves CHI 2000 — a *monitoring* character produced higher anxiety and lower task performance, strongest for external-locus users; Pratt et al. 2010 — motion onset captures attention involuntarily; Burke et al. TOCHI 2005 — animated page elements raise workload **even when successfully ignored**. | **Partly acted on already, by good instinct rather than by this research.** `decke-bob` is `motion-safe:` (`DeckeButton.tsx:183`), and `0d64f6c` added a per-device **dismissal** — the stronger form of the same argument (Snapchat's My AI: 3.05→1.67 stars, one-star share 35%→75%, on being *pinned* rather than on answer quality). Not addressed: he still bobs while someone is reading. |
| **R2** | **The thinking row's *reasoning content* may be actively harmful**, and a single "Thinking…" row is the wrong shape regardless. | Kim et al. CHI 2025 (N=308, pre-registered), agreement with **wrong** answers: neither 78.2%, **explanation-only 82.8% — worse than showing nothing**, sources-only 68.2% (best). Converging at N=752 and N=559; Bansal et al. CHI 2021 (N=1,626) — explanations raise acceptance *regardless of correctness*. The favoured shape is **named steps**, each linked to what it touched (Buell & Norton 2011: itemised visible work beat a progress bar at **every** interval). | **In tension with C12/C14, which he asked for.** What shipped is nearer the good answer than the bad one: `ThinkingRow` carries **labels sourced from real tool boundaries**, and X2 structurally forbids model prose reaching a status surface, so the harmful condition — model *explanations* — is excluded by construction. The live risk is C14's expandable step detail growing into reasoning text. Worth a rule before it does. |
| **R3** | **The near-miss has no surface at all.** | Stack Overflow 2025 (n=31,476): the #1 frustration, **66%**, is *"AI solutions that are almost right, but not quite"* — against 84% adoption and **3%** who highly trust accuracy. | **A real hole, and the one D2 does not cover.** D2 is the strongest work in the pass and it is about *loud* failure; right card / wrong printing, right count / wrong set, is silent. Two riders: **auto-expanding every failure is itself a habituation risk** (Anderson et al. CHI 2015 — a dramatic drop in visual processing after the **second** exposure), and **a retry that changes no inputs is a slot machine** — II.5(h) records that `retry` re-runs the whole turn unchanged, which is exactly that shape. |
| **R4** | **A row per action is transparency theatre unless the rows are inspectable.** Click the row, land on the evidence; and flag rows that cannot be grounded. | HANSEL (N=14): 83.7% precision / 88.8% recall on evidence linking, with reduced task time and perceived effort. AAAI 2025 (N=303, 3,040 responses): citations raised trust **even when randomly drawn from unrelated queries** (β=0.394, p<.001), and **only 9.77% were ever checked**. | Against C36 / §7 E5 as built. `ToolRow` expands to a real region and `hintFrom` clips words from the row's **own** result, which is the honest half. Nothing links a row to the record it touched. |
| **R5** | **The known/guessed split is self-report, and self-report is ~53% accurate.** Rebuild it on **provenance**, not confidence. | MetaFaith — LLMs *"largely fail"* at faithful verbal uncertainty; Zhou et al. ACL 2024 — only **53%** of certainty-marked generations were correct, with ~90% reliance either way, and RLHF trains hedging out. | **Half-shipped in the right direction, by an owner ruling rather than by this evidence.** OR4 already forced the approval card onto **provenance, not a numeric meter** (`ApprovalCard.tsx:16-27`, C43), and `resolve.ts` keys `variantSource` on **candidate count** rather than on the model's opinion. The gap is that the *conversational* known/guessed split is not held to the same rule. |
| **R6** | **The card is not the safety mechanism, and should be shown less.** Gate on **irreversibility**, not on "it's a write". | Anthropic 2026: Claude Code users approve **93%** of permission prompts, *"over time that leads to approval fatigue"*; independently Bryant et al. 2014 — 461 physicians, 2,455 alerts, **93% override**. The same number, twice. Sandboxing cut prompts **84% while increasing safety**. | **Argues against C42/OR4, which he asked for by name.** Collection adds are tracked, in-boundary and reversible — the IRCI class where undo genuinely substitutes for a gate. The proposal: two cards with a known printing become an **undo affordance**, and the full card is reserved for uncertain printings and large batches, *preserving its salience by showing it less*. **Not to be acted on without him** — it reverses a ruling. Residual risk either way: the card's chrome is invariant though its rows are not, and habituation operates on presentation. |
| **R7** | **Nobody has measured this.** Instrument the accept rate over repeated exposures. | Outside Anthropic's 93%, **no published click-through rate for agent permission prompts exists** — and ours would be consumers rather than expert developers. | No instrument exists. Cheap, and the only row here that would *produce* evidence rather than consume it. |
| **R8** | **Deck-E will help your newest collectors and irritate your best ones**, and the same design cannot serve both. The world-class version **recedes as the user gets good, on evidence rather than on a setting nobody finds.** | Povyakalo et al. 2013 — 50 radiologists, 180 mammograms: **+0.016 sensitivity for the 44 weaker readers, −0.145 for the 6 strongest** on hard cases, an aggregate null hiding a sign flip. Signaling research: helps low-prior-knowledge users, redundant for experts. Anthropic telemetry: experienced users shift from approval-gating to monitoring, auto-approve 20%→40%. | **The largest item here and the least actionable as written.** `0d64f6c`'s dismissal is the crude version — a switch, which is the setting nobody finds. The research asks for *evidence-driven recession*, and nothing in the product measures user expertise. Not a complaint, not a defect, and not something to build without a ruling. |

**How to use this table.** None of these is a commitment. Two of them — **R6**,
and the framing of **R2** — would partially reverse things the owner asked for,
and reversing an owner ask on a literature citation is precisely the move
`OWNER-RULINGS.md` exists to prevent: they need a ruling, not an
implementation. **R3** and **R7** are the two that are additive, cheap, and
argue with nothing he said.
