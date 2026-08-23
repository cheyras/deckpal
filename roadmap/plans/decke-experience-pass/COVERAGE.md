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

**(e) The working tree moved while this audit was being written**, and three of
the rows below are affected. `git status` was clean at the start of the audit
and by the end carried uncommitted changes to `DECISIONS.md` (+240),
`ARCHITECTURE.md`, `SECURITY.md`, `apps/api/src/decke/prompt.ts` (+6) and
`apps/web/src/character/host/useDeckeChat.ts` (+17). Every status below is
assigned against **the 15 committed commits**, which is what "did this pass
ship it" means. But for honesty, the uncommitted work in flight is:

- **twelve `DECISIONS.md` entries** covering this pass, which is II.5(c) being
  remedied as it was written down. The finding stands for the committed branch
  and should be re-checked before it is acted on;
- **a prompt paragraph aimed squarely at C33 / gate 22** — *"A DESCRIPTION IS
  NOT AN ANSWER TO 'HELP ME FIND'"*. C33 is **NOT SHIPPED on the branch** and
  somebody is fixing it right now;
- **the `sayInstead` repair in the stream-error branch** of `useDeckeChat.ts`
  (the committed branch still writes `{ ...x, text }`, a field a message no
  longer has, so a connection failure announces nothing). That fix is described
  in this file's citation of `useDeckeChat.ts:868-887` because the audit read
  the working tree; on the branch as committed, **that dead end is still live.**

Line citations below were taken from the working tree and may be off by up to
17 lines in `useDeckeChat.ts` and 6 in `prompt.ts` relative to the branch tip.

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
| C7 | **UNVERIFIABLE HERE** | Tokens shipped and the drift cause is fixed: `--color-decke-scrim: rgb(26 23 22 / 0.68)` and `--decke-scrim-blur: 12px` (`theme.css:311-312`), consumed at `DeckeChat.tsx:583-585`. From 0.45/3px to 0.68/12px. Whether that reads as "far more blurred" **on his 4K desktop and on a real iPhone** is a looking question nobody in this repo can settle. **Settled by:** V5, plus one 4K desktop screenshot. |
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
| **C21** | **NOT SHIPPED — unnoticed gap** | PLAN §3 A7 ("an emotion beat when the answer arrives"). **Nothing implements it.** A grep for expression work across `apps/web/src/character/` and `apps/api/src/decke/` finds no new `express`/state beat; the only thing that happens at the first token is `decke.setOverlay('talk', 1)` (`useDeckeChat.ts:594`), which is pre-existing. §10 sequences A7 in step 2 beside A1/A2/A3/A6 — **all four of those shipped in `6967fee`; A7 alone was dropped silently**, and no commit, ruling or doc records the decision. |
| C22 | **PARTIAL** | §6 D4's deliverable was *"he gets the number"* — a recorded decision, not a surface. The number exists in `PLAN.md:640-645` and nowhere else: **no `DECISIONS.md` entry was written** (see II.5(c)), and `README.md` §6 still lists it as "still open". Nothing was measured after Phase E either. |
| C23 | **SHIPPED** | Two mechanisms: update-in-place (order no longer shifts), and `hintFrom` — *"a few real words clipped from its OWN result"* (`toolRowState.ts:79-90`) so a row reads as state, not intent. |
| C24 | **SHIPPED** | A hand edit in `apps/web/public/models/decke/playbook.json` — `thinking` plateau `gx -1.7 -> -6.0`, `gz 1.05 -> 5.0` — recorded in a `hand_edits` array *inside the generated file*, with a WARNING that regeneration reverts it. `gaze.test.ts` asserts where the pupils end up through the real `aimPupil` at both facings, so a silent revert fails loudly. |
| C25 | **PARTIAL** | The honest attribution is recorded (the hiccup was almost certainly his own back-gesture). The *hygiene fix* is **not shipped**: `DeckeHost.tsx:194` is still `(to) => navigate({ to })` with no `replace: true`, exactly as §6 D5 describes the defect. One line, planned, dropped. |
| C26 | **SHIPPED** | Two things: `facing?: number` added to `FlyOptions` (`DeckE.ts`), and — the actual fix — the chat park stopped asking him to stand ON a point and asks him to stand BESIDE the composer (`DeckeHost.tsx:433-443`), which is the `solvePark` branch that returns a facing. `arrive.test.ts` pins it. |
| C27 | **SHIPPED** | Same call site. `STAND_DESKTOP` survives only as the fallback when the composer landmark has not laid out (`DeckeChat.tsx:83`, `DeckeHost.tsx:444`). |
| C28 | **N/A** | Context; produced D6/D7, both shipped. |
| C29 | **UNVERIFIABLE HERE** | The mechanism is right and is the one OR1 demanded — **geometric, not a z-index swap**: the scrim's `top` is `calc(var(--app-header-h) + env(safe-area-inset-top))` (`DeckeChat.tsx:586`), fed by custom properties `AppShell` publishes (`AppShell.tsx:582`), so the blurred element does not extend under the header at all. **Settled by:** V5. **Residue:** PLAN §4 B2 item 3 — *"a nav tap minimises the chat deliberately"* — is **not implemented**; the header is live and a nav tap will navigate out from under an open conversation. |
| C30 | **SHIPPED** | `.decke-composer-card` (`theme.css:973-1004`) with `surface-secondary` plus border and shadow rather than `surface-raised`; the premium skin's recessed-well rule is defeated by counted specificity, not `!important` (`premium.css:224-243`); safe-area padding at `DeckeChat.tsx:941`. |
| C31 | **PARTIAL (verification)** | The umbrella is addressed by E1–E8 in code. But the project's own instrument for it, **gate 22, was last measured RED (intermittent, ~half)** in `27b4527`, and **no commit after the wayfinding work re-ran it.** The pass therefore ends with its own escort gate in an unresolved state. |
| C32 | **SHIPPED (server) + SHIPPED (client)** | Server: `journeySchema`, landmark-allowlist validation at *parse* time, no `wait` verb (`apps/api/src/decke/tools.ts:260-430,664`). Client: `character/host/journey.ts` — bounded conditional waits via MutationObserver (`:104-140`), `ensure` as the idempotent disclosure verb (`:259-295`), a zero-box refusal so a `display:none` sidebar link cannot be "pressed" invisibly (`:299-312`), and E6 cancellation on `isTrusted` gestures only (`:211-231`). **Undeployed**, and see II.5(e) for the mobile consequence. |
| **C33** | **NOT SHIPPED** | §7 E7 committed to "verify after E1–E3", with no fallback if verification failed. It failed (gate 22, above) and no fallback exists: `prompt.ts` still carries only the pre-existing *"when you move, keep what you say SHORT"* — a rule scoped to `travelling` turns. There is no brevity rule for a non-`travelling` turn, which is the hole the plan itself identified. C45's countervailing boundary is likewise unrecorded. |
| C34 | **SHIPPED (server)** | Better than the sitemap that was planned: an **addressing scheme** (`prompt.ts:230-263`, `ADDRESSING_LINES`) built from ids the data tools already return, plus the explicit negative that `[data-decke-nav="/series"]` does not exist at any width — confirmed by observation in a real DOM at 1440 and 393. |
| C35 | **PARTIAL** | The **chat-open** entrance is shipped (C3). The complaint's own frames — becoming large and centred over a loading spinner *after a navigation* — are **not addressed on the path they came from**: `uiTools.ts:363-369`'s `travelAfterRoute` still forces `via: 'background'` unconditionally, which is the mechanism the brief names. The distance threshold added at `uiTools.ts:245-256` covers bare `flyTo`, not the post-`goTo` flight. The journey sequencer sidesteps it by using plain `goTo` plus plain `flyTo` steps, so escorts are fine and ordinary `goTo`-with-selector is unchanged. The brief's explicit instruction — *"re-test this after C32 lands"* — was never carried out. |
| C36 | **SHIPPED** | `useDeckeChat.ts:814-827` emits a row **after** `runUiTool` returns, from its real result, through the same single writer as server chips. A step that never ran emits nothing, because the emitting line is only reached by a step that ran. |
| C37 | **SHIPPED** | The conversation column is `mx-auto max-w-[760px]` in the content pane and the composer is its foot (`DeckeChat.tsx:676-690, 939-1009`). |
| C38 | **N/A** | Context. |
| C39 | **PARTIAL** | The ad-hoc screen concept is untouched: `DeckeScreen.tsx` is **not in the branch diff** and its block kinds are unchanged. What landed for this complaint is the new part-list slot that lets more than one screen ride a turn (`ChatPart` `kind: 'screen'`). |
| **C40** | **NOT SHIPPED — built, then never wired** | `chat/CardRow.tsx` (153 lines, tested by `cardRowText.test.ts`) is the row-of-thumbnails widget he asked for by name — and **nothing imports `CardRows`.** `grep -rn CardRows apps/web/src` matches only its own file and its test. The Phase A commit says the presentation components "land unwired and get wired in the next commit"; `ChatMarkdown`, `ToolRow` and `ThinkingRow` were, `CardRows` was not, and no commit mentions it again. `DeckeScreen` still renders the old `cardGrid`. |
| C41 | **NOT SHIPPED — deliberate drop** | He hedged it himself. Part 2 asked for one sentence stating which surface owns progress, plus Q6 restored to §13; **neither happened**, and II.5(a) is the consequence arriving in code. |
| C42 | **SHIPPED (client) + SHIPPED (server)** | `chat/ApprovalCard.tsx` plus `chat/approvalCardState.ts` (779 lines, 26 pure tests, all passing here), the preview part at `api/chat.mjs:430`, and `variantSource` on the dry-run rows (`packages/agent-tools/src/resolve.ts`, classification keyed on **candidate count**, not resolution status, pinned by `resolve.test.ts`). |
| C43 | **SHIPPED** | Provenance, not a score — OR4 honoured to the letter, including the "no numeric meter" paragraph written into `ApprovalCard.tsx:16-27` as the answer to the future temptation. **One assertion left open by name:** a non-primary pick actually moving the non-primary variant's quantity needs a real write. |
| C44 | **N/A (directive), delivered** | `IDEAS.md`, 22 use cases re-verified against the real tool surface, three cost claims corrected, three ideas rejected. A menu, not a build, as asked. |
| C45 | **N/A** | Context — and its boundary is still not carried anywhere, which is half of C33's gap. |
| C46 | **PARTIAL (mechanism, not complaint)** | The scroll lock **stays** (`DeckeChat.tsx:405-410`), per §11c — a ruling made by the planner, **not by him**, and never put to him. What was fixed is the transcript: `pointer-events-auto` moved onto the scroller (`:717-722`) and the unconditional `scrollTop = scrollHeight` gained a stick guard (`:472-504`). If his complaint was literally "the page behind will not scroll", it is deliberately unmet; if it was "I drag and nothing happens", it is met. |
| C47 | **UNVERIFIABLE HERE** | Fixed *by construction* rather than by padding: the panel starts below the app header, so the close button cannot be in the status bar (`DeckeChat.tsx:630`, `:650-660`, with an explicit note that the row takes no second safe-area inset). **Settled by:** V5 on an installed PWA. |
| C48 | **SHIPPED** | Three separate causes, all fixed: `mt-auto` on the list rather than `justify-end` on the scroller (`DeckeChat.tsx:773`, with the `scrollHeight === clientHeight` trap written down at `:692-699`), pointer events, and the stick guard. |
| C49 | **N/A** | Context. CDP safe-area emulation exists (V3) and is not a substitute for V5. |
| C50 | **SHIPPED** | Composer card, transcript fade **mask** (`theme.css:1019-1023` — a mask rather than a gradient, because what is behind it is a live blurred page), and the approval block as its own card with a gap (`ApprovalCard.tsx:291`). |
| **C51** | **NOT SHIPPED** | Part 2 predicted this and the code confirms it. `§4 B5` put a **card around** the input; the input itself is unchanged — `DeckeChat.tsx:962-969` is a single-line `<input>` at a fixed `h-[40px]`. **No** multiline auto-grow, **no** control row inside the card, no resting/focus/typing states beyond a border colour, and the string "Prompt Bar" appears nowhere in the branch. His words were *"I don't love the design of the input at all"*; the input is the one thing that did not change. |
| C52 | **PARTIAL** | "No model picker" is satisfied (there never was one). **The slot was not built** — there is no `+` and no attach affordance anywhere in the composer (`DeckeChat.tsx:943-1008` is input plus one send/stop button). `README.md` §5 records this as *"deferred, slot built but unwired"*; the code does not match that claim. |
| C53 | **N/A** | Directive about process. |
| **C54** | **NOT SHIPPED** | Ships or falls with C21 — OR3's recovered request was to be implemented *as part of the same expression work*. There is none. |
| C55 | **N/A** | Context. |
| C56 | **SHIPPED** | Two halves, and the second is the one that would have quietly broken it: the park box is the panel's bottom-left corner (`DeckeChat.tsx:1028-1047`), and the keep-out **bottom band is zero while the chat is open** (`DeckeHost.tsx:754`) precisely so a composer-sized band cannot shove him off the placement he asked for by name. |
| C57 | **N/A** | Context. |
| C58 | **N/A** | Context. |
| C59 | **N/A** | Context; folds into V5. |
| C60 | **SHIPPED** | `ToolRow.tsx:16-20` states it as a design rule and the markup honours it — flat inline text, no `select-none` anywhere in the chat surfaces. |

### C-column totals (implementation)

SHIPPED **29** · SHIPPED (server-only) **6** · PARTIAL **8** ·
NOT SHIPPED **6** · UNVERIFIABLE HERE **3** · N/A **8**

Server-only rows (code read, unit-tested, **not exercised by the running app**):
C17, C20, C32, C34, and the server halves of C18 and C42.
NOT SHIPPED: **C21, C33, C40, C51, C54** are gaps; **C41** is a sanctioned drop.

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
| D8 | **NOT SHIPPED — unnoticed** | No fix, and — the part Part 2 asked for explicitly — **no V4 assertion was added either**: `grep -rn "upright\|tilt\|tumbl" scripts/` is empty. The `via: 'background'` distance threshold (`uiTools.ts:245-256`) plausibly dissolves it for short hops, exactly as the brief predicted, but nobody has looked and nothing will tell them. |
| D9 | **N/A** | Investigated and dismissed in the brief. |
| D10 | **SHIPPED, and the open design question was answered** | Part 2 said the brief's fork — one hoisted shared lazy boundary versus a smaller inline subset — was never chosen. The implementation chose a **third** and stated it: one shared lazy boundary whose `Suspense` fallback is the raw text with `whitespace-pre-wrap` (`ChatMarkdown.tsx:18-26, 49`), so the worst case is "no worse than before" rather than a 280px bubble that measures at zero height and gets placed there. Wired at `DeckeBubble.tsx:145`. |
| D11 | **SHIPPED** | Same keep-out mechanism. It is a **clamp, not a veto** (`DeckeHost.tsx:614-618`), which is what keeps "must not cover the header" and "must be able to point at a nav item" from contradicting each other — and the clamp applies to *placements* only, never to the per-frame scroll track, or the off-screen beacon would have become unreachable dead code. |
| D12 | **SHIPPED** | Tap-and-wait per OR2, and the three consequences are each handled: the chip does not unmount at open (`DeckeHost.tsx:785`), it rises to `z-[26]` (`DeckeButton.tsx:164`), and a failed load says so and offers the way back (`DeckeButton.tsx:126-141`, `theme.css:880-895`). Plus the defect the pass created and caught: a question typed before he arrives is now **held and shown** rather than evaporating (`useDeckeChat.ts:291-321, 425-439`), with a 45s ceiling. |
| D13 | **PARTIAL** | **New controls: genuinely good, checked one by one rather than assumed.** `ToolRow` — `aria-expanded`/`aria-controls` over a real region, an always-mounted live region so the failure announcement is not missed (`:119-121`), a retry button whose label names the tool (`:156`). `ThinkingRow` — `role="status" aria-live="polite" aria-atomic` on the label only, with the 2 Hz timer deliberately outside it and an `sr-only` prose duration (`:125-128`). `ApprovalCard` — every removal is a labelled `aria-pressed` button naming the card (`:127`); pickers are a `role="radiogroup"` with an accessible name (`:223-224`). Empty-state openers are real buttons with visible focus rings (`DeckeChat.tsx:753-767`). **What is still missing, all three of them pre-existing:** (1) **the transcript is still not a live region** — no `aria-live` anywhere in `DeckeChat.tsx`, so the minimised bubble announces and the main surface does not; (2) **`role="dialog" aria-modal="true"` (`DeckeChat.tsx:609-611`) with no focus trap and no focus restore** — focus is pushed to the input on open (`:422`) and nothing constrains or returns it, and the panel is `pointer-events-none` so the page behind is genuinely still reachable by Tab: the `aria-modal` claim is false; (3) the `role="radio"` buttons are all individually tabbable with no arrow-key roving, which is not the ARIA radiogroup pattern. |
| D14 | **SHIPPED — and the plan was backwards about it** | Part 2 flagged that §3 A6 promised the fix while forbidding `GAZE_GAIN`/`PUPIL_ROAM`. The implementation resolved it without touching either: the pupil sitting at the clamp is the **baseline at this staging** (the camera is 45.6° off each eye's axis where the eye saturates at 24.2°), so thinking could not make it worse, and a gaze that genuinely reads as "away" is one that comes **off** the clamp. A6 done properly *is* the D14 fix. Recorded in `playbook.json`'s `hand_edits.why`. |
| D15 | **SHIPPED** | Dissolved by the layout change rather than fixed on its own — the panel starts below the header at every width. Claimed looked-at at 1440 and 1100 (the reported width). |
| D16 | **NOT SHIPPED** | Out of scope, correctly (`§12`). |

### D-column totals (implementation)

SHIPPED **10** · PARTIAL **1** (D13) · NOT SHIPPED **4** — of which D5 and D16
are rulings, **D8 is an unnoticed gap**, and D9 is not actionable · N/A **1**.

D1 and D2 each have a server half that is undeployed (II.0(a)).

---

## II.4 The cross-cutting constraints

| | Status | Finding |
|---|---|---|
| **X1 — reduced motion ships with the motion** | **SHIPPED, and it holds under audit** | I enumerated every animation added in this branch. Every one has a reduce path, per-element, with **no blanket rule**: `decke-chat-in` / `sheet-panel-up` (`DeckeChat.tsx:641-642`), `sheet-scrim-in` (`:590`), `decke-composer-drop` (`:957`), `decke-button-in` and `decke-bob` (`DeckeButton.tsx:168,183`), `decke-wake-sweep` (`theme.css:860-875` — a `no-preference` block for the travel and a **reduce block that keeps the ring**, because removing the signal is worse than the motion), `ThinkingRow`'s ring (`:160-170`), `ToolRow`'s ring (`:65-76`), `DeckeBubble` (`:121`), `decke-shift` (`theme.css:955`). Engine side: `reduced` is a constructor flag the **host** owns (`DeckeHost.tsx:510-524`), watched live so turning the preference on mid-session stops the motion now, and `playEntry`/`flyTo` take a **different code path** rather than a disabled one. The thinking counter deliberately keeps ticking under reduce, because there the number *is* the signal. **Nothing failed this check.** |
| **X2 — truthfulness** | **SHIPPED** | Movement rows are emitted after the tool returns, from its real result (`useDeckeChat.ts:814`); beats return `null` rather than something plausible; `ApprovalCard` has no prop through which model prose can reach the dialog. |
| **X3 — approval semantics** | **SHIPPED** | The prompt change (`prompt.ts:536-543`) replaces "use the primary and say which you used" with "call the tool anyway", keeping the sentence whose absence took writes from 0/15 to 21/30 and touching neither protected string. The reason it *had* to change is sound: under the new card that row is not written unless picked, so the old instruction would have him narrate a printing in the same turn the dialog asks about it. |
| **X4 — widen the audit first** | **SHIPPED** | Its own commit (`325f01a`), before any marking, and the detector was itself pinned by fixtures. Verified failable. |
| **X5 — contracts** | **PARTIAL** | B12 honoured (QA account). B11 not applicable (no new env var). **CI wiring honoured** — `test:variants` got its own `ci.yml` step and `test:decke` was widened to the new `chat/__tests__` directory. **Docs contract broken** — see II.5(c). |

---

## II.5 Findings the row tables do not carry

### (a) Every tool row is rendered **twice** while a turn is busy — and a failed one is visible twice

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

`chat/CardRow.tsx` and `chat/cardRowText.ts` are complete, documented and
tested, and nothing renders them. See C40. `messageIsEmpty`
(`DeckeChat.tsx:219`) is likewise exported and never called.

### (c) Zero `DECISIONS.md` entries for eleven commits of product work

`git diff main...decke-experience-pass -- DECISIONS.md` adds **one** entry — for
the visual harness, in `34d3914`, before any product code was touched. `PLAN.md`
§11 names **eleven** decisions to record; `README.md` §2 lists *"`DECISIONS.md`
and the wiki Decision-Log together, same sitting"* as a non-negotiable. None of
the eleven were written. Part 2 already flagged §6.3 and §6.10 as "addressed,
NOT recorded"; the true figure is that **nothing** from this pass is recorded,
including the two entries that restore reversed decisions (§11.1, §11.2) and
the semantic change to a live write path that `README.md` §7 calls out as easy
to get wrong.

### (d) `COVERAGE.md` was never updated during the pass

`README.md` §8 makes it a per-phase requirement, in the same words this audit
was commissioned in: *"keep it true, or '60 complaints' becomes a number nobody
can check."* Every phase declared itself done without touching this file.

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
  two tabs are unaddressed.

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

**What it is not is finished.** Ranked worst first, by what I judge actually
matters to the person who recorded the critique:

1. **C51 — the input.** He said, in as many words, that he did not love the
   design of the input, named the reference component, and the brief gave it its
   largest section. The composer got a card *around* a 40px single-line field
   that is otherwise unchanged. Of everything here this is the most likely to
   make him say "you did not do the one I asked for".
2. **C21 + C54 — the emotion beat.** Two complaints, one of them his own
   recovered lost request (OR3), sequenced beside four items that all shipped in
   one commit, and dropped with no record anywhere. Small work; it is the
   difference between a character and a spinner.
3. **The double-rendered tool row (II.5(a)).** A visible defect on the failure
   surface this pass exists to protect, introduced by this pass, catchable only
   by looking.
4. **C40 — the card rows.** A named feature ask, fully built and tested, wired
   to nothing. It reads as delivered in the commit log and is invisible in the
   product.
5. **C33 and gate 22.** The pass ends with its own escort-quality gate last
   observed red, never re-run after the work meant to fix it, and with no
   committed fallback if it stays red.
6. **No `DECISIONS.md` entries (II.5(c)).** Eleven planned, zero written,
   including two that restore reversed decisions and one semantic change to a
   live write path. The item most likely to cost a future session real time.
7. **D13's `aria-modal` claim.** The new controls are genuinely well done; the
   container still claims a modality it does not have, and the transcript still
   does not announce.
8. **C52 — the `+` slot** that `README.md` §5 says was built, and was not.
9. **C25 — `replace: true`.** One line, planned, dropped; it matters more now
   that Phase E makes hops routine.
10. **C35 and D8 — the flight profile.** Both were to be *re-looked at* after
    the navigation work. Neither was, and D8 did not get even the one-line V4
    assertion Part 2 asked for.
11. **C46's ruling was never put to him**, and it is a planner's ruling on a
    blocker-severity complaint.
12. **C39 — ad-hoc screens untouched**, and the C41/Q6 question still closed by
    omission — which is what II.5(a) is.

**On the mobile half, stated plainly:** C7, C29 and C47 are correctly
*mechanised* — the geometric scrim offset is the right fix, and I checked that
the desktop stacking argument holds too — and **none of the three is verified.**
Chromium reproduces the geometry and not the compositing. They need V5 and
nothing else will do.

**On the server half, stated plainly:** `partial` phases, every progress beat,
the approval preview part, the `journey` tool, the step-budget message and all
prompt changes are **not exercised by the running app**, because `pnpm dev`
proxies to production. Their evidence is 157 passing unit tests — good evidence
about logic, none about the wire. The Phase E commit's "five real journeys
against the live backend" is the one claim in this branch I could neither
confirm nor refute: there is no gate, no scene, no artifact and no recorded
`--base`. **A deployed preview plus a re-run of gates 5, 12 and 22 would settle
the whole server half in one sitting**, and would also close item 5 above.
