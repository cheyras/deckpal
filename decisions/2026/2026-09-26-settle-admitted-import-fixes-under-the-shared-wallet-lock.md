---
date: "2026-09-26"
title: "Settle admitted import fixes under the shared wallet lock"
decided_by: "Chey (via Codex)"
areas: ["data","catalog"]
supersedes: []
---
## 2026-09-26 — Settle admitted import fixes under the shared wallet lock

**Decided by:** Chey (via Codex)

**Decision:** A paid import fix debits one whole-credit hold when admitted. Its measured fractional cost is settled exactly once with any unused hold returned in the same ledger transaction. Settlement remains available to a trusted server request after the account is suspended; suspension still bars new work. A candidate lookup truncated at 400 printings offers no suggestion for that line.

**Why:** Counting pending fixes did not stop a simultaneous chat spend from consuming the last credit. Requiring an active account at settlement stranded the cost of work already performed. An incomplete printing page could hide another gameplay identity.

**Implications:** Migration 077 records the hold by request and preserves the existing whole-credit wallet and fractional carry. The API retries idempotent settlement; a wallet read releases an unsettled hold after 15 minutes and records unknown provider cost. Rare provider cost above the hold remains visible as debt through the wallet's established overrun rule. The import dialog asks the reader to resolve catalogue lines whose candidate search was truncated, and refreshes the cached wallet when a fix finishes. Repair cost remains visible in usage history but does not enter planning price estimates.
