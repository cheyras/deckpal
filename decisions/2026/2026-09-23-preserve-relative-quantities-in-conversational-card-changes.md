---
date: "2026-09-23"
title: "Preserve relative quantities in conversational card changes"
decided_by: "GPT-5.6 Terra on behalf of @cheyras"
areas: ["catalog"]
supersedes: []
---
## 2026-09-23 — Preserve relative quantities in conversational card changes

**Decided by:** GPT-5.6 Terra on behalf of @cheyras

**Decision:** Conversational APPLY and PREVIEW tool metadata must preserve the
shared `log_cards` quantity distinction: adding N copies uses `delta:+N` and
removing N uses `delta:-N`; `quantity` is only for an explicit request to set a
total. In the observed negative control, `quantity:1` incorrectly held an owned
card at 1, while `delta:1` correctly planned 1→2. Thus “add one” remains
`delta:1` even when the reader already owns one.

**Scope and status:** This correction changes tool metadata only. The held APPLY
plan was already correct; approvals, schemas, validators, normalization,
preflight, cache, and runtime behavior are unchanged. No collection writes were
made. Live post-fix semantic verification remains pending; the historical
evidence does not claim every model output is perfect.

