---
date: "2026-08-29"
title: "The agentic pass, reviewed: seven adversarial lanes, five blockers, two more rounds"
decided_by: "the owner (who ordered the review shape: six narrow Sonnet"
areas: ["agents"]
supersedes: []
---
## 2026-08-29 — The agentic pass, reviewed: seven adversarial lanes, five blockers, two more rounds

**Decided by:** the owner (who ordered the review shape: six narrow Sonnet
lanes + one fresh broad Fable lane, all adversarial), executed by Claude
Fable 5 orchestrating GLM-5.2 fix swarms via Ringer

**Decision:** PR #138 was reviewed adversarially before merge and was NOT
shippable as first assembled. Every confirmed finding was fixed on the same
branch (rounds F and G). The entry above predates round F; corrections here
supersede it where they disagree.

**What the review confirmed and the fixes that followed:**

1. **The turn guards** (round F — previously undocumented here, which was
   itself a review finding): five detectors mined from the owner's real
   28-conversation history, wired into `api/chat.mjs` — empty-answer,
   truncation, cross-tool error budget, phantom-action, ungrounded-card-id —
   each injecting at most ONE reader-facing first-person admission per turn,
   marked in telemetry via a `turn_guard` chip so mined history can tell
   guard text from model text. The review then proved the first cut
   regressed consent flows, and round G fixed it: approval-held and
   panel-only legs are carved out (a held write's call has no completed
   event — that is the detection), the error budget now also stops the turn
   mid-flight via `stopWhen` instead of narrating after the burn, a
   recovered turn (substantive answer) is never told it flailed, phantom
   detection is negation/tense/heading-safe, and id accusations use a strict
   digit-bearing pattern so "late-game" and "two-of" are never accused.
2. **The paste channel** (round G): Deck-E's chat model runs at 1,200 output
   tokens; a real PTCG Live log is ~3,000 — the model can never re-type a
   pasted log into `add_battle_log.log`. The server now carries it:
   `extractPastedLog` finds the log in the actual user message and the
   adapter substitutes it when the model passes `log: "@pasted"` (or a
   truncated prefix). Over MCP nothing changes — claude.ai passes raw logs.
3. **`dry_run` semantics**: `add_battle_log`/`edit_battle_log` now default
   `true` like every sibling write (the review caught them alone at `false`
   over a wire with no approval dialog), the no-deck ranking branch honors
   and states it, and the approval card's first line names the deck and the
   parsed result instead of "Nothing was logged."
4. **Declines are reader-reopenable**: the name-level suppression stands,
   but the reader's own latest words re-open the family (the `printingSaid`
   witness pattern), refusals lead with `[[NO_WORK]]` and no longer promise
   a re-call that the predicate would refuse.
5. **`no_research` is provenance, not length**: the flag now also fires when
   no research/lookup ran in the conversation; the findings fence defuses
   embedded delimiter lines; the card and the guide's own admission share
   one threshold constant.
6. **`log-preview` tells the truth**: `parsed` is re-parsed against the best
   candidate's card list (the deck-agnostic parse could never resolve the
   owner and returned nulls), the 429 speaks the JSON envelope the tool
   client reads, ordering is deterministic, and the walk-vs-jump rule reads
   the same in the escort/journey descriptions as in the prompt.

**Accepted residuals, documented in code rather than papered over:** the
drift tripwire covers the both-zero drift signature, not the
confidently-inverted one; the log-preview rate limiter is per-lambda
best-effort (the deck-fan-out cap is the load-bearing bound); `findings`
content itself remains unverifiable beyond provenance; the prompt revision
remains UNPROBED pending gate runs on a deployed preview.

**Why:** "A capability declared but never exercised will be reported as
built" is this file's oldest lesson. The review existed to exercise the
claims before the merge did; it found five ways the pass's own headline
features could not deliver, all invisible to green suites.

**Implications:** SPEC.md/API.md updated in the same sitting (dry_run
defaults, `@pasted`, the 429, the 40-deck cap). Gate/probe runs and one
live `get_card` call on a deployed preview remain owed before the prompt
wording is iterated further.

