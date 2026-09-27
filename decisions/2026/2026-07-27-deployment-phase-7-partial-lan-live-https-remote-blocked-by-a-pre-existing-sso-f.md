---
date: "2026-07-27"
title: "Deployment (Phase 7, partial): LAN live; HTTPS/remote blocked by a pre-existing SSO failure"
decided_by: "Not recorded"
areas: ["operations"]
supersedes: []
---
## 2026-07-27 — Deployment (Phase 7, partial): LAN live; HTTPS/remote blocked by a pre-existing SSO failure

**Applied and verified (reversible):**
- **Process manager:** API :3700, image service :3701, sync (cron) — all online and
  persisted (survive reboot).
- **API serves the SPA** (`apps/web/dist` + client-route fallback), matching the
  box's proxy-not-static convention — so nginx never needs to traverse the 700 `$HOME`
  (and `setfacl` isn't installed anyway).
- **nginx LAN vhost:** one `include` line added after `server_name` for the
  DeckPal location block. **LAN HTTP access works now**, verified in a browser
  end-to-end (nginx -> api -> images, real art, all 200), and all other co-hosted
  routes still 200.
- **nginx public vhost** (:443): one `include` after the SSO auth-request include
  (SSO-gated). Config correct (`nginx -t` clean).

**Resolved 2026-07-27 (user asked):** root cause was the SSO service's secrets
directory having lost its owner **execute** bit — the service user could not
traverse the dir to read its secrets, so it died at config load on the last boot.
Fix: `chmod u+x` on the secrets directory (surgical; file contents untouched).
SSO service restarted successfully, portal 200. All gated routes recovered.
**Lesson:** if the x-bit is stripped again on a future boot, investigate what
does it — the perm fix itself is persistent and the unit is `enabled`.

**Pre-existing blocker (NOT caused by pokedex): the SSO service was `failed`.**
Its port was not listening; every SSO-gated route 500d — co-hosted routes 500d
with the pokedex include *removed*, proving it was the SSO gate, not us. This
blocked ALL remote/gated access on the box, not just pokedex. **Lead did not
restart it** — it is the user's auth infra and it failed for an unknown reason.
Until it was back:
  - LAN **HTTP** access worked fully (the LAN vhost has no SSO).
  - Remote HTTPS + the LAN-HTTPS/PWA path (via the public hostname) would 500.

**Deferred: split-horizon DNS (Stage D).** The DNS config was ready, but its only
benefit — HTTPS secure-context on LAN for the PWA — required the SSO gate up to
verify, and it was the riskiest change (rewrites DNS resolution of that hostname
for every service). Not worth flipping DNS for an unverifiable, currently-500ing
target. Apply after the SSO gate is healthy.

**Rollback:** vhost backups saved; remove the two `include` lines + `nginx -t` +
reload; delete the managed processes and persist the change.

