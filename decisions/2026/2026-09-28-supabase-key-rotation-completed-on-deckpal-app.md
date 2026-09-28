---
date: "2026-09-28"
title: "Supabase key rotation completed on deckpal.app"
decided_by: "Chey (via Claude)"
areas: ["security"]
supersedes: []
---
## 2026-09-28 — Supabase key rotation completed on deckpal.app
**Decided by:** Chey (via Claude)

**Decision:** The operator steps that 2026-09-26 ("Decouple Supabase API keys from the leaked JWT secret") left open are done on deckpal.app, in `DEPLOYMENT.md`'s order:
- the browser key is the publishable key;
- `SUPABASE_JWT_SECRET` is gone from Vercel Production and Preview;
- the legacy JWT-based API keys are disabled;
- the legacy JWT secret is revoked;
- the replaced credentials are deleted (the old Supabase secret key, the old GitHub token, the old AI Gateway keys, and a one-off Vercel token).

Also in the same pass: `DECKE_JEV=on` in Production and Preview, and `MCP_ALLOWED_HOSTS` reduced to `deckpal.app,www.deckpal.app`. Both are tracked in #237.

**Why:** The leak isn't contained until DeckPal stops trusting HS256 tokens and Supabase stops accepting the legacy keys. Deploying the 2026-09-26 code only prepared for that.

**Verification:** Each step was checked on production before the next one.
- `/api/public-config` serves an `sb_publishable_` key. Supabase Auth accepts it (200) and rejects a bogus one (401).
- Signed-in API requests still succeed with no HS256 secret configured, so sessions are ES256.
- The server's secret key is marked sensitive and can't be read back. The build proves it instead: `scripts/fetch-embed-model.mjs` downloads the scanner model from authenticated storage with `SUPABASE_SERVICE_ROLE_KEY`. With the legacy keys disabled, and again after the old secret key was deleted, production builds logged `sha256 verified`, so the server holds a live `sb_secret_` key.
- `/api/health` reported `deckeModels: ok` after the old Gateway keys were deleted. The Gateway answers 401 to an invalid key, so Deck-E's key is live.

**Implications:** A future key rotation can reuse the build-log check: redeploy, and look for the `sha256 verified` line from `fetch-embed-model`. Two things still carry legacy names: `VITE_SUPABASE_ANON_KEY` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` hold the publishable key, and `SUPABASE_SERVICE_ROLE_KEY` holds the secret key. `.env.example` now shows the new formats.
