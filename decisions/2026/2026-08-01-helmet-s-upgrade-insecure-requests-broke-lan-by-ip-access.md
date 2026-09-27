---
date: "2026-08-01"
title: "helmet's `upgrade-insecure-requests` broke LAN-by-IP access"
decided_by: "Not recorded"
areas: ["general"]
supersedes: []
---
## 2026-08-01 — helmet's `upgrade-insecure-requests` broke LAN-by-IP access
**Symptom:** accessing the app via bare LAN IP on a phone = blank black screen (the
dark app shell HTML renders; JS never loads). Devices not using the host's split-horizon
DNS hit this path.
**Cause:** the API serves the SPA with `helmet()` defaults, whose CSP includes
`upgrade-insecure-requests`. On a plain-HTTP origin the browser upgrades every subresource
to `https://<bare-ip>/...`; the only 443 vhost carries the public-hostname cert ->
`ERR_CERT_COMMON_NAME_INVALID` -> no bundle. Invisible over real HTTPS (public hostname),
where the directive is a no-op — which is why it looked like it "worked" everywhere else.
**Decision:** drop only that directive (`contentSecurityPolicy.directives.upgradeInsecureRequests:
null`, `useDefaults: true` otherwise) in `apps/api/src/index.ts`. All content is same-origin
and the public path is HTTPS via nginx regardless, so nothing is lost. Verified in a real
browser at 390px via IP after the change.

