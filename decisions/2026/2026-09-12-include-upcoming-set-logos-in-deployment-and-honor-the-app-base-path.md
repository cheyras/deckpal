---
date: "2026-09-12"
title: "Include upcoming-set logos in deployment and honor the app base path"
decided_by: "Codex in-session worker on behalf of @cheyras, recording the"
areas: ["images","catalog","operations"]
supersedes: []
---
## 2026-09-12 — Include upcoming-set logos in deployment and honor the app base path

**Decided by:** Codex in-session worker on behalf of @cheyras, recording the
supervisor's production-smoke finding and authorized follow-up repair.

**Trigger.** PR #182 merged, but a read-only production GET of
`/brand/pokemon-30th-celebration-logo.webp` returned 404. The WebP was tracked
and present in local builds; `.vercelignore`'s blanket WebP exclusion omitted
it from deployment. Git inclusion and deployment-upload inclusion are separate
boundaries, so the existing `.gitignore` exception could not prevent this.

**Decision.** Add the exact
`!apps/web/public/brand/pokemon-30th-celebration-logo.webp` exception to
`.vercelignore`, preserving the broader image-cache exclusions and the logo's
unchanged bytes. Extend `apps/web/scripts/check-precache.mjs` to derive local
`logoAssetPath` literals from `apps/api/src/upcomingSets.ts` and require the
referenced files in `dist`. A missing logo now fails the build with actionable
diagnostics naming both `.gitignore` and `.vercelignore`; future local
announcements enter this gate through their metadata. `UpcomingSetRow` uses
`import.meta.env.BASE_URL` with the local logo path, supporting both the cloud
root `/` and self-host `/deckpal/` instead of forcing a root-relative URL.
Deployment and brand-maintenance guidance now requires both exact exceptions
and their removal when the announcement asset is retired.

**Observed verification.** The supervisor executed and passed upload
allow/deny checks, the negative control that removes the upload exception,
the missing-logo build-gate negative control, both self-host and cloud builds,
and strict desktop and 390px browser checks. Visual inspection of all four
cloud/self-host screenshots confirmed the title, logo, date and row layout.
These checks exercised asset delivery and base-path behavior locally; the
documentation worker ran no tests and made no production requests.

**Still pending.** Fresh Astra re-review, follow-up GitHub CI and merge, and
the repaired live smoke. The successful PR #182 merge is historical context,
not a claim that this deployment repair is already live.

---

