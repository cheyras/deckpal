---
date: "2026-11-27"
title: "Homepage redesign: show more than tell, detail moves to /features"
decided_by: "Chey (owner brief); built by Claude Opus 5.5"
areas: ["frontend"]
supersedes: []
---
## 2026-11-27 — Homepage redesign: show more than tell, detail moves to /features
**Decided by:** Chey (owner brief, with TypoTab and Mumble as references); built by Claude Opus 5.5

**Decision:** The marketing home page (`/`) tells the whole story in a few big,
friendly lines and lets the product show itself. In order: a hero (one line, one
sub line, one Start free button) with a 16:9 hero video slot right under it,
visible above the fold on phone and desktop; "How it works" as a timeline (dashed
line, round badges, a bold word and one line per step); four short beats (Plan,
Playtest, Tune, Build), each a headline, two or three lines and a small looping
mock with real card art; a card orbit of real card art around the live catalog
count; the AI apps it works with; three one-line promises (pay what you want,
private, open source); the FAQ; the closing band. No eyebrow labels on the home.

Everything the old page said at length moved, intact, to a new public page,
`/features`: the loop diagram, the four stage deep dives with their working demos,
the example conversation, "Ask it anything", "Give it a job", "And more" and the
open-source facts. The AI-app comparison chart stays where its full version
already was, `/connect` (the home links to `/connect#compat`); the landing's
at-a-glance copy of it and its connect steps were retired rather than duplicated.

`/features` is wired like `/connect`: lazy route, chrome-free and public
(`lib/landingRoute.ts`), cloud-only, prerendered to `features.html` for crawlers,
rewritten by `middleware.ts`, excluded from the precache, listed in
`sitemap-pages.xml` and llms.txt.

The hero film is not in this change. `landing/heroVideo.ts` is the one place to
point at it; while `sources` is empty the slot is its poster and requests no
media.

**Why:** The owner found the old home "an overwhelm of information" (16,300 px tall
on a phone) and asked for TypoTab's personality: big friendly type, sections that
animate in, very little copy that still tells the whole story, a video that does
much of the talking, and an orbit of real Pokémon cards in place of app icons.
The second reference (Mumble) added: model the loop on a vertical timeline, tilt
small things, keep blocks to two or three lines, show looping UI instead of
explaining, be "less techie" (few eyebrows, chips or mono labels), and keep
DeckPal's own palette. Detail was to move to pages you click into, not vanish.

**Implications:**
- Type is Fraunces at weight 800 with `SOFT` 100, the app's own display face
  (already loaded in full by theme.css), so the friendlier look costs no bytes.
- Motion uses the #410 tokens, moves only transform and opacity, and runs only on
  screen: the orbit rings are CSS animations paused by `data-play`
  (`usePlayWhenVisible`), the mocks are `useStepLoop` timelines that stamp
  `data-sN` attributes without re-rendering React. Reduced motion stops the orbit
  and sparkles and shows every mock's finished frame.
- The landing prerender preloads the hero poster (its phone LCP). Measured on
  Lighthouse's mobile profile (Slow 4G, 4x CPU, 412x823), median of 7, local
  production build: before LCP 3.07 s, FCP 2.32 s, TBT 327 ms, CLS 0, 946 kB;
  after LCP 3.10 s, FCP 2.50 s, TBT 180 ms, CLS 0, 742 kB. Without the preload
  the after LCP was 3.31 s and FCP 2.32 s; LCP was preferred. The Landing chunk
  went from 9.6 kB to 4.2 kB gzipped; the critical path is unchanged (budget 230 kB).
- `landingCopy.test.ts` now holds the home to a 450-word story (FAQ aside) and
  checks /features carries every deep dive the old page had. The simulator caveat
  stays on the home page itself (owner ruling 2026-10-12). `tests/browser/landing.mjs`
  checks both pages signed out at 390 and 1440 (axe, no sideways scroll, video slot
  16:9 above the fold, no media while no film, orbit paused off screen, reduced motion).
- A film hosted anywhere but this origin would be blocked by the CSP's
  `media-src 'self' blob:`; changing that is the maintainer's call (B9).
