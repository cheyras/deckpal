---
date: "2026-09-12"
title: "card_price_history tool, Upcoming Sets, and B10 bug-report doc correction"
decided_by: "Codex (Ringer supervisor) on behalf of @cheyras,"
areas: ["agents","commerce","catalog"]
supersedes: []
---
## 2026-09-12 — card_price_history tool, Upcoming Sets, and B10 bug-report doc correction

**Decided by:** Codex (Ringer supervisor) on behalf of @cheyras,
recording the user's authorization for three approved changes; GLM-5.2 (Ringer
documentation worker) documented them on the verified integrated branch.

**Decision — `card_price_history` shared read-only tool.** A new read-only tool
`card_price_history` is added to `packages/agent-tools/src/tools/cardPriceHistory.ts`,
registered through `catalogTools`/`allTools` and therefore served by both the MCP
adapter (`apps/mcp/src/adapters/mcp.ts`) and Deck-E's AI SDK adapter
(`apps/api/src/decke/adapters/aisdk.ts`). It takes a required canonical `card_id`,
`range ∈ 30d|3m|6m|1y|18m|2y` (default `3m`) and `currency ∈ USD|EUR|JPY` (default
`USD`), and delegates a single read to the existing `GET /cards/:cardId/prices`
endpoint through `ctx.api.get` — no schema change, no new credential, no direct
Postgres touch. It returns per-printing day/week/month OHLC points with start/end,
exact `highOn`/`lowOn`, mean/median/n and currency-major-unit values in
model-readable text; no data is invented. The full MAY/MAY NOT interpretation
contract from `cards.ts`'s price-route JSDoc ships verbatim in the description.
`get_card` is unchanged and retains current prices. The current shared-tool count
moves from 23 (12 read / 11 write) to **24 (13 read / 11 write)**.

**Decision — Upcoming Sets.** Announced but not-yet-published sets render
as non-clickable "Coming Soon" rows on a series detail page, outside the
catalog's DB/canonical ids, without progress, and excluded from the real set
count. A name-match or expiry suppresses the placeholder. The existing 30th
Celebration announcement keeps its unchanged logo and ships via a narrow
`.gitignore` exception, with a minimal mobile layout fix. The official release
date (September 16, 2026) is source-verified by the supervisor at the Pokémon
TCG 30th Celebration news page; no additional sets or markets are speculated on.

**Decision — B10 bug-report documentation correction.** `AGENTS.md` B10 now states
the precise cloud-mode condition: `bugs.ts` derives `isCloudMode = !!(GITHUB_TOKEN
&& GITHUB_REPO)` — gated on **both** `GITHUB_TOKEN` and `GITHUB_REPO`, not merely
on `SUPABASE_MODE`. When cloud mode is active, the route inserts a `bug_report`
row (user id from the JWT, under RLS), optionally uploads the screenshot to
Supabase Storage when Storage is configured (`hasStorage = !!(SUPABASE_URL &&
SUPABASE_SERVICE_KEY)`), and attempts the GitHub issue; the `bug_report` row
survives a downstream GitHub failure. The self-host / no-GitHub-configuration
path writes the filesystem. The blank line before B11 is restored. `API.md` and
the `bugs.ts` source already describe this; no runtime deployment is claimed
tested.

**Why.** The tool closes a gap the docs themselves flagged ("No agent tool
exposes price history today") without adding a new endpoint, credential or
interpretation surface — the contract that already governs the REST route now
governs the tool verbatim. Upcoming Sets makes announced-but-unreleased product
visible without polluting canonical ids or set counts. The B10 correction stops
a maintainer reading only `SUPABASE_MODE` from concluding cloud bug-report mode
is off when it is in fact keyed on the GitHub pair.

**Implications.** Public doc/README/architecture/SPEC counts and the wiki move
to 24 tools (13 read / 11 write); historical benchmark counts and migration
history mentions of "23" are preserved as-is. The new tool is available through
both adapters in one commit. `PLAN.md`'s earlier "per-card price history tool —
out of scope" line is historical and preserved, with a dated delivered-on-branch
note rather than a falsified original scope. The integrated branch is verified
and ready for GitHub CI and merge; GitHub CI and deployment have not yet run.

**Verification.** The integrated branch passes 38 check commands (all pass),
3,270 tests across 19 suites (all pass), and 15 browser gates under a mocked
local API at desktop 1280 and mobile 390. One check command is a deliberate
negative control that returns 1: removing `card_price_history` registration
from the ignored compiled catalog triggers the independent missing-tool
assertion; the file is restored in `finally`. Five-zone date unit checks (UTC, America/Denver, and
three more) reject invalid calendar dates. The browser gates exercise the
actual integrated build (`apps/web/dist`) against a mocked local API, not
production; GitHub CI and production deployment have not yet run.

---

