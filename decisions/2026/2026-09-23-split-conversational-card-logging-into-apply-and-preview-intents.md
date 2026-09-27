---
date: "2026-09-23"
title: "Split conversational card logging into APPLY and PREVIEW intents"
decided_by: "GPT-5.6 Sol on behalf of @cheyras"
areas: ["catalog"]
supersedes: []
---
## 2026-09-23 — Split conversational card logging into APPLY and PREVIEW intents

**Decided by:** GPT-5.6 Sol on behalf of @cheyras

**Decision:** Only the conversation route opts into a split contract. Its
`log_cards` is explicitly APPLY intent and exposes no model-facing `dry_run`;
the server normalizes `dry_run:false` behind the existing signed approval gate.
`preview_card_changes` is a read-only alias over the same handler with
`dry_run:true` forced. The default `buildDataTools` behavior, shared tool
definition and MCP schema remain preview-first and unchanged.

For deployment-boundary compatibility, the APPLY tool's advertised JSON schema
still contains no `dry_run`, while its SDK runtime validator also accepts the
exact legacy signed representation with `dry_run:false`. It rejects
`dry_run:true` and unrelated keys. Validation preserves the input covered by
the existing HMAC; normalization happens only inside the already-approved tool
callbacks, with no signature-format change.

**Safety:** APPLY runs a request-local forced preview before approval issuance.
Only a successful, non-empty, fully actionable plan may ask; invalid,
unresolvable, errored and skipped-only plans return evidence without approval or
mutation. The cache is keyed by tool-call id plus canonical exposed arguments,
so the SDK's racing callbacks share work without cross-call/user reuse. The HMAC
continues to bind the SDK's actual exposed input; server normalization neither
changes signed wire arguments nor creates an unsigned write path. A
candidate-bearing ambiguous printing row remains approval-eligible solely to
preserve the existing picker: an edited choice denies the signed original and
uses the reader-authenticated corrected-batch path.

**Evidence and status:** The pre-fix production baseline is 17/20 overall:
explicit “Go ahead” dialogs were 10/10, while otherwise identical short prompts
were 7/10 with three prose-confirmation stalls after `log_cards` previews. That
baseline cost $0.24692235 and made zero writes. Local mocked tests cover schema,
normalization, preflight failures/cache isolation, alias read-only behavior, and
the installed SDK's signed approve/decline/tamper/replay path. This is not a
post-fix success claim; paid/live verification remains to be run after review
and deployment.

