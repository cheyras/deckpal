---
date: "2026-09-07"
title: "The logomark replaces the icon-plus-typeset-name lockup"
decided_by: "owner, supplying the artwork."
areas: ["images","catalog"]
supersedes: []
---
## 2026-09-07 — The logomark replaces the icon-plus-typeset-name lockup
**Decided by:** owner, supplying the artwork.

**Decision:** Everywhere the app introduced itself by name, it now draws the
DeckPal logomark. The owner supplied four SVGs — full wordmark and D monogram,
each light-on-dark and dark-on-light — and they ship in
`apps/web/public/logo/` byte-for-byte as exported, with no generator and no
re-export. `<BrandLogo>` and `<BrandD>` in `components/Icon.tsx` replace
`<BrandMark>`, and five sites change:

| Site | Was | Is |
|---|---|---|
| Sidebar header, expanded | app icon + "DeckPal" in live text | full wordmark |
| Sidebar header, collapsed | app icon | D monogram |
| Mobile top bar | app icon + live text | full wordmark |
| `/auth` | app icon + live text | full wordmark |
| Landing nav and footer | app icon + live text | full wordmark |

The white pair is what the app renders — it is dark-only, `deckpalDark` is the
only scheme. The dark-on-light pair ships for the README's light mode and is
excluded from the service worker precache (`vite.config.ts`), so nobody
downloads a mark this build never draws.

**Why the app icon leaves app chrome:** it was doing two jobs. As a favicon and
a PWA icon it is a 128–512px square that has to survive being 16px in a tab; as
the top-bar mark it was competing with the name sitting next to it for the same
job of saying which app this is. The logomark does that job alone, so the icon
keeps the one it is shaped for. `brand-icon.png`, its source and
`gen-app-icons.mjs` are all unchanged — the icon is still the favicon, the PWA
icon, the apple-touch icon and the left half of the link-preview card.

**`<img>`, not inline SVG.** Each of the four files carries its own `<style>`
block written against generic `.cls-N` selectors and gradients with ids like
`linear-gradient-2`. Inline SVG puts both in the host document's scope, so any
two of them on one page would silently repaint each other — and the wordmark
and the D do share a page while the sidebar animates between states. An `<img>`
is its own document. The cost is that the mark cannot inherit `currentColor`,
which is what the White/Dark pair is for.

**`public/logo/`, not `assets/brand/`, and not `public/brand/`.**
`assets/brand/` holds sources a script renders into `public/`; vector has no
render step, so a copy in both places would be the same bytes twice with
nothing checking they stayed equal. `public/brand/` is the opposite thing —
its README states it holds *other people's* trademarks under their brand
guidelines. DeckPal's own mark gets its own directory. Provenance is recorded
in `apps/web/public/ICONS-NOTICE.md`, which is now about brand artwork
generally rather than the icon alone.

**`.brand-wordmark` is deleted**, from both `theme.css` and `premium.css`. It
was Figtree 900 skewed −6° with a four-stop cyan gradient clipped to the
glyphs, and it had exactly one purpose: to typeset "DeckPal" beside the icon.
The name is drawn now, so the rule had no remaining caller. Git history has it
if a later light surface wants the treatment back.

**The link-preview card follows, and its stated rationale inverts.** The
2026-08-16 entry above explains that `scripts/gen-og-image.mjs` renders in a
browser *because the wordmark is not a picture*. It is one now, and the card
draws the same `logo/deckpal-logo-white.svg` the app's chrome does, so the
social card and the app cannot disagree about the mark. The script still
renders in a browser for everything else on the card — the pitch's display
face, the pill, every colour — so a brand-colour change still carries through
on the next run. Its static server needed `.svg` added to its MIME map, or the
card screenshots a broken image. Regenerated and verified.

**Implications:** Replacing the artwork means replacing these four files from a
new export; do not recolour or restretch one variant to stand in for another.
A future light theme needs `BrandLogo`/`BrandD` taught to pick the Dark pair,
and the precache exclusion above dropped in the same change.

**Verified:** desktop (1440) and 390px, signed out and signed in as the QA
account, across the expanded sidebar, the collapsed sidebar, the mobile top
bar, `/auth` and the landing nav and footer. No horizontal overflow at 390 with
the full signed-in header (burger, mark, search, scan, bug). Typecheck clean,
`deckpal-web` build clean, `check-precache` clean.

