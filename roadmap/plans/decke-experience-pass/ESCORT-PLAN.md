# Why he describes instead of showing you — and what to do about it

**Revision 2.** Written after external research, then substantially rewritten
after an adversarial consult (Fable) read the code rather than my summary and
took out the load-bearing beam. Revision 1's diagnosis is preserved in §0c
because being wrong in a specific way is part of the record.

**Budget: about a dollar.** At a measured **$0.01153 per turn**, every experiment
below costs cents; the constraint is the QA account's 120-turn daily meter
(UTC-midnight reset, `apps/api/src/decke/meter.ts:119-133`), not money.

---

## 0. The cause: it is not that he will not, it is that he cannot cheaply

**The control group is inside our own system, and it exonerates the wiring.**

| Tool | What its argument is | Measured |
|---|---|---|
| `goTo` | one route string | **100% nav** (5/5, `models.ts:159`) |
| `express` | a flat array of enum-ish commands | called routinely |
| **`journey`** | **a compiled multi-step program** | **skipped 8/10** |

Same wiring, same prompt, same model, same step in the turn. The variable that
separates the tool he skips from the tools he calls is not position, name,
description length, or visibility — **it is what he must construct to use it.**

*(One honest wrinkle: the 100%-nav row is `grok-4.1-fast-non-reasoning`, the
predecessor. The current `grok-4.20-non-reasoning` was adopted because it fixed
`flyTo` reliability 0/5 → 5/5 — `README.md` §6 — so movement tools demonstrably
work on the incumbent too. The comparison holds; the row is not from the exact
model.)*

To emit a valid escort from `/decks`, in one pass, with **no reasoning tokens**,
he must:

1. **Resolve a contradiction the prompt hands him.** The escort is sold as
   *"point at what to press, press it, arrive"* (`prompt.ts:601`) — but
   `prompt.ts:639` states there **is no `[data-decke-nav="/series"]`**, so the
   first hop cannot be a click and the "escort" must open with a `goTo` teleport.
2. **Synthesise 3–5 exact attribute selectors**, double-quoted, for pages he has
   never seen, from a template grammar (`prompt.ts:260-264`).
3. **Remember that unowned series hide** behind `[data-decke-show-others]` and
   need a two-argument `ensure` (`prompt.ts:660-664`).
4. Keep every `say` under 200 chars, every field on the right verb, **the whole
   plan atomic** — one mistake voids everything (`tools.ts:408-423`).

Against that, the alternative continuation available at the same decision point
is **two sentences of prose** — and the lookup he just ran already answers the
literal question in the informational sense. *A non-reasoning model at a boundary
between a two-sentence exit and a ~300-token exactly-quoted program takes the
exit.* **2/10 is what sampling noise around that boundary looks like.**

### This retro-explains my own results, which otherwise look inconsistent

The *"never end a turn with 'Confirm?'"* doctrine moved **writes 0/20 → 9/20**.
The same template did **nothing** for the escort. That is not a mystery once the
barrier is named:

> **The write barrier was permission-anxiety — "may I".** The call itself
> (`log_cards`, a few fields) was easy, so a sentence that removed the hesitation
> worked. **The escort barrier is "can I".** Prompt emphasis lowers reluctance; it
> cannot lower construction cost.

Every prompt lever measured at roughly nothing because every prompt lever was
aimed at the wrong barrier.

## 0b. Two real configuration defects, found by reading and free to fix

**`goTo` and `journey` claim the same trigger.** Verified:

- `tools.ts:582` — *"Use this whenever they ask to be TAKEN **or SHOWN**
  somewhere that is a page"*, then three lines building
  `/series/mega-evolution/me05` — **our exact query**.
- `tools.ts:666` — *"Use it when they ask to be **SHOWN the way** — 'help me
  find', 'where is', 'how do I get to'"*.

*"Help me find Pitch Black"* matches both, and `goTo` is heavily primed for this
specific case. **Contested selection between two tools is a documented cause of
calling neither** — decision conflict raises the probability of the default
action, which is text. Consistent with the data: of 10 runs, **2 chose `journey`
and 0 chose `goTo`-only**. He is not picking the rival; he is picking neither.

**The prompt canonises prose-first.** `prompt.ts:655`: *"`say` — one line, out
loud, **before the move it belongs to**."* So the canonical first action of every
escort plan is the one step type expressible in his native channel. See §3b —
this is a mechanism, not just an aesthetic.

## 0c. What revision 1 got wrong, kept on the record

I led with **ToolFailBench** — 12–29% tool-skip across 19 models, best-in-class
11.8% on the Grok family — and concluded *"we are 3–7× worse than baseline, so
something in our setup is misconfigured."*

**That compares the wrong task class.** ToolFailBench measures skip on single
tools with simple arguments. `journey` is one-shot program synthesis. The
benchmark's 11.8% and our 80% are not measuring comparable acts, and the gap I
treated as evidence of misconfiguration is mostly evidence that I picked a
yardstick that did not fit.

The internal control group above is the argument I should have made from the
start: it holds the model, the prompt, the SDK and the turn position constant and
varies only argument complexity. **It was available the whole time.**

What survives from revision 1: **vercel/ai#10269** is still this exact bug on
this exact SDK, and its maintainer's *"anything in the system prompt is not a
guarantee of behaviour"* is still right — it just turns out to be right for a
reason I had not identified. And #10269 shows this failure with tools that have
no `say`-like verb, which matters in §3b.

---

## 1. Fix the instrument first — twice blind, now guarded

`probe.mjs` recognised only `tool-input-available` and `text-delta`, so a turn
where he **attempted** `journey` and had it refused by schema validation was
byte-identical to one where he never tried. Fixed: it counts `tool-input-error`
separately and prints every part type it saw.

### And a second blindness, found while trying to run step 1

MSYS (Git Bash) path conversion turns `--route /decks` into
**`C:/Program Files/Git/decks`** before node sees it, so the probe was telling
the handler the reader was standing on a route this app does not have — and the
run still completed, still streamed, and still produced a number.

**What that invalidates.** The **2/10 baseline is safe** — measured through a
real browser via the gates, which never touch the probe. The **cheap prompt-tweak
comparisons are not**: the 0/3 and 1/5 readings I correctly called noise were
also asking the model to escort someone standing nowhere.

The probe now **refuses** a non-route rather than un-mangling it — the prefix
MSYS prepends is its own install root, recovering it is guesswork, and a guess
would reintroduce exactly the silent-wrong-answer failure the check exists to
end.

**Step 1 (10 turns, ~12¢): re-baseline.** The "empty `toolCalls`" observation
predates both fixes and may not survive them. Everything below assumes it does.

---

## 2. The change that attacks the cause: stop making him write the program

> **BUILT, AND NOT YET MEASURED** — commit `cbd3ce0`. `escort` ships, the two
> §0b defects are fixed, 643/643 across nine suites, typecheck 0, and the
> builder is verified failable (breaking it three ways fails five tests). What
> has NOT happened is a single real turn: the meter was exhausted. **Nothing
> below is demonstrated until §6 runs.**
>
> Gate 22 was also structurally incapable of passing this: it filtered wire
> tools to `goTo`/`click`, which a one-call walk never emits, so a perfect
> escort scored the same as a description. Fixed in `4f3f129`.


**Keep the compound execution contract. Take the compilation away from the
model.**

The premise is stated in our own file header, `journey.ts:12-17`:

> "the selectors are constructible from ids the data tools return BEFORE anything
> moves. Given `seriesSlug: mega-evolution, setId: me05`, the whole path — nav
> row, series card, set row — can be written down without having seen any of
> those pages."

**That file argues for one-plan-not-four-turns by proving the path is
deterministic, and then hands the deterministic compilation to the model
anyway.** If the path is constructible from `(seriesSlug, setId)`, asking him to
hand-assemble it spends an 80%-failure model decision on something `tools.ts`
could do in twenty lines.

**So: a macro tool.** `escort({ seriesSlug, setId, opener? })` — one per route
shape in `ROUTE_SHAPE_LINES`, or one with a small discriminant — whose
**server-side execute expands to the journey steps** and forwards them down the
existing client contract unchanged.

| | before | after |
|---|---|---|
| What he must emit | a 3–5 step exactly-quoted program | **two fields he was just handed by `search_cards`** |
| Difficulty class | one-shot program synthesis | **`goTo`'s — which measures 100%** |

What is preserved: **restraint** (still a choice, not a forced path);
**the deixis product** (same sequencer, same outline, same interleaved `say`s,
now template-inserted or taken from `opener`); and **free-form `journey`**, which
stays for genuinely novel walks.

This is the Pulumi principle from §5 applied one level deeper — *"traditional
software engineering outperforms prompt engineering for deterministic tasks"* —
and it is **the only option on the table that attacks the cause rather than
compensating for it.**

**The free fixes, folded into any arm** (§0b): delete *"or SHOWN"* from `goTo`
and keep the trigger phrases exclusively on `journey`; and say plainly in the
journey section that an escort may **open** with a `goTo`, reconciling
`prompt.ts:601` with `prompt.ts:639`.

---

## 3. The levers, re-ranked

### 3a. `inputExamples` — and now I understand why it should work

Anthropic's troubleshooting guide has a row for exactly this symptom: *"Claude
never calls your tool"* → **add `input_examples`**. Our SDK supports it
first-class (`inputExamples` on the tool, plus `addToolInputExamplesMiddleware()`
for providers without native support — which is our case through the Gateway).

**The mechanism matters, because it dictates the example's content.** For a
non-reasoning model a worked example is **borrowed chain-of-thought**: it turns
*"compile a program under a grammar"* into *"instantiate a template."* That is a
direct attack on §0 — **the only persuasion-class lever that lowers construction
cost rather than reluctance.**

So the example must be the **actual hard case**: the `/decks` → set-page escort,
including the `goTo /series` opening hop, the `ensure` via
`[data-decke-show-others]`, and exact selector quoting. *A toy two-step example
teaches nothing the description didn't.*

**And the demonstrated assistant turn must contain no prose before the call.**
Preamble-suppression has to be *shown*, not *requested* — requesting it is the
system-prompt lever already measured at zero.

**Experiment (20 turns, ~23¢).** Expected: meaningful movement, not target on its
own.

### 3b. `say` overlap — a real aggravator, not the root

**For.** The failing sentence *"I'll show you exactly where it lives"* is
functionally the plan's opening `say` emitted through the cheaper channel; the
client's `say` case is literally `ctx.say(text)` into the same transcript surface
(`journey.ts:240-246`), so the two are near-substitutes by construction. And
there is an autoregressive mechanism, not just an ambiguity: because `say` is
instructed to come **first** (`prompt.ts:655`), he naturally begins the message
in prose — and **P(tool call | substantive prose prefix) is low**, since tool-call
tokens are trained to appear at message start or right after a tool result.
`say`-first invites the prefix; the prefix suppresses the call; `stop` is the
likeliest terminator. **That predicts the exact trace: promise, empty
`toolCalls`, `finishReason: "stop"`.**

**Against.** #10269 shows the identical promise-then-stop with tools that have no
`say`-like verb, so the overlap is **not necessary** for this failure class. The
trace cannot distinguish *"he executed the say step in prose"* from *"he emitted
a generic preamble and lost the thread"* — **unfalsifiable on current evidence.**
Both 2/10 successes presumably carried `say` steps and called anyway. And
`express`, which also shadows a quasi-native channel, gets called fine.

**Verdict: demoted.** Removing `say` outright trades away the interleaved
narration that *is* the product (§5's evidence is deixis **plus timing**). The
smaller surgery: make `say` explicitly **optional**, tell him his chat text is
the journey's overture, and show the tool-call-first example from 3a. Run the
clean removal only as a cheap single-variable arm if quota allows; **do not ship
it alone.**

### 3c. Force via `prepareStep` — and it is also the experiment that adjudicates §0

`prepareStep` receives `steps` (verified in `ai@7.0.66`), so the condition is
expressible: *lookup returned and no journey emitted → `toolChoice: { type:
'tool', toolName: 'journey' }`; otherwise `auto`.* The discriminant is `'tool'`,
not `'tool-call'` — the maintainer's own snippet is wrong for our version
(verified against `dist/index.d.ts:143`).

**Two things revision 1 got wrong about the risk:**

- **The #3944 endless loop cannot occur within one request.** `journey` has **no
  server `execute`** (`tools.ts:678`) — emitting the call *ends the server turn*,
  because the browser fulfils it.
- **But there is a cross-leg hazard I had not identified.** The browser posts the
  journey result back as a **new request with a fresh `steps` array**, so a gate
  written as *"lookup resolved this request ∧ no journey emitted this request"*
  **re-fires and forces a second escort.** The gate must consult conversation
  history for a `tool-journey` result, not just this request's steps.

**And forcing is the best measurement instrument available**, because under
compulsion the *argument quality* adjudicates §0:

| Forced calls arrive… | Then the barrier was… | Go to |
|---|---|---|
| well-formed | selection reluctance | 3a / 3b were the right levers |
| as `tool-input-error`s | **construction cost** | **§2 stops being an option and becomes the conclusion** |

Either outcome is informative in a way the persuasion levers are not.

**Costs still owned:** prompt-cache invalidation from varying `toolChoice`
(mitigate by placing the cache breakpoint before the variation point), and we
delete irrelevance detection for that turn — BFCL scores declining-to-call as a
first-class capability across 875 cases.

---

## 4. The deterministic fallback — ship it as a floor, and key it on the reader

Pulumi's lesson from shipping Copilot: *"traditional software engineering
outperforms prompt engineering for deterministic tasks."*

**Key it on the user's intent, not on detecting his promise.** Classifying his
prose is another model-shaped problem, and *a false-positive silent `goTo` after
an unrelated answer is a worse defect than a missed escort.* So: a regex on the
**user** message (`help me find|show me where|how do I get`) **and** a resolved
destination from this turn's own lookup **and** no movement tool called.

Then **re-issue the step with `toolChoice` forced** — §3c's machinery, triggered
reactively — because that can still produce the tour. **Degrade to a bare `goTo`
only if the forced call fails validation.**

This caps the worst case at *"he took you there without the tour"* rather than
*"he told you about it"*, and it does not depend on the model cooperating.

---

## 5. Is the escort worth building at all? Yes — but for the pointing, not the tour

I first wrote this section against a single NN/g study and concluded the escort
looked unjustified. **That was underpowered and I had the wrong literature.** The
UX research pass turned up controlled evidence with far more weight, and it
points the other way.

**The pointing is the measured product. The character is packaging around it.**

| What | Effect size | Base |
|---|---|---|
| Signaling / cueing (Richter, Scheiter & Eitel 2016) | **d = 0.52** | 44 effect sizes, N=2,726 |
| Signaling / cueing (Alpizar et al. 2020) | **g = 0.38** | meta-analysis |
| Anthropomorphism → trust (Blut et al. 2021) | r = .19, **CI [.00, .38]** | 108 samples, N=11,053 |
| Pedagogical agents (Schroeder et al. 2013) | g = 0.19 | 43 studies, N=3,088 |

The agent-gesture meta-analysis (20 experiments, N=3,841) locates the benefit
specifically in the **deixis** — the pointing itself. So **`journey` is the part
of Deck-E with the strongest evidence behind it**, worth roughly 2–2.5× the
character it is attached to. Making him actually do it is the highest-value
behavioural fix in the product, not a nice-to-have.

**The caveat has teeth, and it also dissolves the NN/g conflict.** Signaling
helps **low-prior-knowledge** users and is **redundant for experts**. The NN/g
tutorial null and the cueing meta-analyses are not in contradiction — they are
measuring different users. That resolves as a design rule rather than a
cancellation:

> **Deck-E should escort the new collector and get out of the expert's way**, on
> evidence of their behaviour rather than on a setting nobody finds. The same
> design cannot serve both — Povyakalo et al. (2013) found a CAD aid that raised
> sensitivity for 44 weaker radiologists and *lowered* it for the 6 strongest, an
> aggregate null hiding a sign flip.

Retained from the first draft, still true and still worth stating: the NN/g
result (91% vs 94% success n.s., 93.49s vs 85.17s n.s., perceived difficulty
**4.92 vs 5.49 significant**) tests **unsolicited, pre-task tutorials**. Ours is
on-demand, which is a materially different contract. It is a reason to keep the
escort on-demand, not a reason to drop it.

**Nobody has published "character guidance vs coach marks."** The researcher
flagged that as the gap that most concerns them, given it is Deck-E's entire
premise. Still ours to run, and still not a blocker.

### While the escort is being fixed, fix how it moves

**Heer & Robertson, IEEE TVCG 2007** (two controlled experiments) is the closest
empirical analogue to what `journey` does: animated transitions significantly
improve graphical perception, and **staged transitions beat direct
interpolation.** So a hop should **anticipate → travel → settle → *then* outline**,
not linearly tween and highlight on arrival.

**And the gaze must be event-locked.** Andrist et al., HRI '14 (N=30, 150
observations per measure): well-timed aversion rated **5.44** for thoughtfulness
against **4.67** static and **4.14 badly-timed** (F=27.97, p<.001). **Badly-timed
scored worse than not doing it at all.** Their corpus numbers are directly
usable: aversion begins **~1.32s before** the cognitive event, lasts **~3.54s**,
and goes **up**. Drive it from a real inference start, never an idle timer — and
return to direct gaze on delivery, because direct gaze is what buys warmth.

**Do not encode meaning in *which way* he looks.** Up-left-means-recall is NLP
eye-accessing-cue folklore, killed by Wiseman et al. 2012 (PLoS ONE, three
studies) — study 3 observed **no upper-left or upper-right gazes at all**.
Aversion under load is real and upward is the cognitive direction; directional
*semantics* is not.

### One number not to repeat

The widely-circulated *"82% of tooltips dismissed within 1.2 seconds"* and
*"68% higher engagement"* figures attributed to NN/g **do not appear on
nngroup.com** and should be treated as fabricated. Likewise Material 3
Expressive's "4× faster to spot elements" (vendor-asserted, no peer review, no
effect sizes) and the Duolingo mascot DAU figures (no locatable primary source).

---

## 6. What NOT to do

- **Do not put the nudge in the tool result.** Anthropic's troubleshooting page is
  explicit: instructions inside tool results are treated as untrusted third-party
  content. Keep tool results to data; use `prepareStep`'s `instructions` instead.
- **Do not add more system-prompt emphasis.** Measured here at roughly nothing,
  measured in #10269 at "marginal", and this file's own history records that more
  words made it worse repeatedly.
- **Do not adopt the GPT-5 "tool preamble" explanation.** It fits the *shape* —
  OpenAI trained models to announce plans before calling, and *"I'll show you"* is
  a textbook preamble — but **we are on Grok, not GPT-5**, so the training story
  does not transfer. The behaviour is the same; the cause is not established.
- **Do not run n=10 and believe it.** Distinguishing 20% from 40% needs ~50 per
  arm. Small n is for direction, not for decisions.

---
- **Do not reach for another external benchmark as the headline argument.** That
  was revision 1's mistake (§0c). The control group that holds model, prompt, SDK
  and turn position constant is **inside this system**, and it was available the
  whole time.

---

## 6b. The experiment, for the moment the meter resets

Order matters; each answers something the next depends on.

| # | arm | turns | asks |
|---|---|---|---|
| 1 | **baseline, `journey` only** (revert `escort` in a worktree) | 10 | does the 2/10 survive the two probe fixes? |
| 2 | **as shipped** — `escort` + the trigger and `say` fixes | 20 | the headline. Which tool does he reach for? |
| 3 | **`escort` present, §0b fixes reverted** | 10 | how much of any gain is the macro vs the two defects? |
| 4 | **controls** — "take me to it" must still JUMP; a plain lookup must stay a lookup | 10 | did any of this bleed? |

~50 turns, **~58¢**, inside one day's meter with room to spare.

**Read arm 2 by which tool he chose, not only by whether he moved.** If he
walks via `escort` the diagnosis holds. **If he still writes `journey` freehand
and still fails, the diagnosis is wrong** and §3c's forced-choice arm becomes
the next thing to run — it adjudicates directly, since well-formed forced calls
mean reluctance and `tool-input-error`s mean construction cost.

And then gate 22 on a browser, because the probe reads the wire and the gate is
the authority on arrival.

**Do not run n=10 and believe it.** Distinguishing 20% from 40% needs ~50 per
arm; these numbers are for direction.

---

## 7. The escalation — done, and it changed the plan

The owner asked for Fable if the next tries did not break through. They did not,
and the meter was exhausted for ~20 hours, so the consult happened instead of
more measurement. **It was worth it.** Fable was told explicitly that concluding
*"the compound one-call design is the root cause"* was on the table, and it
substantially did — from the code, not from my summary.

What it changed, all of it verified against the source before adoption:

1. **Took out the ToolFailBench framing** as the load-bearing argument (§0c) and
   replaced it with the internal control group (§0).
2. **Renamed the barrier** from *will not* to *cannot cheaply* — and with it
   explained why the write-doctrine template worked for writes and not here (§0).
3. **Found the `goTo`/`journey` trigger collision** and the prompt's prose-first
   `say` instruction (§0b) — both real, both free to fix.
4. **Proposed the macro tool** (§2), which is now the top-ranked change, argued
   from a premise stated in our own `journey.ts` header.
5. **Corrected the forcing risk in both directions** (§3c): no in-request endless
   loop, but a cross-leg re-fire hazard I had missed — and forcing doubles as the
   experiment that adjudicates the whole diagnosis.
6. **Re-keyed the fallback** onto the reader's intent rather than his promise
   (§4).

**What remains unmeasured.** Every one of the above is reasoning, including the
parts I now believe. The meter resets at UTC midnight; §1 runs first, and the
forced-choice arm in §3c is what turns this from a good story into a finding.
