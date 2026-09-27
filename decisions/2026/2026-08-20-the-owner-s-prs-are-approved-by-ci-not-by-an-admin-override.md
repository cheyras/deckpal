---
date: "2026-08-20"
title: "The owner's PRs are approved by CI, not by an admin override"
decided_by: "user (\"I want to be able to approve my own PRs\")."
areas: ["operations"]
supersedes: []
---
## 2026-08-20 — The owner's PRs are approved by CI, not by an admin override
**Decided by:** user ("I want to be able to approve my own PRs").

GitHub does not permit **anyone** to approve their own pull request — a platform
rule, not a setting. The `main` ruleset requires one approving review, so every
owner PR was blocked and merged with `--admin`.

`--admin` is the wrong habit: `bypass_mode: always` skips required status checks
too, so the reflex that merges an unreviewed PR is the reflex that merges a red
one. Instead `.github/workflows/owner-approve.yml` approves PRs authored by the
repository owner from a branch in this repo. `github-actions[bot]` is not the
author, so its approval is valid, and owner PRs now merge through the front door
with CI enforced. `require_code_owner_review` was turned off in the ruleset —
with `CODEOWNERS` set to `* @cheyras` a bot approval could never satisfy it, and
it was the only thing making the override necessary. Contributor PRs still
require the owner's human review, and self-approval remains impossible for
everyone.

Uses `pull_request_target` and never checks out PR code — it makes one API call —
which is what makes that trigger safe here. Both the author and the head
repository are checked, so a fork PR cannot reach it.

