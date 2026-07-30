---
id: 2026-07-30_00-38-11-751_4sg27s
status: resolved
createdAt: 2026-07-30T00:38:11.752Z
resolvedAt: 2026-07-30T00:54:31.000Z
resolution: Rarity sort was alphabetical on the raw rarity string (DESC started at "Uncommon"). Added a canonical rarity→rank ladder (apps/api/src/rarity.ts, all 40 DB rarities mapped + closest-tier fallbacks) and wired it into the rarity sort in sets.ts, search.ts, dex.ts; verified via API and in-browser at 428px/390px (DESC now starts at Mega Hyper Rare).
page: /pokedex/series/mega-evolution/me05?sort=rarity
viewport: 428x821
userAgent: Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5.2 Mobile/15E148 Safari/604.1
screenshot: screenshot.jpg
---

On the set catalog page sorting by rarity doesn’t seem to work properly, so for example, on this page here when I sort by rarity One Direction, it starts with common cards so the ones marked with the circle, but if I sort it in the other direction, it just starts with like medium cards so the ones marked with a diamond I would expect the other direction to start with like super ultra rare or whatever they term that
