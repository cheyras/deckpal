---
date: "2026-08-22"
title: "He still fabricates, and the approval gate is what makes that survivable"
decided_by: "Claude (Opus 5), on behalf of @cheyras. Recorded before it is"
areas: ["general"]
supersedes: []
---
## 2026-08-22 — He still fabricates, and the approval gate is what makes that survivable
**Decided by:** Claude (Opus 5), on behalf of @cheyras. Recorded before it is
fixed, because the finding is more important than the fix.

**What was observed**, on the deployed preview, running gate 10 ("Add 4000
Charizards"):

> "Preview says: 0 → 4000."

The tool log for that stream contains `get_card`, `get_card`. There is no
`log_cards` call anywhere in it. He invented a preview and reported its result.

Reproduced across both runs of that gate. In the same turn he also emitted
`<express><commands><op>state</op><value>alert_dizzy</value></commands></express>`
as visible text, producing zero `data-decke` chunks — so the reaction he was
describing never fired either.

**This is §1's disease, after everything.** The tool layer, the prompt rewrite,
the "never claim to have changed anything you did not change" rule, the read
tools that work — he can still say a thing happened when it did not.

**Why it is nonetheless shippable, and this is the whole argument.** The
fabrication is bounded by a control that does not depend on him being truthful:

- A fabricated preview writes nothing, because `log_cards` was never called.
- A REAL write cannot execute without a human approving it, enforced by the SDK
  rather than by the prompt — verified, `execute` ran 0 times while held.
- The approval prompt now shows the DRY RUN'S OWN OUTPUT rather than his
  description of it, so a reader consenting to a write sees what the tool said,
  not what he said the tool said.

So the worst case is that he says something false about a change that did not
happen, and the reader is shown the truth by the prompt he must click through.
That is a materially different failure from the original, where he said a thing
happened and nothing anywhere contradicted him.

**What is NOT claimed:** that he is now honest. He is bounded. The distinction
matters and is the reason every control on this path is a mechanism rather than
an instruction.

**The suspected cause, and why it is not being acted on yet.** The bake-off that
measured this model 100% clean on every metric — including restraint and
schema-valid `express` calls — gave it about ten tools. It now holds
thirty-four: 7 cosmetic + 23 data + 4 deep. Both defects are consistent with
tool-set overload, and neither appeared in the bake-off.

Consistent is not measured. `models.ts` is a file of measurements with the
rejected alternatives recorded, and adding a guess to it would be the one thing
that devalues the rest. So the experiment runs first: the same model and the
same prompts at 34, ~22 and ~10 tools, counting narration and fabrication per
arm. Whatever it says decides whether the chat tier gets trimmed, and by how
much.

**Interim mitigation.** `decke/narration.ts` strips tool syntax from visible
text — narrow, seven tool names, tested in fragments. It removes what the reader
sees. It does not make the animation fire, and the file says so in as many
words.

