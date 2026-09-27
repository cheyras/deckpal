---
date: "2026-09-26"
title: "Browser suites register from their own files"
decided_by: "Chey (via Codex)"
areas: ["frontend"]
supersedes: []
---
## 2026-09-26 — Browser suites register from their own files

**Decided by:** Chey (via Codex)

**Decision:** The browser runner discovers every `tests/browser/*.mjs` module and runs suites
returned by its optional `browserSuites(context)` export. The existing build and check
branches live in `core-suites.mjs`; future branches can register from a new file without
editing the runner. The deployment asset gate also awaits the shared asynchronous process
helper, including its standalone invocation.

**Why:** Every parallel feature PR that added a browser suite conflicted on the runner's
maintained list. The first CI run of this PR exposed a missed synchronous call to the process
helper; it failed before reaching the browser checks.

**Implications:** Suite names must be unique, and each suite must own its temporary build,
server and browser contexts. The runner checks this registration contract before executing
the bounded pool. The main-branch write, insights and sign-in-return checks remain in the run. The
table keyboard-scroll check waits for the observed scroll instead of assuming it completes
within 120 ms under concurrent CI load.
The iOS fixture server merged from main also awaits the shared build helper before
processing its output; otherwise its `--rebuild` path would read a Promise as a string.

