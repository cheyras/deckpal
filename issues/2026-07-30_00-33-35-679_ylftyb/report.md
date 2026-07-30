---
id: 2026-07-30_00-33-35-679_ylftyb
status: resolved
createdAt: 2026-07-30T00:33:35.679Z
resolvedAt: 2026-07-30T01:52:00.000Z
resolution: Expired Authelia session made API fetches follow nginx's 302 to the portal (HTML instead of JSON) and dead-end on "Something went wrong"; apps/web/src/lib/api.ts now detects the auth bounce (redirected-to-/authelia//HTML/401) and reloads the page so nginx re-runs the login flow (loop-guarded; LAN and genuine 5xx unaffected).
page: /pokedex/series/mega-evolution/me05
viewport: 428x781
userAgent: Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5.2 Mobile/15E148 Safari/604.1
screenshot: screenshot.jpg
---

Every so often my auth will expire and then the site just breaks and says something went wrong and it won’t show me anything instead it should just redirect to auth
