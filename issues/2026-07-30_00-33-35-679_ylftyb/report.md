---
id: 2026-07-30_00-33-35-679_ylftyb
status: resolved
createdAt: 2026-07-30T00:33:35.679Z
resolvedAt: 2026-07-30T01:52:00.000Z
resolution: "TWO-STAGE FIX. First attempt (2026-07-30 01:52, commit 3ae8c27) detected the bounce and reloaded the page — but in the installed PWA the service worker serves any /pokedex/* navigation from the precached shell, so the reload never reached nginx and the app dead-ended on the error screen anyway (recurred same day). Real fix: on bounce, api.ts navigates to /authelia/?rd=<current page> — outside the SW scope, so it always hits the network, runs the login, and returns to the same page. Detection hardened (opaqueredirect + ok-but-HTML on API paths), portal ping-pong loop-guarded. Verified in-browser with a faithful nginx-302 simulation incl. an SW-controlled page."
page: /pokedex/series/mega-evolution/me05
viewport: 428x781
userAgent: Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5.2 Mobile/15E148 Safari/604.1
screenshot: screenshot.jpg
---

Every so often my auth will expire and then the site just breaks and says something went wrong and it won’t show me anything instead it should just redirect to auth
