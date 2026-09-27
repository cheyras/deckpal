---
date: "2026-09-26"
title: "Bug-report screenshots stop carrying a public signed URL (SEC-06)"
decided_by: "Chey (via Claude)"
areas: ["frontend","security"]
supersedes: []
---
## 2026-09-26 — Bug-report screenshots stop carrying a public signed URL (SEC-06)

**Decided by:** Chey (via Claude)

**Decision:** The in-app bug reporter (`apps/web/src/components/BugReport.tsx`,
`apps/api/src/routes/bugs.ts`) now (1) tells the reporter, before Submit, whether
the description and page path are posted publicly on GitHub, using the API's
actual `GITHUB_TOKEN` and `GITHUB_REPO` setting exposed as `bugReportsPublic`
in `/api/public-config` (served with `no-store` so a changed destination cannot
leave a stale privacy promise); it explains that any screenshot is saved separately,
never linked in the public issue, and can be excluded with a checkbox;
(2) never attempts or
stores a screenshot at all on `/admin`, `/profile` or `/credits` pages, including
mixed-case and encoded URLs the router accepts,
(`isSensitiveBugPage`, enforced both client- and server-side); and (3) never
puts a link to the screenshot's bytes — signed or otherwise — in the public
GitHub issue body. `formatIssueBody` now takes `screenshotSaved: boolean`
instead of a URL. The reported page path is stripped of its query string and
fragment before it is stored or published, and the screenshot's content type
is sniffed from its bytes (`decodeScreenshot`, using the same
`sniffContentType` the avatar upload path already used) rather than trusted
from its declared data-URL prefix.

**Why:** The security audit (`audits/security.md` SEC-06) found that a bug
report filed from any page posted the reporter's username, avatar and
whatever else was on screen to the public repo, with no disclosure that it
would be public at all — and that a report filed from `/admin/users` or
`/admin/users/:id` published **another signed-in user's email address**,
since the bug button sits in the top nav on every page and the screenshot
captured whatever was rendered underneath it. Separately, a saved screenshot
got a Supabase Storage signed URL with a **one-year expiry**, embedded
directly in the public issue body — readable by anyone who found the issue,
for that whole year, no sign-in required. Issue #75's body was the confirming
example (`iat`/`exp` in the signed token's own payload showed a 365-day
window). A read-only audit of all 49 `in-app-report` issues (`gh issue list
--repo cheyras/deckpal --state all --label in-app-report`) found **38** with
a still-live signed screenshot URL, expiring between 2027-08-09 and
2027-09-11 — none have expired yet, so every one of them is exposed right
now. Two (#24, #33) are still open; the other 36 are closed but no less
public. Full list with per-issue report IDs and expiry dates is in the PR
description; no issue body or Storage object was edited as part of this
change, per instruction.

**The owner-accessible-location choice.** The audit offered two shapes for
"don't put a long-lived signed URL in a public issue": (a) a link to an
owner-accessible location (the `bug_report` row, or an admin viewer), or (b) a
short-lived signed URL embedded in the issue. (b) does not actually work for
this use case: the issue is created once, synchronously, at report time, and
triage is asynchronous — a URL short-lived enough to be safe in a *public*
issue would very often have expired before the owner opens the issue. (a) was
chosen, in its simplest form: the public issue states only that a screenshot
was saved privately (never a URL, of any lifetime), and the owner reaches the
bytes through Supabase Storage directly or the private `bug_report` row, by
Report-ID — both of which the project owner already has standing access to.
A bespoke authenticated admin viewer page (a new API route plus a new
`admin_api` SQL dispatch case, per `apps/api/src/admin/access.ts`) was
considered and rejected as disproportionate to an S-effort fix: it would add a
new permission surface for a low-stakes internal utility the owner can
already reach through infrastructure they operate. The AI triage workflow
(`.github/workflows/issue-triage.yml`, `scripts/triage-issue.sh`) only ever
reads the issue's text body, never the screenshot, so removing the link from
the body changes nothing about its behavior.

**Implications:** No screenshot URL of any kind will appear in a future
public issue. The 38 pre-existing exposures are **not fixed by this change**
— they are pre-existing public issue bodies, and per this task's instructions
no issue body or Storage object was edited. The recommendation (rotating or
revoking the 38 signed URLs, or editing the issue bodies to remove them) is
in the PR description for the maintainer to act on directly. New tests:
`apps/api/src/__tests__/bugs.test.ts` covers `isSensitiveBugPage`,
`sanitizePagePath`, and `decodeScreenshot` (including a PNG-declared data URL
that actually contains HTML bytes, which must 400). A browser test
(`tests/browser/bugReport.mjs`) verifies the disclosure copy, the
include/exclude checkbox, and the sensitive-page skip at 390 and 1440px.
