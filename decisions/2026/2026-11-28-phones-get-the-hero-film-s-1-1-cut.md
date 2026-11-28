---
date: "2026-11-28"
title: "Phones get the hero film's 1:1 cut"
decided_by: "Chey (owner: 1:1 for the mobile hero); built by Claude Opus 5.5"
areas: ["frontend"]
supersedes: []
---
## 2026-11-28 — Phones get the hero film's 1:1 cut
**Decided by:** Chey (the owner chose 1:1 for the mobile hero); built by Claude Opus 5.5

**Decision:** Below 640px wide (`HERO_PHONE_MEDIA` in `landing/heroVideo.ts`), the home
page's hero video slot turns square. It plays the film's 1:1 cut instead:
- `hero-square.webm` (VP9, about 3.0 MB) first, then `hero-square.mp4` (H.264 High,
  `+faststart`, about 3.8 MB), both 1080x1080, 24 fps and silent;
- with the square poster `hero-square-*` (AVIF/WebP at 1080/720/480), which is the cut's
  own first frame.

Wider viewports, including a phone turned sideways, keep the 16:9 cut from the decision of the
same date. `home.css` repeats the breakpoint for the box's `aspect-ratio`.

**Why:** On a portrait phone a 16:9 film is a short strip, about 190px tall at 390px wide.
The 1:1 cut fills the column (about 350px) and was reframed shot by shot for that shape, so
the phone screens and the card slam read at phone size. The slot still sits above the fold
at 390x844.

**Implications:**
- **Each viewport fetches only its own files.**
  - The poster is art-directed: the `<picture>` gets `media`-matched square sources first,
    through `Photo`'s new `art` prop.
  - The prerender's poster preload is now two hints, split by `media`.
  - The film's sources are picked in JS when the film is attached (after load and idle),
    and a `matchMedia` listener swaps the cut if the viewport crosses the breakpoint.
- **The phone LCP is unchanged.** On a phone the LCP is still the headline. The square
  poster fetched there is 720w or 1080w AVIF (about 69 KB or 142 KB at DPR 2 to 3), against
  the 16:9 still it replaces (960w or 1600w, about 29 KB or 93 KB).
- **`tests/browser/landing.mjs`** now checks:
  - the slot is 1:1 at 390 and 16:9 at 1440;
  - the poster `<img>` shows the right still;
  - only that viewport's poster family is requested;
  - only that viewport's film files are requested;
  - the film plays muted.
- **Infrastructure:** no CSP, Vercel or service-worker change. The files are same-origin,
  and video is still not precached.
