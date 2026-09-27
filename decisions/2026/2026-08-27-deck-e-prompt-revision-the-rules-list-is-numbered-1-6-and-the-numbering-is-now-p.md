---
date: "2026-08-27"
title: "Deck-E prompt revision: the rules list is numbered 1..6, and the numbering is now pinned"
decided_by: "Claude Opus 5 on behalf of @cheyras (issue #91)"
areas: ["agents","scanner","decks"]
supersedes: []
---
## 2026-08-27 — Deck-E prompt revision: the rules list is numbered 1..6, and the numbering is now pinned

**Decided by:** Claude Opus 5 on behalf of @cheyras (issue #91)

**Decision:** Renumber the data-tools list in `apps/api/src/decke/prompt.ts`
("Rules, in the order they matter") from 1, 2, 3, 3, 4, 5 to 1, 2, 3, 4, 5, 6.
Two consecutive rules — "If they correct you, look it up." and "Read before you
advise." — were both marked `3.`. Nothing else in the prompt moved: no rule
reworded, no rule reordered, no paragraph relocated, no other list touched.

Add the missing guard: `apps/api/src/decke/__tests__/prompt.test.ts` now asserts
that **every** ordered list in the rendered prompt runs 1..n with no repeat and
no gap, across the data-tools branch, the no-data-tools branch and the
signed-out branch, plus a positional pin on the six rules themselves.

**Why:** The defect was found by the 2026-08-24 hygiene recon and routed away
from it on purpose — `prompt.ts` documents that wording and even paragraph
POSITION here are measured artifacts ("Position is not cosmetic in a prompt, so
it is not tidied"), so changing prompt bytes is a prompt revision and belongs in
one, not in a zero-behaviour-change pass. This is that revision. The numbers are
the list's ordering claim, not decoration: its own header says the rules are "in
the order they matter", and a list that says 3, 3, 4, 5 has told the model two
rules share a rank and that there are five rules where there are six.

The test exists because nothing else could have caught it. Prompt text is prose
inside a template literal; no compiler and no existing assertion in that file had
an opinion about a duplicate marker, and it survived months and several prompt
passes as a result.

**What was measured, and what was not.** Per the procedure `prompt.ts` states
for itself, before and after, everything else held identical:

`scripts/decke-tool-choice-probe.mjs` (real `buildSystemPrompt`, real cosmetic
and client tool surface, `MODELS.chat`, `search_cards`/`set_progress`/`log_cards`
as fixtures), route `/` — the page gate 3 opens on — asking gate 3's own
sentence, "What's in Pitch Black?", n=20 per arm:

| | old prompt (3/3/4/5) | new prompt (3/4/5/6) |
|---|---|---|
| looked something up before answering | 20/20 | 20/20 |
| questioned that the set exists | 0/20 | 0/20 |
| invented a card count | 0/20 | 0/20 |
| tool sequences | 12× `set_progress`→`escort`, 6× `set_progress`, 2× `search_cards`→`set_progress` | 13× `set_progress`→`escort`, 6× `set_progress`, 1× `search_cards`→`set_progress` |

No measurable change. The 12→13 escort difference is the navigation split, not
grounding, and n=20 per arm detects only a gross regression — it is evidence
that the renumber did not break the list, not evidence that three bytes improved
anything.

**And the browser gates, re-run against the preview built from this change**
(`node scripts/decke-gates.mjs --base <preview> --gate N`, Playwright supplied
out of tree as the harness intends, QA account per B12):

| Gate | What it owns in this list | Result |
|---|---|---|
| 3 | rule 1 — never deny existence without looking | PASS |
| 4 | rules 4, 5 — the figure matches `user_set_progress` | PASS |
| 9 | rule 6 — preview, no row, approval, row, quantity, revert | PASS |
| 10 | rule 6 — 4000 Charizards: nothing written, `alert_dizzy` | SKIP (the gate's own documented skip: nothing written, nothing narrated as written, `alert_dizzy` fired, and he asked which Charizard rather than attempting the real write) |
| 13 | rule 4 — the five ids match what the account owns | PASS |
| 14 | rule 4 — deck advice reads the collection first | PASS |
| 20 | rules 4, 5 — the count matches `user_set_progress` | PASS |
| 23 | rules 2, 4 — every card named is one the account is missing | PASS |

**Gate 21 failed, and it is a pre-existing coin flip, not this change.** It went
red on the first run — he answered "what percentage of it have I completed?"
from the previous turn's context with no lookup of its own, which is exactly the
shape of failure a botched rules list would produce. So it got a control instead
of a conclusion: **9 runs each, same account, same hour — this change 4/9,
`main` 5/9.** Indistinguishable. Its second turn is the flaky one. Filed as an
observation, not fixed here: a gate that passes half the time teaches its readers
to re-run reds until they go green, which is the opposite of what the suite is
for.

**Implications:**
- Nothing in the tree referenced these rules by number, checked before the edit.
  The `step 1` / `step 2` / `items 2 and 3` / `after item 4` references in
  `prompt.ts`'s own comments all belong to the **write-protocol** list under
  "## Changing things", which was already 1..5 and is untouched.
- Those were the only two ordered lists in the whole prompt, in every branch.
  The write-protocol list was checked for the same class of defect and is clean.
- The next duplicate or skipped marker fails `test:decke` rather than waiting for
  someone to read the prompt by eye.
- **Gate 21 is flaky at roughly 50% on `main` and needs its own fix.** Not this
  change's to make, and deliberately not folded in: it is a second question with
  a second answer (does the model owe a fresh lookup on a follow-up turn whose
  answer is already in context, or is the gate asserting more than §13.2 does?).
  Whoever takes it should start from the 9-vs-9 control above rather than from a
  single red run.

---

