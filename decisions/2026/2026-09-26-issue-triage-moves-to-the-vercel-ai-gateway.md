---
date: "2026-09-26"
title: "Issue triage moves to the Vercel AI Gateway"
decided_by: "Chey (via Claude)"
areas: ["general"]
supersedes: []
---
## 2026-09-26 — Issue triage moves to the Vercel AI Gateway

**Decided by:** Chey (via Claude)

**Decision:** `scripts/triage-issue.sh` and `.github/workflows/issue-triage.yml` now
call the Vercel AI Gateway's Anthropic-Messages-compatible endpoint
(`https://ai-gateway.vercel.sh/v1/messages`, model id
`anthropic/claude-haiku-4.5`) instead of `https://api.anthropic.com/v1/messages`
directly. The repository secret is renamed `ANTHROPIC_API_KEY` →
`AI_GATEWAY_API_KEY`. The script also gained `TRIAGE_DRY_RUN` (print the
would-be comment instead of posting) and `TRIAGE_TEST_ISSUE_JSON` (triage a
synthetic issue without a real one), both for local testing only.

**Why:** `ANTHROPIC_API_KEY` was never set as a repository secret, so every
triage run since the workflow shipped (DECISIONS.md 2026-08-11) has silently
no-op'd — the fail-quiet `::notice` exists precisely so this kind of gap does
not show up as red CI, which is also how it went unnoticed. Moving to the
Gateway consolidates DeckPal's AI spend onto one billing surface (Deck-E
already uses it; see `apps/api/src/decke/models.ts`) instead of standing up a
separate Anthropic account and key just for this one low-volume workflow. The
request/response shape is unchanged — the Gateway's Anthropic-Messages-
compatible endpoint takes the same body and returns the same content-block
shape as Anthropic's native API, so this is a base-URL-and-auth-header swap,
not a rewrite. Verified end-to-end locally: a synthetic issue through
`TRIAGE_DRY_RUN=1` + `TRIAGE_TEST_ISSUE_JSON`, with one real (sub-cent) Gateway
call, produced a correctly-formed draft comment; the missing-secret path still
exits 0 with the same `::notice`.

**Implications:** The repository owner must set the new `AI_GATEWAY_API_KEY`
secret (`gh secret set AI_GATEWAY_API_KEY --repo cheyras/deckpal`) for triage
to resume — it stays silently off until then, same as before. This secret name
matches the Vercel *project* environment variable already used by
`scripts/gen-marketing-images.mjs` and the visual-harness judge, but it is a
separate GitHub Actions credential store; DEPLOYMENT.md and the workflow's own
header both recommend minting a dedicated key rather than reusing one, so
triage's (tiny, infrequent) spend stays legible and revocable on its own —
the same split already applied to `DECKE_VERCEL_AI_GATEWAY_KEY`.
