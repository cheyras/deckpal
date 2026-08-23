# What is still open, and what to spend the next quota on

> **Superseded in part.** The "what to try next" ordering below was written
> before the external research pass. Read **`ESCORT-PLAN.md`** for the current
> plan of attack on the escort behaviour, and **`RESEARCH-UX.md`** for what the
> evidence says about the rest of what shipped. This file remains accurate on
> **what was measured and what was ruled out**, which is why it is kept.

Written at the end of the implementation pass. Everything here is **unfinished
on purpose** — the daily meter ran out mid-experiment — and it is written so
that picking it up is a ten-minute job rather than a re-derivation.

---

## The one open behaviour: he describes instead of escorting

**Gate 22 is RED and honestly red.** Asked *"help me find Pitch Black"* he looks
the set up and then tells you about it, rather than taking you there.

### What is measured

| | n | moved | via `journey` | described only |
|---|---|---|---|---|
| baseline, `/decks`, "help me find pitch black" | **10** | 2 | 2 | 8 |

Two smaller samples (n≈3 and n≈5) are consistent with that and are not worth
quoting separately. **The rate is roughly one in five**, not the near-zero my
first underpowered samples suggested.

### What is diagnosed, and is not guesswork

- **`stopWhen` is not the cause.** Traced through the SDK's own loop condition:
  when the model stops with an empty `toolCalls` array the loop exits *without
  consulting `stopWhen` at all*. Sixty runs, every one of them exactly two steps
  against a twelve-step cap. This whole class of explanation is ruled out.
- **`journey` is visible on step 0.** It is not in `allTools()`, so
  `openingTools`' write filter never removes it. Confirmed by reading, and by a
  variant that forced it into view and changed nothing.
- **He treats the sentence as the deed.** The failing turns end
  `finishReason: "stop"`, empty `toolCalls`, and text like *"I'll show you
  exactly where it lives"*. He is not declining to escort; he is stopping after
  promising to.

### The instrument was blind, and is now fixed

`probe.mjs` recognised only `tool-input-available` and `text-delta`, so a turn
where he **attempted** `journey` and had it refused by schema validation was
byte-identical in the output to one where he never tried. It now counts
`tool-input-error` separately and prints every part type it saw, so the next
thing it cannot see shows up as an unfamiliar name rather than as silence.

A SECOND blindness was found in the same instrument while trying to run that
re-baseline: MSYS path conversion was rewriting `--route /decks` into
`C:/Program Files/Git/decks`, so the probe asked the model to escort someone
standing on a route the app does not have. The **2/10 browser baseline above is
unaffected** — the gates never touch the probe — but the cheap prompt-tweak
comparisons were measuring a nonsense context. The probe now refuses a non-route.
See `ESCORT-PLAN.md` §1.

**This matters before anything else is measured.** "He rarely chooses it" and
"he chooses it and it silently fails" are different findings with different
fixes, and every number gathered so far cannot tell them apart. The one saved
stream from an escort turn against this branch's server contains no `journey`
mention at all — so for that sample he genuinely did not try — but that is n=1.

---

## Spend the next quota in this order

At a measured **$0.01153 per turn**, all of this is well under a dollar.

**1. Re-baseline with the fixed probe (n=10, ~12¢).** Answers the open question
directly: is he not trying, or trying and being refused? Everything below
branches on it.

**2. If he IS being refused** — read the `errorText` values and fix the schema
ergonomics. The ranked suspects, argued from the shape:
   - landmark-ref exactness (`[data-decke-x="y"]`, double quotes, no whitespace)
     synthesised several times per plan for pages he has never seen;
   - `ensure`'s two-argument requirement, whose name undersells its shape;
   - per-verb field bleed on a deliberately flat schema;
   - and the atomicity itself — one call bundling up to ten steps, all-or-nothing,
     competing against single-step tools that are cheap to retry.

   A structural asymmetry worth fixing either way: **the tool is forgiving about
   the world and unforgiving about the model's own drafting.** A landmark that
   never appears gets graceful partial credit with a structured reason; one
   mistyped quote voids the whole plan before a single step runs.

   The cheap first change is normalising landmark-ref syntax (accept single
   quotes, tolerate whitespace around `=`) — **zero client changes**, because
   `journey.ts` never re-validates shape and `querySelector` accepts either.

**3. If he is NOT trying** — measure the staged candidate below, then the forced
tool.

---

## Candidate A — the prompt reframing (staged, UNMEASURED)

Applies the template that already fixed this exact bug class **in this exact
file**: the write-approval doctrine — *"Never end a turn with 'Confirm?'…
writing it yourself instead of calling is exactly how the change fails to
happen"* — took writes from **0/20 to 9/20**. Same shape: a sentence
substituting for a tool call.

```diff
 press it, arrive, point at what they came for. That is one `journey` call.

+**Say it BY calling `journey`, not instead of calling it.** Never end a turn
+with "I'll show you the way" or "here's how to get there" about a walk you have
+already worked out — that sentence is the journey's opening `say` step, and
+writing it yourself instead of calling `journey` is exactly how the walk never
+happens and the reader stays exactly where they started.
+
 ### Where things live
```

**Net token delta ≈ 0** — it replaces a paragraph of the same length that was
cut for diagnosing the wrong failure (stopping after a *data dump*, when he
actually stops after a *promise*).

**It is unmeasured and must not be merged on the strength of the story.** Run it
with **both controls**: *"take me to pitch black"* must still JUMP (the project
pins this with its own gate, and this edit sits one paragraph below the jump
rule, so bleed-through would show there first), and a plain lookup must stay a
plain lookup.

## Candidate B — force the tool, which does not rely on persuasion

`prepareStep` can return **`toolChoice` per step** (confirmed in the pinned
`ai@7.0.66` type definitions), and this codebase already uses `prepareStep` for
`activeTools`. So on a later step of a turn whose intent is an escort, the
server can *require* a movement tool rather than ask for one.

That is the shape this codebase already prefers, in its own words about
grounding: *"the prompt forbids it and the prompt is not an enforcement
mechanism; this is."*

Worth trying after A, or instead of it if A does not move. It needs an intent
classification the server does not have today, which is the real cost.

---

## The rig, so none of this has to be rebuilt

- `local-chat.mjs` (session scratchpad) serves **this branch's** `api/chat.mjs`
  and proxies everything else to production — because `pnpm dev` proxies `/api`
  to the live backend, so the server half of this pass is otherwise not
  exercised at all. It reads env from the main checkout, never from a worktree.
- `probe.mjs` measures ~8 s a sample instead of the gate's ~90 s.
- `git worktree` copies plus one port each is what let three variants be
  measured at once.

## Other things left open

- **The wiki is committed but not pushed** (`C:/Users/cheyr/deckpal.wiki`,
  commit `c184f29`). AGENTS.md wants commit *and* push; the push is one command
  and is deliberately left to a human.
- **Gate 6 is a pre-existing false red** — its narration regex matches "Right
  there … header" in an answer that is correct and does fly there.
- **`.qa-account`'s fixture note says 12 owned cards; the database says 13.**
  The gates derive ground truth at run time, which is why they pass anyway.
- **The `journey` tool has never been exercised by the model**, only driven
  directly. Five hand-built journeys ran end to end against the live backend —
  complete, fail-stop, and cancel-on-gesture all verified — but the model
  choosing to emit one is the thing gate 22 is still waiting on.

---

## D8 — confirmed with pixels, and the obvious fix is ruled out

Filed, never looked at, and now looked at. **The visual harness runs on this
machine** — `playwright@1.62.1` is already in the repo's own pnpm store, so the
"deliberately not a dependency" rule costs nothing here:

```
PLAYWRIGHT_MODULE='E:/Users/cheyr/deckpal/node_modules/.pnpm/playwright@1.62.1/node_modules/playwright'   node scripts/visual-harness/capture-decke.mjs --scene close-reopen --base http://localhost:5204
```

Use `localhost`, not `127.0.0.1` — vite binds IPv6 and the loopback literal is
refused.

**It is real.** The `close-reopen` contact sheet has several frames in which he
is unmistakably diagonal — one at roughly 45°, lying across a series card at
close to full size. That is "falling rather than flying" and it settles a
question the brief could only guess at. He is upright and correct at rest; it is
purely the two long legs.

**And `LEAD_MAX` is not the cause.** Lowering the flight clamp **34° → 20°** and
re-capturing left poses of the same magnitude — about 45° still present. That
change has been REVERTED; `flight.ts` is untouched.

The reason is that the flight track's lean is not the only thing rotating him.
`DeckE.ts:2515` sets `rig.float.rotation` from `floatOut.rx/rz/ry`, and
`:2526-2531` feeds `pose.lean * 15` and `pose.twist * 12` into
`riderSystem.apply`. **Both are additive on top of the track**, so clamping the
track alone can never bound the composed pose. Whoever picks this up should
start at those two, not at the orientation constants.

**Also fixed while here:** the `close-reopen` scene could never run. Two elements
carry `aria-label="Close chat"` — the scrim (`DeckeChat.tsx:771`) and the
header's × (`:864`) — and `.first()` resolved to the scrim, whose click the
panel intercepts, so it retried until it timed out. Scoped to the dialog now.
The same shared-label trap that once made `readPresence` report the launcher
visible while it was unmounted; that is twice, and it is worth suspecting every
`getByRole(...).first()` in the harness.

---

## Two mobile defects, seen at 390px in the `chat-open` capture

Both visible in `.visual-harness/decke/chat-open/mobile/chat-open.viewport.png`,
neither previously recorded, and neither fixed — they want a careful look rather
than a blind edit.

1. **He overlaps the composer.** His body is drawn across the left end of the
   composer card, over the rounded outline and into the field. On desktop he
   stands cleanly beside it; at 390px there is not room for that composition and
   nothing gives way. B7's keep-out band handles the header, the nav and the
   install pill — the composer is not in it.
2. **The composer is clipped at the bottom edge.** The placeholder reads "Ask
   about your" with the rest below the viewport.

Ignore the orange **LIVE DATA** banner in that shot — it is `pnpm dev`'s
live-backend warning, not product chrome, and it is not in a build.

Desktop, by contrast, is correct and worth saying so: sidebar and header sharp,
content pane scrimmed, three openers, composer as a card, him beside it. OR1 as
ruled.
