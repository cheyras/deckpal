---
date: "2026-07-27"
title: "Split-horizon DNS + backup cron applied (user: \"all of the above\")"
decided_by: "Not recorded"
areas: ["operations"]
supersedes: []
---
## 2026-07-27 — Split-horizon DNS + backup cron applied (user: "all of the above")

- **Split-horizon DNS DONE.** Added a local DNS override pointing the public hostname at the host's LAN IP (mirrors the existing split-horizon entries). Config tested, service restarted. Verified: hostname resolves to LAN IP; existing split-horizon entries + external DNS still resolve; **LAN HTTPS serves a VALID cert** (curl without -k -> 302 SSO gate, not a cert error) -> secure context enabled -> PWA now possible on LAN. Co-hosted routes + SSO portal still serve over the LAN path. Rollback: remove the config file and restart the DNS service.
- **Backup cron DONE.** User crontab: `15 4 * * * bash scripts/backup.sh` (between existing scheduled jobs). Script already proven (valid dump + restore-drill).
- **In flight:** catalog-imagery fill (set logos/symbols warm + image-service route + frontend wiring — the "unpopulated/empty" fix) and PDF export backend.
- **Queued (web-file-collision-serialized, after imagery lands):** PWA manifest+SW (now unblocked by LAN HTTPS), stream overlay, card scanner, wire PDF buttons. **Then** zero demo data to pristine baseline (held last so the PDF agent can test against the demo deck/list).

