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
