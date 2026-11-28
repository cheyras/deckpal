---
date: "2026-11-27"
title: "Anthropic models call Anthropic directly, with the AI Gateway as credit fallback"
decided_by: "@cheyras (2026-11-27); implemented by Claude Opus 5.5 on behalf of @cheyras"
areas: ["agents", "operations", "security"]
supersedes: []
---
## 2026-11-27 — Anthropic models call Anthropic directly, with the AI Gateway as credit fallback
**Decided by:** @cheyras (2026-11-27); implemented by Claude Opus 5.5 on behalf of @cheyras

**Decision:** With `ANTHROPIC_API_KEY` set, every call to an Anthropic model —
end-user Deck-E turns (Quick/Standard/Deep tiers, triage, consult, Deep Think
research legs) and the deck import fix — goes to the Anthropic API first, on
the owner's key, through `@ai-sdk/anthropic@4.0.63` (the release built on the
same `@ai-sdk/provider` 4.0.18 / `provider-utils` 5.0.47 as the pinned
`ai@7.0.113` and `@ai-sdk/gateway@4.0.91`). The routed model lives in
`apps/api/src/decke/aiRoute.ts` and replaces `createGateway` at the two
runtime call sites (`api/chat.mjs`, `apps/api/src/routes/deckImportFix.ts`).
Non-Anthropic models get the Gateway's own model object, untouched. With the
key unset, `createModelProvider` returns the Gateway provider itself.

The SAME request is retried through the Gateway only when the direct call is
refused because the Anthropic account cannot serve it, and only before any
output exists:
- HTTP 402, or error type `billing_error`;
- message "credit balance is too low" (Anthropic sends it as a 400
  `invalid_request_error`);
- message "reached your specified API usage limits" (also a 400);
- HTTP 429 with `error.details.error_code` = `enforced_spend_limit_reached`
  (the monthly spend cap — the one 429 a retry cannot clear), or a 4xx whose
  message names a spend limit/cap;
- HTTP 401 / `authentication_error` (key revoked or rotated).
Not triggers: any other 400, 403, 404, 413, a plain 429 rate limit, any 5xx,
529 overloaded, network errors, aborts, and refusals (a `stop_reason`, not an
error). Message patterns are never matched on a 5xx. A refusal-shaped error in
the stream before its first content part also falls back; one after output has
started is returned as the stream's error — two streams are never spliced.
After a trigger the process skips the direct road for 60 s
(`DIRECT_COOLDOWN_MS`), recorded as `gateway_fallback`.

Metering: Anthropic reports tokens, not dollars, so the direct road prices the
same token counts at the Gateway's own published per-token rates
(`DIRECT_MODELS`, copied from `https://ai-gateway.vercel.sh/v1/models` on
2026-11-27, including Haiku 5.5's >100k-token band), in exact 12-place decimal
arithmetic, and records it as `provider_reported` like the Gateway's cost. The
routed model reports the Gateway's `provider` and `modelId`, so the operation
row's begin and finish values are identical on all three roads; only
`generation_id` (`msg_…` vs `gen_…`) and the new `route` column differ. An
Anthropic model with no rate row is not routed directly. The boot model check
compares the table with the Gateway's live prices and reports drift
(`deckeModels.priceDrift` on `/health`, a boot warning).

Observability: migration 092 adds `decke_ai_operation.route`
(`direct` / `gateway` / `gateway_fallback`); one `[ai-route] mode:` line at boot
in both functions; `/health` `aiRoute`; one `[ai-route]` line per fallback.

The key is set only by the owner with `pnpm ai:set-anthropic-key`
(`scripts/set-anthropic-key.mjs`): hidden input, `sk-ant-` check, optional free
`GET /v1/models` check, `.env` line upsert, `vercel env add … --environment
production --sensitive` with the value on stdin (`--force` after a confirmed
replace), optional Preview/Development, then prints what changed and how to
redeploy.

**Why:** The owner wants Claude spend on their own Anthropic credits first, with
the Gateway as a safety net so Deck-E keeps answering when those run out. The
fallback list is deliberately narrow: only an account-level "cannot pay / cannot
authenticate" is a property of the road rather than of the request, so only that
is safe to retry elsewhere without hiding outages or double-billing. 401 is
included although it is not "credit": a rotated key would otherwise take every
Claude call down for every user, while the Gateway serves the identical request
at the identical metered price. Pricing with the Gateway's own table, rather
than Anthropic's price page, is what makes a credit cost the same on both roads.
`cost_source` stays `provider_reported` because the owner asked for identical
meter rows and `route` already says which road priced it.

**Implications:**
- The Gateway's model-level failover (`providerOptions.gateway.models`, e.g.
  Standard → Gemini) does not run on the direct road: an Anthropic 5xx or 529
  outage is now surfaced to the reader after the SDK's own retries, where the
  Gateway would have failed over. Plain 429s are Anthropic's own rate limits on
  the owner's account tier. Both follow the owner's "ordinary errors are not
  fallback triggers" rule; revisit if outages bite.
- `DIRECT_MODELS` must change with the Gateway's prices; the boot check names
  the drift. Adding an Anthropic model to `models.ts` without a row keeps it on
  the Gateway (a test fails so that is never by accident).
- Import-fix settlements leave `route` NULL (their SECURITY DEFINER finish
  function is unchanged); the fallback log line still shows them.
- Owner tooling under `scripts/` (evals, probes, `triage-issue.sh` in GitHub
  Actions) still calls the Gateway directly; those measure the Gateway on
  purpose and the Action's secret is infrastructure (B9).
- The privacy page now says Claude requests may go straight to Anthropic under
  Anthropic's commercial terms — owner to confirm that wording before setting
  the key.
- Live behaviour on a real key is UNVERIFIED by the agent (no paid calls were
  made): everything was proven against the real provider with a stubbed fetch.
