---
date: "2026-08-11"
title: "Bug reporter splits into bug vs. feature request (issue #32)"
decided_by: "user (issue report), implemented by agent."
areas: ["general"]
supersedes: []
---
## 2026-08-11 — Bug reporter splits into bug vs. feature request (issue #32)
**Decided by:** user (issue report), implemented by agent.
**Decision:** The in-app reporter (`apps/web/src/components/BugReport.tsx`,
`apps/api/src/routes/bugs.ts`) now carries a `kind: 'bug' | 'feature'` field
end-to-end instead of assuming every report is a bug:

1. **Migration `034_bug_report_kind.sql`** adds `bug_report.kind TEXT NOT NULL
   DEFAULT 'bug' CHECK (kind IN ('bug', 'feature'))`. Default `'bug'` keeps
   existing rows and any client that omits the field (self-host, a stale
   cached bundle) meaningful without a breaking change. No RLS changes: the
   023 policies are row-scoped (`user_id = auth.uid()`), not column-scoped.
2. **Backend** — `parseKind()` defaults anything other than the literal string
   `'feature'` to `'bug'` rather than 400ing (additive field). `ensureLabel()`
   is generalized from a hardcoded `"in-app-report"` triple to take a
   `LabelSpec`; `labelsForKind()` returns the unchanged umbrella
   `in-app-report` label (`d73a4a`, every existing open issue from this
   reporter already carries it) plus a kind-specific second label —
   `bug` (`d73a4a`) or `feature-request` (`a2eeef`, GitHub's conventional
   "enhancement" blue). `createGhIssue()` ensures both labels and files the
   issue with both. Self-host mode's `report.md` frontmatter gains a `kind:`
   line.
3. **Frontend** — a segmented Bug / Feature-request toggle (same idiom as the
   Overview/Trends sub-toggle and currency toggle in `Insights.tsx`) drives
   the modal title and helper/placeholder copy. Screenshot capture is
   unchanged for both kinds. Trigger button's aria-label/title broadened to
   "Report a bug or feature request".
4. Extended `bugs.test.ts` with `parseKind`/`labelsForKind` unit tests
   (default-to-bug, invalid-falls-back-to-bug, both labels present per kind).

**Why:** Issue #32 — users had no way to signal "this is a feature idea" vs.
"this is broken"; every report went out as an undifferentiated bug, and every
GitHub issue this reporter ever filed got the same single label regardless of
intent.

**Implications:**
- Any future consumer of `bug_report` rows (dashboards, the `fix-issues`
  skill) can now filter/group by `kind`.
- `ensureLabel`/`createGhIssue`/`labelsForKind` are exported and pure/testable
  (labels are plain data — no network call needed to verify which labels a
  given kind requests).
- Verified end-to-end against a **local, migrated dev Postgres** with real
  `GITHUB_TOKEN`/`GITHUB_REPO` (isolated from `SUPABASE_MODE`/RLS, which stay
  unset so identity resolves to the self-host single local user) — this let
  the reporter file a real GitHub issue (cheyras/deckpal#36, both labels
  confirmed, then closed) without applying the migration to production
  Supabase, which stays a deliberate, separate deploy step the site owner
  triggers themselves.

_Filed by agent on behalf of @cheyras — 2026-08-11._

