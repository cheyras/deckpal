---
date: "2026-09-12"
title: "Repo-level pnpm pin (pnpm@10.34.5) without touching global state"
decided_by: "GLM-5.2 (Ringer mechanical worker). CI ran `pnpm10` while the"
areas: ["general"]
supersedes: []
---
## 2026-09-12 — Repo-level pnpm pin (pnpm@10.34.5) without touching global state
**Decided by:** GLM-5.2 (Ringer mechanical worker). CI ran `pnpm10` while the
frozen lock was generated and tested on `10.34.5`, but nothing in the repo said so.

**Decision:** Pin the package manager at the repo level only — `package.json`
carries `"packageManager": "pnpm@10.34.5"`, and the `pnpm/action-setup@v6`
`with.version` input was removed so CI infers the version from the pin. No
dependency version, lockfile or workspace config changed; no global pnpm reinstalled.

**Why.** The pin keeps local install behavior aligned with the tested CI
toolchain from one source of truth, without a machine-wide change. Auto-selection
was confirmed only on this machine's native pnpm11.13.1 launcher
(`manage-package-manager-versions` default), not promised for all configurations.

**Implications.** Non-global fallback: `npx --yes pnpm@10.34.5 --version`, then
`npx --yes pnpm@10.34.5 install --frozen-lockfile`. A manager change is a one-line
`packageManager` edit, then a frozen install and full validation, with lock
changes only if the frozen install requires them — not a regeneration when the
lock is unchanged. This does not upgrade pnpm.

---

