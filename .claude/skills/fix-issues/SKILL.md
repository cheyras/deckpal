---
name: fix-issues
description: Work through in-app bug reports in the repo's issues/ dir. For each open issue, reproduce it from the comment + screenshot, fix it thoroughly, verify the fix in a real browser, then delete the screenshot and mark the issue resolved. Use when the user asks to fix reported bugs, triage issues, or clear the bug queue.
---

# fix-issues

Bug reports submitted through the app's **Report a bug** button land in `issues/<id>/`
(a `report.md` + a `screenshot.jpg`). This skill takes them from *open* to *verified
resolved*. **The bar is high: never mark an issue resolved unless you have both fixed the
underlying cause and confirmed it visually in a browser.**

## 1. Find the open issues

```bash
rtk grep -l "status: open" issues/*/report.md
```

Work oldest-first (ids sort chronologically). For each issue folder, read `report.md`
(the comment + `page` + `viewport`) and **look at `screenshot.jpg`** — the screenshot is
what the user was actually seeing, and usually shows the problem directly. Read it with the
Read tool; don't skip it.

If there are several unrelated issues, it's fine to fan out — spawn one subagent per issue
on **disjoint files** (cap ~4 concurrent), but you (the lead) still own the verification
step below and must not trust a subagent's "done".

## 2. Reproduce, then fix

1. **Reproduce** on the reported `page` at the reported `viewport` before changing anything —
   open it in a browser (§4) so you can see the bug the user saw. If you cannot reproduce it,
   say so in the resolution note and do **not** guess-fix; ask the user or leave it open.
2. **Find the real cause**, not the surface symptom. The frontend is `apps/web` (React +
   Tailwind), the API is `apps/api` (Express). Match the surrounding code's style.
3. **Fix it.** Keep the change scoped to the issue; don't fold in unrelated edits.

## 3. Build & deploy the fix so it's actually live

The app is served from built output, not source. After editing:

```bash
# web changes:
rtk pnpm --filter deckscout-web build
# api changes:
rtk pnpm --filter deckscout-api build && rtk pm2 restart deckscout-api
```

Then confirm the process is healthy (`rtk pm2 list`; `rtk curl -s http://127.0.0.1/deckscout/api/health`).

## 4. Verify — thoroughly, and visually (required)

This is the point of the skill. An issue is resolved only when **all** hold:

- **The fix addresses the reported problem** (re-read the comment — did you fix *that*?).
- **Type-check / build is clean** (`rtk pnpm --filter deckscout-web build`, and API build if touched).
- **You looked at it in a real browser and the bug is gone.** Use Playwright (installed at
  `~/amazon-mcp/node_modules`, CommonJS: `import pkg from 'playwright'; const {chromium}=pkg`).
  Navigate to the reported `page` on `http://127.0.0.1/deckscout/...` at the reported viewport
  **and** at 390px, screenshot it, and actually inspect the screenshot. One Chromium at a
  time, `--no-sandbox --disable-dev-shm-usage`, close in `finally`, and check for no leftover
  `ms-playwright` processes afterwards (the box's pre-existing `:9222` chromium is not yours).
- **No regression** to the area around the fix (exercise the neighbouring UI in the same shot).

If verification fails, keep working — do not mark it resolved.

## 5. Resolve

Only after §4 passes, for that issue's folder:

1. **Delete the screenshot:** `rtk rm issues/<id>/screenshot.jpg`
2. **Mark it resolved** in `report.md` frontmatter: set `status: resolved`, add
   `resolvedAt: <ISO timestamp>` and `resolution:` (one line on what was fixed + the
   commit/files). Leave the rest of the report intact — it stays as the record.

Do not delete `report.md`; the resolved report is the audit trail.

## 6. Report back

Summarise per issue: what it was, root cause, the fix, and how you verified it (with the
screenshot you looked at). List anything you could not reproduce or chose to leave open, and
why. Commit only if the user asks.

## Guardrails

- **Never mark resolved on faith.** No visual confirmation → not resolved.
- Don't touch other pm2 apps, nginx, or the DB schema to fix a UI bug.
- Prefix every shell command (and every `&&` segment) with `rtk` (see `~/CLAUDE.md`).
- If a report is spam/empty or not actionable, note that in `resolution:` and set
  `status: resolved` without a code change — but say so explicitly.
