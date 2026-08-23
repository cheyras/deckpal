# Why he describes instead of showing you — and what to do about it

A plan of attack, written after external research rather than after more
guessing. It supersedes the "what to try next" list in `NEXT.md`.

**Budget: about a dollar.** At a measured **$0.01153 per turn**, every experiment
below costs cents; the constraint is the QA account's 120-turn daily meter, not
money. Spend it in the order given, because each step changes what the next one
should be.

---

## 0. The finding that reframes everything

**Our failure rate is 3–7× worse than benchmark baseline.** It is not how models
behave; it is how *this setup* behaves.

[ToolFailBench](https://arxiv.org/abs/2607.04686) (1,000 tasks, 19 models, July
2026) measures Tool-Skip Rate on tasks where a tool is required:

| | Tool-Skip Rate |
|---|---|
| **Grok-4.3 (best of 19)** | **11.80%** |
| Qwen2.5-32B | 12.08% |
| Llama-3.1-8B | 20.64% |
| Qwen2.5-7B (worst) | 28.53% |

We measure **8 of 10 turns skipping the tool** — and we are on
`spacexai/grok-4.20-non-reasoning`, from the family that tops that table on this
exact metric. Caveat stated honestly: ToolFailBench is single-tool, single-turn,
in other domains, so it is not apples to apples. An order of magnitude is still
an order of magnitude.

**Do not accept "models are just like this" as the diagnosis.** That was my
working assumption for most of a day and it was wrong.

## 0b. Somebody else has this exact bug, and the SDK's maintainer answered it

[vercel/ai#10269](https://github.com/vercel/ai/issues/10269) — same SDK, same
`streamText`, same symptom, reported verbatim as *"The model instead analyzes,
plans, or describes what it would do rather than actually calling the tools"*,
with output like *"I'll create a comprehensive mindmap… "* and **no tool call**.

They had already tried what we tried, with the results we got:

| They tried | Their measured result |
|---|---|
| `CRITICAL … call the tool FIRST` in the system prompt | "Marginal improvement, degradation still occurs" |
| `stopWhen: stepCountIs(8)` | "Model uses steps for analysis instead of tool calls" |
| `temperature: 0` | "Doesn't solve the issue" |
| Keyword detection → prompt hints | "Helps initially but reliability still degrades" |

The SDK maintainer's answer
([comment](https://github.com/vercel/ai/issues/10269#issuecomment-3546612382)):

> "One way of achieving what you're looking for is *actually* forcing a tool
> call, not just telling the model it must use it. **To be clear, anything in the
> system prompt (or broader context window) is not a guarantee of behaviour.**"

Both issues were closed as *not an SDK bug* — "model and context management".
That is a maintainer's assertion, not a measurement, but it is the maintainer of
the library we use answering the symptom we have.

---

## 1. Fix the instrument first — it has been blind to the deciding question

`probe.mjs` recognised only `tool-input-available` and `text-delta`. A turn where
he **attempted** `journey` and had it refused by schema validation produced
byte-identical output to a turn where he never tried. **Every number gathered so
far, including every number I reported, cannot tell those apart.**

Already fixed: it now counts `tool-input-error` separately and prints every part
type it saw, so the next thing it is blind to shows up as an unfamiliar name
rather than as silence.

### And a second blindness, found while trying to run step 1

The shell was rewriting the route. MSYS (Git Bash) path conversion turns a bare
`--route /decks` into **`--route "C:/Program Files/Git/decks"`** before node ever
sees it, so the probe was telling the handler the reader was standing on a route
this app does not have — and the run still completed, still streamed, and still
produced a number.

**What this does and does not invalidate.** The **2/10 baseline is safe**: it was
measured through a real browser via the gates, which never touch the probe. What
it does invalidate is the **cheap prompt-tweak comparisons** — the 0/3 and 1/5
readings I correctly called noise at the time were also, it turns out, asking the
model to escort someone standing nowhere.

The probe now **refuses** a non-route rather than guessing. Deliberately refuses:
the prefix MSYS prepends is its own install root, recovering it is guesswork, and
a guess would reintroduce exactly the silent-wrong-answer failure the check
exists to end. It prints the two working forms (`--route //decks`, or
`MSYS_NO_PATHCONV=1`).

**The pattern is worth naming, because it is now twice.** This instrument has
answered confidently about a question it was not asking, in two different ways,
and both times the output looked entirely normal. Anything it reports before a
run that exercises the guard should be treated as unverified.

**Step 1 (10 turns, ~12¢): re-baseline.** Everything below branches on the
answer.

- **If rejections appear**, the problem is schema ergonomics — go to §2.
- **If he simply is not trying**, go to §3.

Related, and already fixed in the product: a rejected call used to be invisible
to the reader *and* unlogged, and the model was told only *"An error occurred."*
Caught on a real production stream where `showScreen` failed validation five
times in one turn while the model kept shortening the title, never touching the
280-character block that was actually wrong.

---

## 2. If he is being refused: schema ergonomics

Ranked by likelihood of voiding a first attempt, argued from the schema:

1. **Landmark-ref exactness.** `[data-decke-x="y"]` — double quotes, no
   whitespace, no combinators — synthesised several times per plan for pages he
   has never seen. One wrong quote voids the whole plan.
2. **`ensure`'s two-argument shape**, whose name undersells it.
3. **Per-verb field bleed** on a deliberately flat schema.
4. **The atomicity itself.** Up to ten heterogeneous steps validated
   all-or-nothing, competing for selection against single-step tools that are
   cheap to retry. If each step has even a modest error rate, the odds of a clean
   six-step round-trip compound down fast.

**The asymmetry worth naming:** the tool is *forgiving about the world* — a
landmark that never appears yields graceful partial credit with a structured
reason — and *unforgiving about the model's own drafting*. That is backwards for
encouraging a model that is not confident in its own selector-writing.

**Cheapest first change: normalise landmark-ref syntax** (accept single quotes,
tolerate whitespace around `=`). **Zero client changes** — the sequencer never
re-validates shape, and `querySelector` accepts either.

Honest note: *"one compound call vs several small ones"* is **not a studied
trade**. OpenAI and Anthropic both advise compounding; the measured literature is
about tool *count*, not schema *shape*. We would be generating this number
ourselves.

---

## 3. If he is not trying: three levers, in this order

### 3a. The tool description — the lever I claimed to have tried and had not

I tried the **system prompt**. Anthropic's
[troubleshooting guide](https://platform.claude.com/docs/en/agents-and-tools/tool-use/troubleshooting-tool-use)
has a row for literally this symptom:

> **Claude never calls your tool** → overly-generic schema → **add
> `input_examples`** to make the intended use concrete; differentiate tools by
> **WHEN** to use them, not only what they do.

Our description already carries the *when*. It has **no worked example**.

**And the SDK supports this first-class.** `inputExamples` is a tool property,
and `addToolInputExamplesMiddleware()` serialises examples into the description
for providers that do not support it natively — which is our case, since we go
through the Gateway to a non-Anthropic model. So this is a supported feature, not
a hack.

Anthropic report internally that model-optimised tool descriptions beat
human-written ones on held-out tests
([writing tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents));
magnitudes unpublished, so treat the direction as evidence and the size as
unknown.

**Experiment (20 turns, ~23¢):** one worked 4-step escort as `inputExamples`,
plus both controls.

### 3b. Remove the `say` step — the sharpest hypothesis, and it is not mine

The `journey` schema contains a **`say`** step. The model already has a channel
for saying things: its own text output — native, always available, zero schema.
Ambiguous overlap is the documented first cause of a tool never being selected.

**Every failing trace ends with him saying the thing.** He may be executing the
`say` step, in prose, and stopping. *"I'll show you exactly where it lives"* is a
`say` step that never became a tool call.

`say` is cleanly isolated — one case in the sequencer calling `ctx.say`, which
routes to the same transcript the model's own text reaches. Removing it is a
contained change on both sides.

**Cost to weigh:** narration would front-load. Instead of interleaving with the
hops, he would say the whole plan once before moving. That may be worse, and it
is why this is an experiment rather than a decision.

**Experiment (10 turns, ~12¢):** single variable, `say` removed.

### 3c. Force the tool — but only after the lookup, and only with the release

The maintainer's fix, adapted. **`prepareStep` receives `steps`** (verified in
`ai@7.0.66`), so the condition is expressible: *the destination lookup has
returned and no journey has been emitted → `toolChoice: { type: 'tool', toolName:
'journey' }`; otherwise `auto`.*

**Three corrections that must not be skipped:**

1. **The discriminant is `'tool'`, not `'tool-call'`.** The maintainer's own
   snippet has it wrong for our version; `'tool-call'` is a content-part type.
   Verified against our installed `dist/index.d.ts:143`.
2. **Do not force at step 0.** The original reporter hit this immediately: forcing
   at step 0 skips the retrieval half of a compound request. For us it would
   build a journey on guessed selectors. Force *after* the lookup resolves.
3. **Forcing without releasing hangs `streamText`.**
   [vercel/ai#3944](https://github.com/vercel/ai/issues/3944) — a forced tool
   choice put `streamText` into an endless loop, re-calling the tool
   indefinitely. The `prepareStep` reset is not garnish.

**Costs to own:**

- **Prompt-cache invalidation.** Anthropic's guidance names varying `tool_choice`
  between requests as a cache-miss cause. Against our ~4,700-token prompt that is
  the largest hidden cost. Mitigation is documented: put the cache breakpoint
  before the variation point.
- **We delete irrelevance detection** for that turn. BFCL scores declining-to-call
  as a first-class capability across 875 cases. Every false positive from the gate
  becomes an escort nobody asked for.
- **The design smell**, worth holding: *if the gate fires on nearly every turn,
  `journey` is not a tool, it is our response format* — and should be modelled as
  one.

**Experiment (20 turns, ~23¢):** forced-after-lookup vs auto, plus both controls.

---

## 4. The deterministic fallback — do this regardless of which lever wins

Pulumi's lesson from shipping Copilot
([writeup](https://www.pulumi.com/blog/copilot-lessons/)): *"traditional software
engineering outperforms prompt engineering for deterministic tasks"* — they moved
URL generation into backend code and eliminated a class of hallucination.

**We already know the destination.** The lookup resolved it. Navigating to a known
URL is deterministic, and we are currently spending a model decision, a validated
ten-element schema and an 80% failure rate on it.

So: **when a turn ends having promised to navigate and not navigated, navigate.**
The signal is precise and already on the wire — `finishReason: "stop"`, empty
`toolCalls`, and a resolved destination from this turn's own lookup. Either
re-issue the step with the tool forced, or simply `goTo`.

This is the highest-value item in the plan that does not depend on the model
cooperating, and it caps the worst case at "he took you there without the tour"
rather than "he told you about it."

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

## 7. The escalation

If §1–§3 do not produce a clear breakthrough, hand the whole conundrum to Fable
with the measurements attached and get its reasoning before spending more. The
owner has asked for this explicitly, and it is the right move: this is now a
narrow, well-instrumented problem with a lot of evidence and no obvious answer,
which is exactly the shape that benefits from a fresh adversarial read.
