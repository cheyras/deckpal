---
date: "2026-08-14"
title: "Pre-merge production-readiness review: six fixes"
decided_by: "Chey (directive: \"make it production ready, fix glaring issues, no visual changes\"), review + fixes by Claude Fable 5"
areas: ["general"]
supersedes: []
---
## 2026-08-14 — Pre-merge production-readiness review: six fixes
**Decided by:** Chey (directive: "make it production ready, fix glaring issues, no visual changes"), review + fixes by Claude Fable 5
**Decision:** A multi-angle code review of `main...design-system` (8 finder
angles, adversarial verification) surfaced six defects, all fixed in place:
1. **RLS cleanup could hand a live client to the next request.** The 'close'
   and watchdog rollback paths released the pooled client while the route
   handler could still be running (Express does not cancel handlers). The next
   request would borrow the same client, set ITS jwt claims, and the slow
   handler would query inside the wrong user's RLS context. Now only the
   COMMIT path (res 'finish' — handler done) returns a client to the pool;
   every rollback path destroys the connection (`release(true)`).
2. **Button primitive was implicitly `type="submit"`.** The extracted Button
   dropped the `type="button"` the inline buttons carried, so Cancel in the
   New List / New Deck / Import Deck / Bug Report modals SUBMITTED the form.
   The primitive now defaults `type="button"`; submits opt in explicitly.
   Tabs' internal buttons hardened the same way.
3. **Direct-Postgres request pools lost the B2 hard cap** (`cap` keyed off
   role, not backend) — POOLED_CAP 24 applied to the reference self-host box.
   Caps now follow the backend: pooler 24, direct 3, restoring the
   "misconfiguration cannot blow the cluster budget" guarantee.
4. **PGPOOL_MAX leaked into request pools** (old cloud .envs carry
   PGPOOL_MAX=3 → API re-capped at 3), and **an empty-string pool var became
   max 1** (Number('')===0). PGPOOL_MAX now applies to workers only; sizes
   parse via parseInt with a >0 guard.
5. **`pnpm dev` on a fresh clone died in a buried module cascade** — the
   first-run build skipped @deckpal/storage and ignored exit codes. It now
   builds db → storage → api in order and aborts loudly on failure.
6. **Premium body grain repainted the viewport every scroll frame**
   (`background-attachment: fixed` cannot be composited on many GPUs, and iOS
   Safari ignores it — the grain scrolled, the exact "tell" the design
   rejects). Now a fixed-position body::before compositor layer;
   `isolation: isolate` on body keeps it above body's background. Verified
   pixel-identical by RMSE against a same-state screenshot baseline.
Also: PWA manifest/index.html theme colors updated from retired #15181f to
stone-900 #1c1917; /design pending meter made honest (13/13, backlog entries
deleted as the plan prescribes); theme.css parser extracted to
`routes/design/themeTokens.ts` (multi-line section headers, gradient tokens
categorized permissively, z tokens live-previewable since C11a); AGENTS.md B2
rewritten to the role/backend contract.
**Known, deliberately not fixed here:** topbar.ts/useTopbar mirrors
skin.ts/useSkin (~230 lines) — deliberate while both toggles exist for
judging the pass; collapse to one factory if they survive the decision.
28 of 48 branch commits lack the `On-Behalf-Of` trailer; rewriting pushed
history mid-PR was judged worse than the gap — noted in the PR instead.

