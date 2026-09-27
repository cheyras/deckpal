---
date: "2026-07-29"
title: "In-app bug reporter + `fix-issues` skill"
decided_by: "Not recorded"
areas: ["general"]
supersedes: []
---
## 2026-07-29 — In-app bug reporter + `fix-issues` skill

Added a **Report a bug** button to the top nav (`components/BugReport.tsx`, wired in
`AppShell` next to Scan). Clicking it captures a screenshot of the current view **before**
the modal opens (so the modal is never in the shot) via **html2canvas** (added as an
`apps/web` dep, **lazy-imported** so it stays out of the initial bundle — it splits into its
own ~47 KB-gzip chunk fetched only on first click), then opens a comment form. Submit POSTs
`{text, page, screenshot(JPEG dataURL), viewport, userAgent}` to **`POST /deckpal/api/bugs`**
(`routes/bugs.ts`), which writes each report to **`issues/<id>/`** in the repo (`report.md`
with YAML frontmatter + `screenshot.jpg`) — reports live in the codebase, not the DB. Raised
the app-wide `express.json` limit to 12 MB for the screenshot payload (every other route is
tiny; nginx already allows 50–100 MB on the DeckPal locations). Screenshots are JPEG q0.85 of
the viewport region (~120 KB).

**Project skill `fix-issues`** (`.claude/skills/fix-issues/SKILL.md`): walks `issues/*/`,
reproduces each open issue from the comment + screenshot, fixes the root cause, **verifies in
a real browser (Playwright) at the reported viewport + 390px**, and only then deletes the
screenshot and flips `status: resolved` (keeping `report.md` as the audit trail). Hard rule:
never resolve without visual confirmation.

Verified end-to-end (Playwright, desktop 1280 + mobile 390): button renders, capture excludes
the modal, submit writes `issues/<id>/{report.md,screenshot.jpg}`, success toast → auto-close.

