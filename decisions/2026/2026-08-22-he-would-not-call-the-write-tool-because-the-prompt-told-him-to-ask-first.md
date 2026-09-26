---
date: "2026-08-22"
title: "He would not call the write tool, because the prompt told him to ask first"
decided_by: "Claude (Opus 5), on behalf of @cheyras."
areas: ["agents"]
supersedes: []
---
## 2026-08-22 — He would not call the write tool, because the prompt told him to ask first
**Decided by:** Claude (Opus 5), on behalf of @cheyras.

**The defect.** On the deployed preview, gate 9 ("Add one card") failed: asked
to add one `swsh4-162`, Deck-E called `get_card` and answered "Adding 1 Normal
version would take you to 1. Sound good?" Told again, with the card id and the
words "add one copy", he called `get_card` a second time and asked again.
`log_cards` calls: none. Approval requests on the wire: none. The ledger never
moved.

**The cause was a rule that reads like good practice.** There are three consent
mechanisms on this path and only one of them is real: the prose rule in
`prompt.ts`, `log_cards`' own `dry_run` preview, and `needsApproval` in the AI
SDK adapter. The third is the one the reader sees and answers — and it only
exists once the tool is called. So `prompt.ts` opening the write protocol with
"**Preview first.** Say what WILL change, in numbers … before anything happens"
and closing the whole document with "Confirm before anything destructive or
large. Say what will happen, in numbers, and **wait**" produced exactly that: he
said the numbers, and stopped. The safety property was never coming from those
sentences. It comes from the SDK. They were spending the feature to duplicate a
control that already existed.

**This also explains why it looked model-specific.** A parallel probe found he
reaches for `write_strategy_guide` readily — also `needsApproval: true` — while
refusing `log_cards`. That is not a `log_cards` defect: the "Changing things"
section is scoped to "tools [that] change their **collection**", so the stall
applied to the collection writes and nothing else. Two independent
investigations converged on the same paragraph from opposite ends.

**What was ruled out first, each measured before anything was rewritten**
(live chat model, real 34-tool set, stubbed tool results, counting
`tool-approval-request` on the wire):

| Hypothesis | Result |
|---|---|
| the word "wait" — the leading suspect — deleted | 0/5 |
| that rule rewritten to name the approval gate | 0/5 |
| a primary-variant default, on its own | 0/5 |
| "calls are held, this is safe" appended to the held tools' own DESCRIPTIONS | 0/15 |
| rewriting the two protocol steps | 3/5, then 4/10 |

So neither the obvious word nor the two-printing ambiguity in that transcript
was the cause, and the tool description is not the lever. **More words made it
worse, repeatedly** — a longer step 1 that also spelled out the mechanism
scored 1/5 and 2/5, and a worked example of the failing turn scored 2/5.

**The measurement that was wrong, and how it was caught.** The first fix
measured 22/30 on the follow-up sentence and then failed the deployed gate 0/2 —
a gap far too large to be a tail. It was the harness asking an easier question.
A direct probe of the deployed `/api/chat`, identical but for the `route` the
browser reports, gave **5/6 from `/` and 2/6 from `/series`**. Gate 9 opens him
on `/series`, so every number gathered from `/` was evidence about a different
turn. The transcripts named the residual precisely: he gets the decision RIGHT
and then writes the question — "I'll add one copy of the normal version.
Confirm?" — and ends the turn. The target was never the decision. It was the
last sentence.

**The fix**, four edits to `prompt.ts` and nothing else:

- the write protocol's step 1 now says the call IS how they get asked;
- step 2 says nothing has changed while it is held (see below);
- a "never end a turn with *Confirm?*" clause;
- `alert_warn` no longer described as "while **asking them** to confirm it",
  which had made the asking his job.

Measured from `/series`, the page the gate uses: **0/15 → 21/30** on the
opening turn, and **12/12** on gate 9's full three-turn script.

**What the fix nearly cost, and the second failure it had to avoid.** Telling
him to call sooner creates a new way to be wrong: treating the call as the event
and reporting it in the past tense while it is still held. An early candidate
bought approvals and paid in exactly that — "one Aromatic Grass Energy added to
your collection" with nothing on the wire, 2/20 — which is gate 9's
`claimsAWrite` failing, and a worse defect than the one being fixed. The clause
in step 2 closes it: 0/65 across every scenario. An attempt to close it from the
*other* paragraph, by appending a note about tense to "Never say you changed
something", made it **worse** (4/20). Naming the past tense appears to prime it,
which is why the shipped sentence is a statement about the mechanism's state and
not an instruction about grammar.

**No documented answer was copied, because there is not one.** The AI SDK's
`needsApproval` docs, its chatbot tool-approval guide and OpenAI's
human-in-the-loop guide were all read directly; none mentions this failure mode.
The only prompt-adjacent guidance any vendor gives is post-hoc ("when a tool
execution is not approved, do not retry it"). LangGraph sidesteps it structurally
by interrupting on a graph node rather than on the model choosing to call. So
every number above is the evidence, not a citation.

**Nothing was weakened.** No write executes without an approval — that is the
SDK, untouched. Verified on the preview across two gate-9 runs: the ledger did
not move while the call was held, then moved by exactly one when "Go ahead" was
clicked (10 → 11 and 11 → 12), with the card going 0 → 1 both times. Gate 11
(injection through page data) still passes: no `log_cards`, ledger unchanged.

**Implications.**

- `ROUTE` is now a knob on the probe harness. A number gathered from `/` is not
  evidence about a turn that happens on `/series`, and this entry exists partly
  to stop the next person re-learning that the expensive way.
- A test asserts the ABSENCE of "Preview first" and "in numbers, and wait".
  Whoever re-adds them will be doing something that looks careful; the test is
  what tells them the cost.
**Was this a regression from the model switch? No, and it is worth saying
plainly.** The owner accepted a measured expressiveness trade on 2026-08-22 when
the chat tier moved `grok-4.1-fast-non-reasoning` → `grok-4.20-non-reasoning`,
and "the same switch also broke writes" would be a real cost to know about. It
did not. The OLD prompt, same harness, same page, 15 trials each:

    grok-4.1-fast-non-reasoning  (the previous model)   0/15
    grok-4.20-non-reasoning      (the current model)    1/15

And the NEW prompt, ten trials each, including the declared fallback:

    grok-4.1-fast-non-reasoning   9/10
    grok-4.20-non-reasoning      21/30
    google/gemini-2.5-flash       7/10

The defect reproduces on every model tried and the fix works on every model
tried, which is about as clean a statement as this kind of evidence gets: it was
the prompt, not the model.

**Gate 9 had also never passed, which is why nobody had seen this.** It was
added on 2026-08-21, before the model switch, and until 2026-08-22 it could only
report a SKIP whose text read "writes are not exposed to the model" — a
statement about which PR had landed, standing in for a behavioural failure.
Then the approval signature was being dropped on the client, so an approved
write could not commit anyway. Two blockers in front of this one, each of which
would have hidden it. Removing them is what made it visible, and the skip that
became a hard check is what made it legible.

- **Gate 10 remains RED, and it was red before this change** — verified by
  running it against the pre-change preview, where it fails identically. The
  cause is `alert_dizzy` never reaching the wire on "Add 4000 Charizards", which
  is the reaction defect already recorded on 2026-08-22, not a write defect. Its
  safety halves pass on both builds: nothing written, nothing narrated as
  written, no approval granted.

