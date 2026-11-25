---
date: "2026-11-25"
title: "Browser CI shards run in the Playwright image"
decided_by: "Chey (via Claude)"
areas: ["operations"]
supersedes: []
---
## 2026-11-25 — Browser CI shards run in the Playwright image
**Decided by:** Chey (via Claude)

**Decision:** `browser.yml`'s eight shards run inside Microsoft's Playwright container image
(`mcr.microsoft.com/playwright:v1.63.0-noble`) instead of installing browsers on the bare runner. The
Playwright browser cache and both install steps (`install --with-deps` on a miss, `install-deps` on a hit)
are gone. A small step compares the image tag with the `playwright` version in `package.json`; if they
drift it warns and downloads only the matching browsers, with no apt step. The 15-minute shard limit stays.

**Why:** From 2026-11-23 every browser run was cancelled (PRs 374, 375, 376 and a main push). The job
logs show the shards dying inside `playwright install --with-deps chromium webkit`: the browsers took
seconds, but apt pulled 126 MB of WebKit system libraries from the Ubuntu mirror at a crawl, 11+ minutes,
before a single test ran. The same step took under a minute on 2026-11-15. The cache from 2026-09-26 never
helped here: every shard of those runs missed it (PR caches are scoped to their branch, and main had no
fresh entry), and even a hit still ran `install-deps`, the same apt download. Chey declined raising the
limit to 30 minutes because it spends build minutes on waiting; the image removes the waiting instead.

**Implications:**
- Each shard pulls the image (Docker layers, not the Ubuntu mirror) instead of running apt. No apt step
  remains anywhere in the browser job.
- Two container details live in a "Prepare the container" step: the workspace is marked a git safe
  directory (the container runs as root over a runner-owned checkout, and suites call `git ls-files`), and
  `~/.cache/ms-playwright` links to the image's `/ms-playwright`, because `isolatedEnv` in
  `tests/browser/support.mjs` passes only PATH and HOME to child suites and so drops the image's
  `PLAYWRIGHT_BROWSERS_PATH`. The test isolation itself is unchanged.
- A Playwright bump needs the image tag and `IMAGE_PLAYWRIGHT` in `browser.yml` bumped with it. Until then
  the run still works, with a warning annotation.
- Supersedes the browser-cache half of 2026-09-26's "Browser CI job: cache Playwright browsers"; its
  concurrent build+check half is unchanged.
