---
date: "2026-08-29"
title: "Smart lists: a dynamic list can be a saved query, re-evaluated on read"
decided_by: "maintainer (2026-08-29 walkthrough recording; deferred item now built)"
areas: ["data"]
supersedes: []
---
## 2026-08-29 — Smart lists: a dynamic list can be a saved query, re-evaluated on read

**Decided by:** maintainer (2026-08-29 walkthrough recording; deferred item now built)

**Decision:** Migration 050 adds `card_list.rule` (JSONB) +
`rule_evaluated_at`. A rule-backed dynamic list ("smart list") evaluates
`missingForGoal` on every read — stored `list_item` rows are ignored while a
rule is present, and `rule IS NULL` (every pre-050 list) keeps the
reference-set behaviour untouched. The rule vocabulary is the `addMissing`
spec, parsed by ONE shared parser (`listRules.ts:parseMissingSpec`, now also
used by the bulk route), plus `exclude` (variant ids removed by hand) and a
server-resolved `setName`.

**Why:** The owner's original complaint, verbatim: "I satisfied the condition
of owning Growlithe, he should not be on the list anymore." Dynamic lists
were reference-sets by explicit prior decision; `addMissing` materialised the
query once and the membership aged. And the second half: "it's not super
clear that there's a real difference between a static list and a dynamic
list" — so a smart list is visibly different: a highlighted chip, a "Live —
showing what's still missing for <set> · <goal>" caption, "N to get" and
"Cost to finish" instead of owned-progress.

**Implications:**
- "Remove" on a smart list is an EXCLUSION (`rule.exclude`), not a delete —
  there is no row, and the rule would put the card back. The synthetic item
  id `rule-<variantId>` routes it; exclusions are listed and restorable in
  the rule editor.
- Add/bulk-add/reorder against a smart list are 400s that say why. The MCP
  reaches lists over this same HTTP surface, so agents get the same answers.
- `PATCH { rule: null }` PINS the list — materialises the current evaluation
  into rows (append-only, deduped) and detaches the rule. Pinning can never
  destroy anything.
- New mutation-log operations `list.rule.set` and `list.rule.exclude`, both
  with real undo (restore the previous rule / un-exclude).
- Progress is null for smart lists (owned = 0 by construction). Index
  summaries evaluate each smart list's rule sequentially on one connection;
  a rule whose set vanished degrades to the un-evaluated shape rather than
  failing the whole index.
- One behaviour change rode in with the shared parser: `addMissing` with an
  unknown goal is now a 400 instead of silently becoming 'complete'.

