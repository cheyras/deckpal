---
date: "2026-08-09"
title: "/deckpal nginx cutover (user approved)"
decided_by: "Not recorded"
areas: ["decks"]
supersedes: []
---
## 2026-08-09 — /deckpal nginx cutover (user approved)

Both vhost fragments now route `/deckpal/*` with a permanent `301` from legacy
`/pokedex/*` (old bookmarks and the installed PWA redirect instead of breaking; the
phone PWA should still be reinstalled so its start URL/scope move off the redirect).
App processes restarted on the post-rename build, nginx reloaded. Verified: API health
200 via nginx, images health ok, MCP listening, SPA loads at desktop + 390px
(screenshots reviewed). The restart hazard documented earlier today is closed.

