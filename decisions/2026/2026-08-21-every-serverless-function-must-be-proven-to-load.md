---
date: "2026-08-21"
title: "Every serverless function must be proven to LOAD"
decided_by: "Claude, after a production 500."
areas: ["operations"]
supersedes: []
---
## 2026-08-21 — Every serverless function must be proven to LOAD
**Decided by:** Claude, after a production 500.
**Decision:** `scripts/check-functions.mjs` imports every `api/*.mjs` from the
repository root and asserts a callable default export. Wired into CI.

**Why:** `/api/chat` shipped and returned `FUNCTION_INVOCATION_FAILED` on its
first request. `api/chat.mjs` imports `@ai-sdk/gateway`, which was never declared
in `package.json` — it resolved locally only as a hoisted transitive of `ai`, and
pnpm links only DECLARED dependencies at the root, so the bare specifier could not
resolve in the deployment.

**The part worth remembering:** nothing caught it, and the test suite was not
thin. The prompt builder, the tools, the model routing and a live gateway round
trip were all verified. **None of them ever imported the entrypoint Vercel
actually runs** — and the one probe that did import the gateway had been given an
explicit `.pnpm/…` path to work around this very failure, which disguised it as a
local-tooling quirk instead of the deployment bug it was.

A module-resolution failure is invisible to a suite that never loads the module.
Testing the pieces is not testing the artifact.

**Implications:**
- `@ai-sdk/gateway` is now a declared dependency, pinned to **4.0.52** — the
  version `ai@7.0.66` itself pins. Skew here produces "Unsupported gateway
  protocol version" at runtime.
- The check runs after `deckpal-api build`, because the functions import from
  `apps/api/dist`.
- Verified red-then-green: an undeclared import fails it, removing that import
  passes it.

