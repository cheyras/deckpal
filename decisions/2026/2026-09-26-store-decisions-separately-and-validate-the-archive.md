---
date: "2026-09-26"
title: "Store decisions separately and validate the archive"
decided_by: "Chey (via Codex)"
areas: ["engineering"]
supersedes: []
---
## 2026-09-26 — Store decisions separately and validate the archive
**Decided by:** Chey (via Codex)

**Decision:** Keep one decision per dated file under `decisions/YYYY/`. Preserve the 341 dated entries from the former `DECISIONS.md` in their original order and with their body bytes unchanged. Keep its opening note and five undated progress sections under `decisions/legacy/`. Make `DECISIONS.md` a guide and keep a historical index for old date citations. Provide a CLI for reading and adding decisions, a branch converter for old append-only PRs, a wiki generator, and a CI check of the archive and guide.

**Why:** Every open PR that appended to the 1.3 MB shared log conflicted after another PR merged. GitHub then skipped CI for the conflicting PR. Chey approved automating this so contributors no longer have to resolve the same document conflict repeatedly.

**Implications:** New decisions must be files, with front matter for date, title, decider, areas, and explicit supersessions. `pnpm decisions:check` proves the historical body hashes and complete original document hash and rejects dated entries in the guide. Existing branches should merge main and run `pnpm decisions adopt-branch`, including while resolving a log conflict; it extracts their added entries and restores the new guide. The wiki Decision Log is generated from the files after a decision changes. The migration does not normalize whitespace, line endings, punctuation, or entry order; only the new front matter and filenames add metadata.
