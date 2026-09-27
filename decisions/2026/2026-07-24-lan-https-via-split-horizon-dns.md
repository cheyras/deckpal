---
date: "2026-07-24"
title: "LAN HTTPS via split-horizon DNS"
decided_by: "user, at the Phase 1 checkpoint."
areas: ["general"]
supersedes: []
---
## 2026-07-24 — LAN HTTPS via split-horizon DNS
**Decided by:** user, at the Phase 1 checkpoint.
**Decision:** add a split-horizon DNS entry pointing the public hostname at the
host's LAN IP so the existing Let's Encrypt certificate serves LAN clients,
making the HTTPS URL a **secure context** on the LAN.

**Why:** the plain-HTTP LAN hostname is plaintext, so service workers, install,
and offline are impossible there on every browser — which makes the BRIEF's PWA
and offline-resilience requirements unmeetable on LAN. This is the cheapest fix:
no new certificate, no new port, no external dependency.

**Implications — this touches shared infrastructure, so treat it carefully:**
- It changes DNS resolution for **every** service on this box, not just pokedex.
- Before changing anything: record how each existing service resolves today, make
  the change, then verify each one still resolves and still serves. Roll back on
  any regression.
- The SSO gate still guards the route; LAN clients will now traverse it too.
  Confirm that is acceptable, or add a LAN bypass deliberately rather than by
  accident.
- Scheduled for the hardening phase, **not** done casually mid-build.

### Related, box-wide (not a pokedex decision)
nginx `gzip_types` is commented out in `nginx.conf`, so JS/CSS/JSON are served
**uncompressed for every service on this machine** today. `gzip_static` is compiled
in; brotli is not. Any fix should be scoped to pokedex's own location blocks rather
than editing the global config — raised to the user as a separate observation.

