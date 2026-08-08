---
id: 2026-08-03_01-57-39-626_s5ig9r
status: resolved
resolvedAt: 2026-08-08T02:00:00.000Z
resolution: The header search was a static mockup — the mobile circular button had no onClick and the desktop input had no value/onChange/submit, so neither did anything on any page. There was also nowhere to go: the API has a full 12-filter /search endpoint but the SPA had no search route. Added /search (routes/SearchResults.tsx + globalSearch.ts, registered in main.tsx) with URL-held q/sort/dir/page, debounced input, sort chips and pagination, rendering the shared GridView. Cross-set routing needed the series SLUG, which the search API selected internally but never exposed — added series {slug,name} to each card in apps/api/src/routes/search.ts. Header now submits to /search (desktop, Enter) and links to it (mobile button). Dropped the decorative sliders icon rather than leave a second dead affordance — the API's filter vocabularies still have no UI. Verified in-browser at 390px and 1440px against the deployed build, zero console errors.
createdAt: 2026-08-03T01:57:39.627Z
page: /pokedex/series/mega-evolution/me05
viewport: 428x926
userAgent: Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5.2 Mobile/15E148 Safari/604.1
screenshot: screenshot.jpg
---

Clicking the search button in the top chrome does bothinf
