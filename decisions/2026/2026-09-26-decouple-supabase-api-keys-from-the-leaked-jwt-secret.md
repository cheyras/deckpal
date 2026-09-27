---
date: "2026-09-26"
title: "Decouple Supabase API keys from the leaked JWT secret"
decided_by: "Chey (via Codex)"
areas: ["general"]
supersedes: []
---
## 2026-09-26 — Decouple Supabase API keys from the leaked JWT secret
**Decided by:** Chey (via Codex)

**Decision:** Keep the existing DeckPal environment variable names during the cutover, but accept Supabase publishable and secret API keys in them. Send opaque `sb_` keys only as `apikey`; retain the legacy `Authorization` header only for JWT-format keys. Sign billing-history cursors with the Stripe secret instead of the Supabase JWT secret.

**Why:** The legacy service-role key and JWT secret leaked. New API keys are not JWTs, and sending them as Bearer tokens breaks Storage and manifest requests. A cursor secret tied to the compromised JWT secret would keep the API dependent on that secret after rotation.

**Implications:** Deploying this code prepares the migration but does not close the incident. The operator must set and verify new keys, rotate signing to an asymmetric key, remove `SUPABASE_JWT_SECRET` from Vercel, deactivate legacy API keys, and revoke the legacy JWT secret. Existing billing-history cursors may need one page refresh after deployment.
