---
date: "2026-09-29"
title: "Landing page rewrite: real card art, one shared 3D scene, prerendered copy"
decided_by: "Chey (via Claude Sonnet 5.5)"
areas: ["web", "marketing", "seo", "build"]
supersedes: []
---
## 2026-09-29 — Landing page rewrite: real card art, one shared 3D scene, prerendered copy
**Decided by:** Chey (via Claude Sonnet 5.5)

**Decision:** The logged-out landing (`/`) is rewritten around the loop a player lives: track what you own, ask your own AI to build from it, take the list to Pokémon TCG Live, bring the battle log back, adjust.

- **Real card art.** The page shows real Pokémon cards from DeckPal's own image store, replacing the abstract stand-ins and the "no card art on this page" rule from the 2026-08-10 imagery decision. Card and set names are used nominatively and the footer disclaimer stays. The abstract marketing images (`hero-bg`, `accent-*`, `texture-grid`) are no longer referenced; `og-image` still is.
- **One shared three.js scene.** Twelve foil cards ride down the page in a single fixed canvas and dock into slots inside each showcase (`landing/scene/engine.ts`). The foil is Foilkit's shader, vendored MIT into `landing/foil/` with five recipes baked from foilkit's resolver and canon files. Foil is a marketing visual; the app still renders none. The scene is a dynamic import after first paint, and reduced motion or no WebGL gets the same page with flat art.
- **Showcases are real DOM.** Six simplified, token-true replicas of screens the product has (`landing/showcases/`), each in a pane with CSS depth (`Pane3D`).
- **Copy is one module.** Every user-visible word is in `landing/copy.ts`, which the React page, the prerender, `llms.txt` and the JSON-LD all read. `src/lib/__tests__/landingCopy.test.ts` fails on: any mention of the scanner, Deck-E, credits, matchup stats, simulation, coaching or replay; a drifted `<head>`; a tool count other than 25; em dashes and arrows; rating or review schema.
- **Crawlable.** `vite-plugins/landing-prerender.ts` writes `dist/landing.html` (the landing copy as semantic HTML inside `#root`, its own canonical and og:url, WebApplication and FAQPage JSON-LD) and `llms.txt` / `llms-full.txt`; `vercel.json` serves it for `/` only and marks `/landing.html` noindex. `robots.txt` and `sitemap.xml` are new. The global `<link rel="canonical">` and `og:url` are removed from `index.html`, because every route shares that file and the canonical told search engines every route was the homepage.
- **Build.** three.js gets its own chunk (`three`), the scene its own (`LandingScene`), and `Decke-runtime` no longer contains three, so the landing does not download the character runtime. `three-*`, `LandingScene-*` and `landing.html` join the precache ignores; `check-precache.mjs` and `check-critical-path.mjs` pass.
- **Claims.** The pill rotates Claude, ChatGPT, Gemini, Perplexity and "any AI". Body copy says only that claude.ai is tested end to end and that other clients supporting MCP OAuth (dynamic client registration, PKCE) should connect. Pricing reads "Free to use, pay what you want, $0 included", not "nothing to buy". Tool count is 25 (14 read, 11 write), not 21.

- **Round two (2026-09-30), after owner feedback that the first build was too wild, too fast, too boxy and badly laid out.** Motion is slow and soft everywhere. The hero is a BACKGROUND: all twelve cards fill the hero behind the headline (words sit above the canvas), hold a formation (arches, brick, ring, diagonals, wave) and follow a small light into the next, darker where they pass behind copy (scene/patterns.ts, scene/engine.ts). Below it the page is ordinary full-width sections on a 4/8px spacing scale and a 12-column grid (page.css header): alternating flat tones and a hairline, no cards around text, items separated by space and hairlines. The one drawn object per section is the product window, centred against its copy column and capped near 520px so neither dwarfs the other; on desktop it rises a little above its own section's top edge. Cards fly only into slots that are empty until they arrive (the loop strip, three binder pockets, the AI answer, the closing fan); there are no decorative cards. A fresh-context Opus 5.5 review of the first round found 18 issues; the structural ones are superseded by this layout and the rest were fixed.

**Why:** The old page led with one assistant, quoted stale numbers (21 tools, 20,964 cards, 203 sets, "no card to enter" under pay-what-you-want), never told the Pokémon TCG Live half of the loop, and was invisible to crawlers that do not run JavaScript: raw HTML was a loading skeleton, `robots.txt`, `sitemap.xml` and `llms.txt` were 404, and one canonical covered every route.

**Implications:**
- `vercel.json` gained a `/` rewrite and a header rule. Per B9 the maintainer approves this at review.
- The two Pokémon TCG Live phone screenshots are files the maintainer supplies: `apps/web/public/marketing/ptcg-import.webp` and `ptcg-battle-log.webp`, portrait 1179x2556. Until they exist each phone shows the text that gets pasted, in a plain box.
- ChatGPT, Gemini and Perplexity are named in the headline pill without a test record. Test them, or drop them from `COPY.hero.pillWords`.
- When the scanner or Deck-E is released, `landingCopy.test.ts` is the place to lift the ban, and the copy needs a new section rather than a bullet.
- The README still advertises the scanner and "25 tools"; retrieval agents quote it. Owner decision, not changed here.
- Public catalog routes (`/series`, `/pokedex`, cards) still share one title and are client-rendered; per-route prerender is the next SEO step.
