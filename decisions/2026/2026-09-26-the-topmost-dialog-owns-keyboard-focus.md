---
date: "2026-09-26"
title: "The topmost dialog owns keyboard focus"
decided_by: "Chey (via Codex)"
areas: ["general"]
supersedes: []
---
## 2026-09-26 — The topmost dialog owns keyboard focus

**Decided by:** Chey (via Codex)

**Decision:** The phone navigation drawer handles Escape and Tab only while it is the topmost modal dialog, matching the shared Sheet component's rule.

**Why:** The header can open the bug report sheet while the drawer remains open. The drawer's capture listener otherwise intercepts backward Tab from the sheet and pulls focus behind the visible dialog.

**Implications:** A dialog above the drawer owns its keyboard loop until it closes; the drawer resumes its own focus trap afterward.
