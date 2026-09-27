---
date: "2026-09-26"
title: "Corrective approval cards sign apply intent"
decided_by: "Chey (via Codex)"
areas: ["catalog"]
supersedes: []
---
## 2026-09-26 — Corrective approval cards sign apply intent
**Decided by:** Chey (via Codex)
**Decision:** A corrective `edit_list`, `save_deck` or `add_battle_log` call uses a correction-only schema whose `dry_run` defaults to `false` and rejects `true`. The parsed `false` is part of the SDK's signed approval input. The ordinary tool schemas retain their safe `dry_run: true` defaults.
**Why:** Astra found that forcing a tool name alone could produce only a dry run: those three tools default to preview, so the one-step correction would stop without a card. A real-SDK test for each tool now proves that an omitted `dry_run` becomes a signed apply request, raises the card with zero writes, and applies only after signed approval is replayed under the ordinary tool set.
**Implications:** Corrective tool choice can no longer silently become a preview because the model omitted `dry_run`. Invalid or declined calls still fail closed, and the existing approval gate remains the only route to a write.
