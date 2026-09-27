---
date: "2026-08-11"
title: "AI issue triage: scoped-down, comment-only, draft-labeled (issue #33)"
decided_by: "user (scope-down), implemented by agent."
areas: ["general"]
supersedes: []
---
## 2026-08-11 — AI issue triage: scoped-down, comment-only, draft-labeled (issue #33)
**Decided by:** user (scope-down), implemented by agent.
**Decision:** Every issue filed via the in-app reporter gets a lightweight AI
triage comment — a cheap model (Claude Haiku 4.5 via the Anthropic API) reviews
the report and posts a draft analysis.  The full autonomous version proposed in
issue #33 — Playwright reproduction with QA credentials in CI, automatic
labeling/closing, and unreviewed auto-posting — was explicitly deferred as too
risky for a first pass.  What ships:

1. **Trigger:** `.github/workflows/issue-triage.yml` fires on `issues: [opened]`
   filtered to issues carrying the `in-app-report` label (set by bugs.ts in the
   issue #32 work), so it only runs for reporter-generated issues, not hand-filed
   ones.

2. **Script:** `scripts/triage-issue.sh` fetches the issue via `gh`, clones the
   public wiki (shallow), assembles bounded context (Project-Brief.md in full +
   last 200 lines of Decision-Log.md — recent decisions are the live "what's
   being worked on" signal; the full 85KB log is wasteful for a cheap model),
   calls the Anthropic API, and posts a comment.

3. **Model:** `claude-haiku-4-5` — the cheapest available model ($1/$5 per MTok).
   Direct `curl` against `api.anthropic.com/v1/messages` with `x-api-key` header.
   No SDK dependency needed for a single CI call.

4. **Output:** A GitHub comment headed "AI Triage (draft — for maintainer review,
   not authoritative)".  For bugs: notes on missing reproduction detail, clarity
   assessment.  For both kinds: priority ranking against wiki-documented
   priorities.

5. **Safety rails:**
   - Comment-only: never modifies labels, never closes/reopens, never edits the
     issue body.
   - Clearly labeled as AI-generated draft.
   - Graceful degradation: missing `ANTHROPIC_API_KEY` secret logs a notice and
     exits 0 (no noisy failure).  API errors, network failures, and empty
     responses all exit 0 with a warning annotation.

**What was deferred (not built, by explicit product-owner decision):**
- Playwright reproduction of bugs with the QA account in CI — adding credentials
  to CI and running headless browser tests against prod is a meaningful attack
  surface expansion that should be evaluated separately.
- Automatic labeling/closing/state changes — the AI's assessment is a suggestion,
  not a decision.  Letting it mutate issue state would make it an implicit
  authority.
- Auto-posting without review — the current design posts immediately (the
  maintainer reviews after the fact), but the content is bounded (one comment,
  read-only, draft-labeled).

**Activation:** The workflow reads `${{ secrets.ANTHROPIC_API_KEY }}`.  No
secrets currently exist in this repo.  The owner must add one:
`gh secret set ANTHROPIC_API_KEY --repo cheyras/deckpal`.  Until then the
workflow exits cleanly on every trigger.

**Why this design:**
- The original ask (issue #33) included full Playwright reproduction and
  auto-triage.  The scope was narrowed because: (a) QA credentials in CI is a
  security surface expansion that deserves its own review, (b) autonomous
  unreviewed actions on issues are the kind of thing that's hard to undo once
  it misfires, and (c) a draft comment that helps the maintainer triage faster
  captures 80% of the value at 10% of the risk.
- Haiku is chosen over a more expensive model because triage is high-volume,
  low-stakes work — a wrong priority suggestion is harmless (it's labeled as a
  draft), while a $0.50/issue cost on a popular project would not be.
- Wiki context is bounded (Project-Brief + recent Decision-Log) rather than
  dumping all wiki pages because: the brief is the priorities statement, recent
  decisions capture active work, and feeding 85KB+ of historical decisions to a
  200K-context cheap model is wasteful.

**Implications:**
- New repository secret needed: `ANTHROPIC_API_KEY` (documented in DEPLOYMENT.md
  section 7, "AI issue triage").
- The workflow is dormant until the secret is added — no behavioral change until
  the owner activates it.
- Future extensions (Playwright reproduction, auto-labeling) can layer on top of
  this foundation without reworking it.

_Filed by agent on behalf of @cheyras — 2026-08-11._

