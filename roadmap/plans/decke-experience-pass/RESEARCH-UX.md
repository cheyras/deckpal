# What the research says about the Deck-E we actually shipped

External evidence gathered after the implementation pass, read against the code
that now exists. It is organised by **what it changes**, not by topic, and every
claim carries its base rate so its weight is visible.

**Two caveats on the whole document, from the researcher who assembled it and
worth keeping attached.** Several character/motion citations came from subagent
reports rather than direct fetches (Swartz and Andrist returned 403/404 on direct
attempt); they are consistent with what was verified independently, but
**spot-check any of them before they go into anything public.** And the session
exhausted its search budget partway through, which is why some items below are
flagged unretrievable rather than resolved.

---

## The one-line version

**Deck-E will help your newest collectors and irritate your best ones, and the
same design cannot serve both.** The world-class version is not a better mascot —
it is a Deck-E who **recedes as the user gets good, on evidence rather than on a
setting nobody finds.**

That is not a slogan; it is the same shape in three unrelated literatures:

- **Povyakalo et al. (2013)** — 50 radiologists, 180 mammograms, CAD aid: **+0.016
  sensitivity for the 44 weaker readers, −0.145 for the 6 strongest** on hard
  cases. An aggregate null hiding a sign flip.
- **Signaling research** — helps low-prior-knowledge users, **redundant for
  experts**.
- **Anthropic's own telemetry** — experienced users shift from approval-gating to
  monitoring (auto-approve 20% → 40% of sessions).

Swartz's Clippy interviews said it without the statistics: *"It's good for a
small group of people, like my mom… otherwise, it's patronizing."*

---

## What we got right, with the evidence

**Load-on-intent is the single most valuable thing in the pass.** The Snapchat My
AI natural experiment: rating **3.05 → 1.67**, one-star share **35% → 75%**,
review volume 5×. TechCrunch's complaint analysis is unambiguous — the backlash
was about the assistant being **pinned and unremovable**, not about AI quality.
**Finish the job: a permanent, one-click, *remembered* dismissal.**

**The elapsed counter is right.** Tan & Nov, CHI 2026 (N=425): **countdowns
increased frustration versus elapsed time; no timer felt longest.** Never show an
ETA.

**Latency is not the enemy we assumed.** CHI 2026 (N=240), TTFT 2/9/20s —
thoughtfulness 5.76 / **6.09** / 6.11 (p=.007), usefulness 6.19 / **6.44** / 6.32
(p=.028), **no significant effect on trust**. About **9s is peak perceived
deliberation**; past ~20s users attribute the delay to breakage. This bears
directly on the open chat-model latency item in `README.md` §6.

**The empty state with three pressable openers is right.** Wroblewski's
four-iteration history: every version that required the user to *ask for*
suggestions failed; only unconditional visibility worked. One correction from
NN/g (N=9, qual): follow-ups should be clickable and contextually updating, and
**re-showing an already-declined opener reads as nagging** — don't re-serve one.

**The approval card escapes the EULA pattern-match, by mechanism.** Böhme &
Köpsell's N=80,000 result is that EULA *shape* triggers heuristic rather than
systematic processing. The shape cues are dense uniform prose, generic chrome, an
unnamed OK/Agree button, and invariance across instances. **Our card breaks all
four**: tabular not prose; instance-specific before→after rows the user must read
to evaluate; and a button that **names the commit** ("Add 2 cards") — well
supported, since B&K found specific voluntary-sounding phrasing *decreased* blind
acceptance and Nouwens et al. (CHI 2020, 10,000 banners) showed button semantics
moving consent **22–23pp**. We also get **Anderson's polymorphism defence free**:
the rows differ every invocation.

---

## What we got wrong

### 1. Idle motion, not the entrance, is the risk

The entrance animation is affordable. **A booster box that keeps bobbing while
someone is reading is a continuous tax they cannot opt out of by looking away.**

- **Rickenberg & Reeves, CHI 2000** — none / inattentive / **monitoring**
  character: monitoring produced **higher anxiety and lower task performance**,
  strongest for external-locus users.
- **Pratt et al., Psych. Science 2010** — motion onset captures attention
  **involuntarily**.
- **Burke et al., ACM TOCHI 12(4), 2005** — animated page elements raise workload
  and hinder visual search **even when successfully ignored**.

**Rule: default to visually still; move only when something real changed.**

### 2. A single "Thinking…" row is the wrong shape, and its *content* may be harmful

The counter to intuition, replicated four ways. **Kim et al., CHI 2025** (N=308,
pre-registered):

| Condition | Agreement with **wrong** answers | Accuracy when LLM wrong |
|---|---|---|
| Neither | 78.2% | 21.8% |
| **Explanation only** | **82.8%** (worse) | **17.2%** (worse) |
| **Sources only** | **68.2%** (best) | **31.8%** (best) |
| Both | 76.9% | 23.1% |

**Explanations were worse than showing nothing.** Converging: N=752
(pre-registered, incentive-compatible) — reasoning *"acts as a powerful
persuasive heuristic"* that **crowds out the user's own knowledge**; N=559 — full
traces **impaired accuracy** while summaries held it; **Bansal et al., CHI 2021**
(N=1,626) — *"Explanations increased the chance that humans will accept the AI's
recommendation, regardless of its correctness."*

**And the shape is wrong regardless.** The evidence favours **named steps**
("Reading your collection → Matching 3 printings → Checking prices"), each
linking to what it touched — **Buell & Norton, Management Science 57(9), 2011**:
itemised visible work beat a progress bar at **every** interval; *Scientific
Reports* 2022: finer steps make elapsed time be **underestimated**; CHI 2026
(N=45): intermediate feedback significantly improved perceived speed, trust and
UX **while reducing task load** — and users wanted high transparency initially and
**progressively less as the system proved reliable**.

### 3. We built a good surface for the failure that was never going to lose a user

**Stack Overflow 2025** (n=31,476): the #1 frustration, **66%**, is *"AI solutions
that are almost right, but not quite."* Only **3% highly trust** accuracy against
84% adoption.

Loud auto-expanded failure rows handle the easy case. **The near-miss — right
card, wrong printing; right count, wrong set — has no surface at all in what
shipped.** Two further problems:

- **Auto-expanding *every* failure is itself a habituation risk.** Anderson et
  al., CHI 2015 (fMRI): *"a dramatic drop in visual processing centers of the
  brain after only the second exposure."* Vance et al., MIS Quarterly 42(2), 2018:
  attention declined substantially over three weeks across fMRI, eye-tracking and
  a field experiment. By the tenth failure the loudness is worth nothing.
- **A retry button on a non-deterministic system that changes no inputs is a slot
  machine.** If retry is offered, **change something** — narrow the query, ask a
  clarifying question, drop to a more conservative path — and say what changed.

### 4. A row per action is transparency theatre unless the rows are inspectable

93% approval plus habituation-by-exposure-two says a passive list gets skimmed
within a single session. **HANSEL** (N=14) is the counter-design: verification
must be **interactive** — click the row, land on the evidence — and it must
**explicitly flag rows it cannot ground**. It reached 83.7% precision / 88.8%
recall on evidence linking with significantly reduced task time and perceived
effort. *A log nobody opens is not oversight; it is a receipt for a decision
already made.*

Related, and the sharpest single finding for our card data — **AAAI 2025**
(N=303, 3,040 responses): citations raised trust **even when randomly drawn from
unrelated queries** (β=0.394, p<.001); **only 9.77% were ever checked**; and when
random ones *were* checked, trust collapsed to parity with no citations. Compare
**Liu, Zhang & Liang, EMNLP 2023**: only **51.5%** of generated sentences are
fully supported by their citations, with citation precision correlating
**r = −0.96** with perceived utility.

### 5. The known/guessed split is built on the wrong substrate

Segmenting known from guessed is directionally correct and ahead of most
products. But **if the split is Deck-E's self-assessment, it is unreliable by
measurement**: MetaFaith — LLMs *"largely fail"* at faithful verbal uncertainty;
Zhou et al., ACL 2024 — only **53%** of certainty-marked generations were correct,
with **~90% reliance either way**, and RLHF trains hedging out.

**Rebuild the split on provenance**: *"from your collection, added 2024-03-11"* /
*"from TCGCSV, fetched 14s ago"* / *"inferred by Deck-E."* **Provenance is
checkable; confidence is a vibe.**

### 6. The card is not the safety mechanism, and should be shown less

**Anthropic, 2026, on agent tool approvals specifically:** *"Claude Code users
approve 93% of permission prompts… Over time that leads to approval fatigue."*
Independent convergence in an unrelated field — **Bryant, Fletcher & Payne
(2014)**, 461 physicians, 2,455 alerts: **93% override, 95.1% drug–drug.** Same
number, twice.

The measured alternative is containment, not confirmation: Anthropic's sandboxing
cut prompts **84% while increasing safety** — *"Rather than supervising what the
agent does, we supervise what it's able to do."*

**Gate on irreversibility, not on "it's a write."** Use the IRCI taxonomy —
**Idempotent / Reversible / Compensable / Irreversible**. Collection adds are
tracked, in-boundary and reversible: the exact class where undo genuinely
substitutes for a gate. **Two cards with a known printing should be an undo
affordance, not a card.** Reserve the full card for uncertain printings, large
batches, and anything leaving the undo boundary — that **preserves the card's
salience precisely by showing it less.**

Residual risk to hold: **the chrome is invariant even though the rows are not**,
and habituation operates on presentation. At high frequency the user learns the
card's silhouette and stops reading the table inside it.

**Instrument the accept rate over repeated exposures.** Outside Anthropic's 93%,
**no published click-through rate for agent permission prompts exists** — we would
hold roughly the second data point in existence, and ours would be consumers
rather than expert developers.

---

## The character question, answered honestly

**The evidence does not say a mascot is a liability. It says a mascot is close to
trust-neutral — so do not justify Deck-E on trust, because the data will not back
it.**

- **Blut et al. (2021)**, 108 samples, **N=11,053**: anthropomorphism → trust
  **r_c = .19, 95% CI [.00, .38]**, credibility interval [−.40, .78]. Straddles
  zero. Likability **.53**, positive affect **.56**, intention to use **.35** are
  real. Effects are *stronger* for non-physical screen agents (.38) and
  information-processing services (.49) — both favourable to us.
- **Schimmelpfennig et al. (2025)**, N=3,500, ten countries: humanlike design
  reliably raised perceived human-likeness and **engagement (d=0.25)** — but
  behavioural trust in an incentivised trust game was **d=0.002**, with
  **BF01 = 11.9–34.6 supporting the null**.
- **"What Robots Do Matters More Than What They Look Like"** (2026, N=81): task
  context had a strong main effect on trust; **appearance had none.**

**Where a character measurably hurts:**

1. **Being cheerful at an angry user.** **Crolic et al., Journal of Marketing
   86(1), 2022** — five studies plus telecom field data: *"When customers enter a
   chatbot-led service interaction in an angry emotional state, chatbot
   anthropomorphism has a negative effect on customer satisfaction."* No effect on
   non-angry customers; the mechanism is inflated capability expectations that the
   failure then violates. **When something breaks, Deck-E should drop the
   personality and go plain.** This interacts badly with loud auto-expanded
   failure rows delivered by a character with a face.
2. **Watching** (Rickenberg & Reeves, above).
3. **Absorbing blame.** Kawai et al., *Scientific Reports* 2023: higher perceived
   capacity-to-feel raises responsibility attribution to the agent — a pattern
   absent for plain "computer" agents. **Since Deck-E writes to collections, his
   errors will be felt as his.**
4. **Over-reliance**, exacerbated by anthropomorphic cues.

**Uncanny valley is not our problem.** Palomäki et al. (2018), *Heliyon*, six
experiments, **N=1,343**: the valley replicates for pre-validated
**photorealistic** stimuli and **not** for non-photorealistic imagery. Blut tested
nonlinearity across 108 samples, **found it linear**, and recommends dropping
uncanny valley theory. **Our real risk is behavioural realism mismatch** — a
cartoon box that talks with fluent adult competence and then fails at something a
competent adult would not. That is Crolic, not Mori.

**Does he wear out? Genuinely unmeasured.** The 2025 systematic review of uncanny
valley in embodied conversational agents states that **no study in it used a
longitudinal design.** Nearest adjacent: a 4-week study of Snapchat's My AI
(N=27) — *"excessive anthropomorphism and limited transparency can undermine trust
over time."*

**Clippy: the folklore is wrong, and the real lesson is ours to inherit.** Luke
Swartz's Stanford thesis (advisor: Clifford Nass; 14 interviews, N=48 and N=90
experiments) found *"the strongest user responses are unrelated to the paperclip
character itself"* — and in the N=90 experiment, **character-present conditions
rated the site easier to use (p<.1), more reliable (p<.01), more positive
(p<.05)** than a no-agent control. His diagnosis:

> "The Office Assistant's letter-writing proactive help feature, thus, breaks
> every relevant etiquette rule: it ignores social conventions of when to disturb
> someone, it does not learn from its mistakes, it does not develop a long-term
> relationship, and (one might argue) it does not even provide a helpful service."

The engineering record confirms it. **Horvitz et al., UAI-98, the Lumière
project** built a Bayesian model including *a computed probability that the user
would welcome an interruption*. Office '97 shipped the character but replaced
that gate with *"a relatively simple rule-based system,"* with the researchers on
record worrying it *"would be distracting to users."*

**Clippy shipped the face without the brain that decided when to use it.**
Anthropomorphism is not on the list of causes — genuinely good news for a
character-central product, **provided we build the interruption gate Microsoft
cut.**

**Where to spend the humanness budget.** Schimmelpfennig asked N=3,500 *why* a bot
felt human: **conversation flow 32.1%, understanding the user's perspective
24.4%, response speed 22.5%, authenticity 18.4%.** Intelligence 8.8%. **Warmth
under 0.5%.** Latency and turn-taking are the budget; the face is not.

---

## Patterns the best products have and we do not

| Pattern | Evidence grade |
|---|---|
| **Editable plan before execution** — Cursor plan mode, Devin 2.0's "relevant files, findings, and a preliminary plan." | asserted |
| **A confidence signal at session start** — Devin 2.1 shows 🟢/🟡/🔴 before committing; **green sessions ~2× as likely to end in a merged PR as red**; waits for approval when unsure. | **measured** |
| **Pause where the choice is ambiguous, rather than confirming after** — Morae (N=10 + 256-task eval). | **measured** |
| **Interruption that keeps the work** — `Esc` mid-turn retains work done so far; message queueing; side-questions without losing state. | product behaviour |
| **Checkpoints with a published limitations list** — `/rewind` enumerates what undo *cannot* recover. **Disclosing the holes is the trust move.** | product behaviour |
| **Containment instead of confirmation** — 84% fewer prompts, higher safety. | **measured** |
| **Don't autoscroll a streaming response** — users read from the top; one participant stopped reading entirely: *"I'll wait for it to finish."* | measured (qual, N=9) |

**Morae is our highest-value unshipped pattern**, and it bears directly on the
approval card:

> "In 95% of these situations participants never realised that multiple valid
> options existed."

| Metric | Morae | OpenAI Operator | TaxyAI |
|---|---|---|---|
| Tasks completed | **5.50** | 3.90 | 2.60 |
| Preference-aligned choices | **4.03** | 2.98 | 1.92 |
| Confidence (7-pt) | **6.60** | 5.50 | 2.20 |

**When there are three printings of a Charizard at different prices, "Add
Charizard?" is the wrong question at the wrong time.** Pausing to show the three
converts a compliance surface into a useful one.

**First-person uncertainty, if we hedge at all** — Kim et al., FAccT 2024 (N=404,
pre-registered): *"I'm not sure, but…"* moved agreement 80.9% → **74.8%** (p<.05)
and accuracy 63.9% → **72.8%** (p<.01), while *"It's not clear, but…"* was not
significant. **Grammatical person matters more than the fact of hedging.** Temper
it with Steyvers et al., *Nature Machine Intelligence* 2025 (N=301): human
discrimination of right from wrong answers is **AUC 0.589, barely above chance**,
and **long explanations (115 words) raised confidence over short (34 words) with
no improvement in discrimination.**

One useful negative: **GitHub's 2026 position** is that chat is the wrong
container for agent work — *"Chat is great for intent, but weak for durable
execution"* — because decisions get buried in scroll and state must be
reconstructed. Their answer is a persistent canvas that is "visible, steerable,
and approvable as it unfolds." **Since Deck-E acts on the live page rather than in
a transcript, we are already closer to this than most.**

---

## What the web could not settle

These are gaps, not oversights — several are gaps we are positioned to fill.

- **No published measurement of tolerance for a 30s–3min agent wait.** Best
  studies top out at 60s total (N=425) and 20s TTFT (N=240). Our exact range is
  unmeasured.
- **No public A/B on suggestion chips vs a blank input.** Wroblewski holds the
  number from two products and has declined to publish it twice.
- **No longitudinal study of novelty decay for UI characters.** Stated explicitly
  by the 2025 ECA systematic review.
- **No direct comparison of character guidance vs coach marks** — never tested,
  and it is Deck-E's whole premise.
- **Undo vs confirm for agent mutations: no controlled study exists** (confirmed
  by two independent passes). **Undo's failure mode is unmeasured too** — no
  published snackbar-undo click rates or discoverability data anywhere.
- **No published click-through rate for agent permission prompts except
  Anthropic's 93%** — the single biggest measurement gap in this area.
- **Whether an observer reads a *stylised web character's* gaze aversion as
  thoughtful is untested.** Andrist measured a physical NAO robot, N=30.

**Do not cite, in anything:** Material 3 Expressive's "4× faster to spot
elements" (vendor-asserted, no peer review, no effect sizes, and Google's own
page concedes that *"breaking established UX patterns reduces usability"*);
Duolingo mascot figures; Character.ai and Replika engagement numbers (mutually
contradictory SEO aggregators); the "1.50 trust asymmetry ratio (Hancock 2021)"
circulating in secondary prose. **Disney's twelve principles have never been
empirically validated for UI** — worth using as craft, not as proof.

**Two primaries could not be retrieved** (paywalls plus an exhausted search
budget): Dietvorst et al. (2015) per-condition algorithm-aversion percentages, and
Skitka/Mosier (1999) omission/commission rates. Directionally solid; **do not
quote their numbers until the PDFs are in hand.**
