---
date: "2026-08-16"
title: "Asset-shaped URLs must 404, not serve the SPA shell"
decided_by: "Claude, on the user reporting the wrong icon when saving the"
areas: ["security","catalog"]
supersedes: []
---
## 2026-08-16 — Asset-shaped URLs must 404, not serve the SPA shell
**Decided by:** Claude, on the user reporting the wrong icon when saving the
site to an iOS home screen.

**Symptom:** adding DeckPal to the home screen produced the marketing hero
banner instead of the app icon.

**Cause:** iOS probes `/apple-touch-icon-precomposed.png` at the site root
*before* it honours the `<link rel="apple-touch-icon">` tag. That file did not
exist, and the SPA fallback rewrite (`/(.*) → /index.html`) answered it **200
with the HTML shell** rather than 404. iOS cannot decode HTML as an image, so
it abandoned the icon entirely and fell back to its last resort: a screenshot
of the page. On the landing page that screenshot is the hero.

Every asset-shaped miss behaved this way — `/nonexistent.png`, `/favicon-9.ico`
and any sized apple-touch variant all returned 4,694 bytes of `text/html` with
a 200. This is the same failure class as the image tier serving `index.html`
for every card URL (2026-08-10 entry); it was fixed there for `/deckpal/images`
specifically and left standing everywhere else.

**Decision:** the SPA fallback no longer matches paths ending in a known asset
extension, so a missing asset reaches Vercel's real 404. Extensions are listed
explicitly rather than excluding "any path containing a dot", because real app
routes contain dots — `/series/scarlet-violet/sv03.5` has to keep reaching the
router. `apple-touch-icon-precomposed.png` is also emitted as a real file, so
the probe succeeds outright rather than relying on a clean 404.

**Implications:**
- A missing asset is now a visible 404 instead of a silent HTML 200. Anything
  that was quietly "working" by receiving the shell will now fail loudly, which
  is the point.
- Adding a new asset extension to the app means adding it to the exclusion list
  in `vercel.json`, or its misses go back to serving HTML.
- `scripts/gen-app-icons.mjs` no longer writes `favicon-*`: those belong to
  `scripts/gen-favicon.mjs`. Both writing them meant whichever ran last won, and
  running the app-icon script silently replaced the drawn pixel art with a
  downscale of the render.
- iOS never re-fetches the icon of an already-added home-screen shortcut. Fixing
  this server-side does not repair an existing tile — it has to be removed and
  re-added.

