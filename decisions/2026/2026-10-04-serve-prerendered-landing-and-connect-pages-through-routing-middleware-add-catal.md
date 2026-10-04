---
date: "2026-10-04"
title: "Serve prerendered landing and connect pages through Routing Middleware, add catalog sitemaps and per-page metadata"
decided_by: "Chey (via Claude Opus 5.5)"
areas: ["web", "seo", "api", "infra"]
supersedes: []
---
## 2026-10-04 — Serve prerendered landing and connect pages through Routing Middleware, add catalog sitemaps and per-page metadata
**Decided by:** Chey (via Claude Opus 5.5)

**Decision:** DeckPal's public pages are made fully crawlable.

- **Routing Middleware serves the prerendered documents.** A root `middleware.ts` (Vercel Routing Middleware, using `rewrite` from `@vercel/functions`) rewrites `/` to `dist/landing.html` and `/connect` to `dist/connect.html`.
  - The matcher is only those two exact paths. It never matches the documents themselves, so a rewrite cannot loop, and it keeps the query string.
  - A vercel.json rewrite could not do this: on the PR #275 preview, Vercel served the real `index.html` for `/` before applying rewrites.
  - The owner approved this routing change on 2026-10-04 ("Full SEO to ensure search engines pick us up"). It was chosen over renaming the shell to `app.html` because it touches only these two paths, the service worker and the catch-all rewrite are left alone, and self-host is unaffected.
- **`/connect` is prerendered like the landing.** `renderConnectStatic()` builds it from `COPY.connectPage` and `COPY.connect`. Each prerendered document gets its own title, description, og/twitter tags, canonical and og:url. The landing keeps its FAQPage JSON-LD, and every shell keeps WebApplication JSON-LD.
- **`/landing.html` no longer sends `X-Robots-Tag: noindex`.** Now that the middleware serves that file for `/`, a header keyed on the file risked noindexing the homepage. The document's canonical (`https://deckpal.app/`) already folds direct requests into `/`.
- **Every public page sets its own metadata at runtime.** `lib/seo.ts` exports `usePageMeta`, which sets the title, description, og/twitter text, a canonical of origin plus path with no query string (cloud only), and `robots: noindex` where asked.
  - It is wired into the landing, `/connect`, `/privacy`, `/series`, series, set, card, `/pokedex` and species pages.
  - Not-found and error states are noindex, and so are search results and the auth pages.
  - Before this, all twenty-odd thousand catalog pages shared the landing's title and description.
  - The card page sets its metadata in the route, not the shared card body, because that body is also the `?card=` sheet over other pages.
- **Catalog sitemaps.** `apps/api/src/sitemaps.ts` serves `/sitemap-pages.xml`, `/sitemap-sets.xml`, `/sitemap-cards.xml` and `/sitemap-pokedex.xml` from the live catalog.
  - It reads the same `browsable_*` views and builds paths the way `CardLink` does.
  - They sit at the bare origin, because a sitemap may only list URLs at or below its own path. They are cloud-only and cached for a day at the CDN (`s-maxage=86400`).
  - A request with a query string is redirected to the clean URL, so query variants cannot bypass the cache. They have their own 30/min per-IP limit, because they sit outside the `/api` flood guard.
  - `public/sitemap.xml` is now a sitemap index of the four, and robots.txt already points at it.
  - The Pocket-exclusion integration suite checks them against the real migrations.
- **`DECKPAL_PUBLIC_ORIGIN` is documented** in DEPLOYMENT.md. The OAuth routes already read it, and now the sitemaps do too, with a default of `https://deckpal.app`.

**Why:** The owner asked for "full SEO to ensure search engines pick us up." Before this change:

- A crawler that does not run JavaScript got an empty shell at `/`.
- Google saw the same title on every catalog page.
- The sitemap listed three URLs.

The catalog (cards, sets and species, with prices) is the part of DeckPal people search for by name, so it needed its own titles and a sitemap that lists it.

**Implications:**
- After deploy, check `/` and `/connect` with `curl -s https://deckpal.app/ | grep -c seo-landing` (and `seo-connect`).
- Google Search Console verification and sitemap submission need the owner's Google account. The steps are in the handoff to the owner.
- Catalog pages are still client-rendered. Google renders them; crawlers that do not run JavaScript see only the shell there. Prerendering 20,000+ card pages is a separate decision.
- A new public page should call `usePageMeta`, and its path belongs in the `PAGES` list in `apps/api/src/sitemaps.ts` if it is top-level.
