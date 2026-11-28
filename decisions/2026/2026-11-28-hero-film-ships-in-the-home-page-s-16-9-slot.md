---
date: "2026-11-28"
title: "Hero film ships in the home page's 16:9 slot"
decided_by: "Chey (owner approval); built by Claude Opus 5.5"
areas: ["frontend"]
supersedes: []
---
## 2026-11-28 — Hero film ships in the home page's 16:9 slot
**Decided by:** Chey (owner approval of the animatic, the Veo pilot and the main run); built by Claude Opus 5.5

**Decision:** The home page's hero video slot (`landing/heroVideo.ts`) now plays the
finished 28 s anime-style film: `hero.webm` (VP9, about 3.5 MB) first, then
`hero.mp4` (H.264 High, `+faststart`, about 4.5 MB), both 1920x1080, 24 fps and
silent. The poster (`hero-*` AVIF/WebP at 2560/1600/960) is the film's first frame,
so the swap from poster to film is invisible. Nothing about how the slot loads
changed: poster first as the LCP, the film attached only after load and idle,
muted inline autoplay while on screen, a pause button, no autoplay under reduced
motion, no film at all on Save-Data or 2G.

**Why:** The redesign (2026-11-27) left the slot ready for "a video that does much
of the talking". The film tells the site's own loop in pictures: scan a card, see
it in the collection, plan a deck with Deck-E, playtest, tune, build, and win at
league night. Every screen in it is a real DeckPal screen composited in, not drawn by
a model, so it shows what the app really looks like and does.

**Implications:**
- Same origin, so the CSP's `media-src 'self' blob:` is unchanged (no B9 change).
- The service worker still does not precache video (vite.config.ts precaches
  js/css/html/woff2/svg/png only), so only visitors who reach the home page pay
  for it, and only after first paint.
- The poster is heavier than the old photograph: 1600w AVIF 93 KB (was 67 KB),
  960w AVIF 29 KB (was 32 KB). On a phone the LCP is the headline, so the phone
  path is unchanged; on desktop the poster is the LCP candidate and grew by about
  26 KB.
- `tests/browser/landing.mjs` now allows media requests once a film is configured,
  but only for the configured same-origin files, and checks the film plays muted.
- A 1:1 cut exists (made for phones and ads) but is not shipped: the slot is 16:9
  by the 2026-11-27 decision. Using it would need `media`-matched sources and a
  phone-only aspect ratio in `HeroVideo`.
- Provenance (models, what was composited, card art) is in
  `public/marketing/landing/CREDITS.md`. The film's prompts, takes, music and build
  scripts live in the owner's separate `deckpal-marketing` workspace, not in this repo.
