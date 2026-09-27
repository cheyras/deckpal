---
date: "2026-08-10"
title: "public marketing landing at `/` for logged-out visitors"
decided_by: "Not recorded"
areas: ["general"]
supersedes: []
---
## 2026-08-10 — public marketing landing at `/` for logged-out visitors
**What:** `/` used to `throw redirect({ to: '/series' })` unconditionally. It now
resolves three ways: self-host (no `VITE_SUPABASE_URL`) still redirects straight
into the app; cloud + a persisted Supabase session still redirects to `/series`;
cloud + no session renders the new `Landing` route (`apps/web/src/routes/Landing.tsx`
plus `routes/landing/{Mockups.tsx,landing.css}`).

**Decision:** put the session probe in `beforeLoad` (async, `supabase.auth.getSession()`
reads localStorage) rather than rendering the landing and redirecting from an effect —
a signed-in user must never see a flash of marketing on their own homepage. Self-host
keeps the old behaviour deliberately: it has no signup flow, so a "Create your free
account" CTA there would be a dead end.

**401-storm guard:** the landing is added to BOTH public-path lists — `RootComponent`'s
(so `AuthGuard` does not bounce a logged-out visitor to `/auth`) and `AppShell`'s (so
the sidebar/ProfileChip never mount). That is the same trap `/auth` fell into on
2026-08-01: ProfileChip's overview query 401s → `handle401` → `location.assign('/auth')`
→ reload → loop. Verified with Playwright: a logged-out load of `/` issues **zero**
`/api/*` requests. The shared predicate lives in `apps/web/src/lib/landingRoute.ts`
so the two call sites cannot drift.

**Mockups, not screenshots:** the five product illustrations are DOM/CSS/SVG built from
the design tokens and the app's own idioms (LevelRing's arc, ProgressCluster's two-bar
stack, CardImage's 245:337 box, ValueChart's gradient-under-line, the real `EnergyIcon`).
No Pokémon card art, character names or Poké Ball/wordmark — card tiles are abstract
accent-gradient placeholders. Set names are factual and nominative, with a trademark
disclaimer in the footer. Screenshots would have gone stale and would have leaked the
owner's real collection data.

**Motion:** one IntersectionObserver stamping `data-revealed`, everything else CSS
transitions (opacity/transform/stroke-dashoffset/width/grid-template-rows only — no
property that can shift layout). `prefers-reduced-motion` hard-resets all of it to the
finished state, including the pre-reveal `opacity: 0`, so a reduced-motion visitor can
never land on a blank page if the observer never fires. No animation dependency added.

**Imagery:** the parallel imagery lane was blocked on a Vercel billing precondition, so
this shipped with **no image bytes**. `MarketingImage` unmounts itself on load error, and
every slot it sits in is a finished token gradient/mesh on its own — the page has no empty
reserved boxes and no broken-image glyphs. The `<picture>` markup follows the agreed
contract (`/marketing/hero-bg-{960,1600,2560}.{avif,webp}`, three `accent-*-{400,800}`,
`texture-grid-800`, `og-image-1200.jpg`) so the art lights up with no code change.

**Also:** `/auth` gained `?mode=signup` (`validateSearch`) so the landing CTA opens the
Sign Up tab, and `apps/web/index.html` gained title/description/canonical/OG/Twitter/
JSON-LD. The app sets no runtime `document.title`, so those statics serve both surfaces.

