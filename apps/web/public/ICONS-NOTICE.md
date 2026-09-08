# Brand artwork provenance

Three pieces of artwork, three pipelines: the logomark, the app icon, the
favicon. Only the icon and the favicon are rendered from a source by a script;
the logomark ships as the vector it was drawn as.

## The logomark

`logo/` holds the DeckPal logomark, supplied by the project owner as vector on
2026-09-07 and committed **byte-for-byte as exported** — there is no generator
for these and nothing downsamples or re-exports them:

| File | Lockup | viewBox |
|---|---|---|
| `logo/deckpal-logo-white.svg` | full wordmark, light-on-dark | `0 0 450.12 94.11` |
| `logo/deckpal-logo-dark.svg` | full wordmark, dark-on-light | `0 0 450.12 94.11` |
| `logo/deckpal-d-white.svg` | D monogram, light-on-dark | `0 0 96.85 89.92` |
| `logo/deckpal-d-dark.svg` | D monogram, dark-on-light | `0 0 96.85 89.92` |

**These live here rather than in `assets/brand/` on purpose.** That directory
holds *sources a script renders into this one*. Vector has no render step, so a
copy in both places would be the same bytes twice with nothing checking they
stayed equal. One copy, in the place the app serves it from.

**Not to be confused with `brand/`**, one level over, which is the opposite
thing: *other people's* trademarks, used under their brand guidelines. This
directory is DeckPal's own mark.

**The app ships the white pair only**, because it is dark-only (`theme.css`:
`deckpalDark` is the only scheme). The dark-on-light pair is here for the
README's light mode and for any light surface a later theme introduces, and is
excluded from the service worker's precache in `apps/web/vite.config.ts` so
nobody downloads a mark this build never draws.

Rendered by `<BrandLogo>` and `<BrandD>` in `src/components/Icon.tsx`, as
`<img>` rather than inline SVG — each file carries its own `<style>` block
written against generic `.cls-N` selectors and `linear-gradient` gradient ids,
which would collide document-wide the moment two of them shared a page. The
same white wordmark is drawn into the link-preview card by
`scripts/gen-og-image.mjs`, so the social card and the app cannot disagree
about the mark.

Replacing the artwork means replacing these files from a new export. Do not
recolour or restretch one variant to stand in for another — take the variant
from the source.

## The app icon and favicon

Replaced 2026-08-15. Two pieces of artwork, two pipelines.

## The app icon

`brand-icon.png`, `apple-touch-icon.png`, `pwa-192.png`,
`pwa-512.png`, `pwa-maskable-192.png`, `pwa-maskable-512.png` and the MCP
connector icon (`apps/mcp/assets/icon-{128,512}.png`) are all rendered from one
source supplied by the project owner:

    assets/brand/deckpal-app-icon.jpg   (1080×1080)

Regenerate with `node scripts/gen-app-icons.mjs`. It cuts two crops of that
source, because the two icon classes are masked differently:

- **tight** — apple-touch, brand mark, `any` PWA icons. Shown as-is or under a
  gentle squircle, so the crop is pulled in to keep the face legible small.
  `brand-icon.png` stopped being the top-bar mark on 2026-09-07, when the
  logomark above took over app chrome; it is still the favicon's sibling at
  128px and the icon half of the link-preview card, so the crop and the
  generator are unchanged.
- **full frame** — the `maskable` PWA icons. Android crops these to a circle
  inscribed in the central 80%; the full frame keeps the face inside that
  circle, the tight crop does not.

`apple-touch-icon.png` is written opaque on purpose: iOS composites a home
screen icon over black, so alpha corners would go dark.

## The favicon

`favicon-32.png` and `favicon.ico` are **not** downscales of the render. At 32px
a photographic render spends its pixels on gradients and the face turns to mush,
so the favicon is drawn as actual pixel art for its own 1024-pixel budget:

    assets/brand/favicon-32.txt   — 32 lines × 32 characters, one char per pixel

Regenerate with `node scripts/gen-favicon.mjs` (add `--preview` for a zoomed
sheet). To change the artwork, edit the `.txt` directly.

Every character maps to a **canonical Tailwind colour**, resolved at render time
from the installed `tailwindcss/theme.css` (`scripts/lib/tailwind-palette.mjs`
converts v4's `oklch()` values to sRGB). A colour outside the Tailwind palette
cannot appear in the icon, and a typo in the legend fails the build rather than
shipping an off-palette pixel. The background is genuinely transparent.

`favicon.ico` bundles 16 and 32 only. 48 is deliberately absent: scaling a 32px
grid by 1.5 puts pixel edges on half-pixels, which is what makes resized pixel
art look broken. `index.html` declares the sizes the file actually contains.

## Licensing and marks

Both sources were supplied or produced for this project and are licensed with
the repository (AGPL-3.0-only); the project owner is the authority on the
render's origin. The mascot is an original character.

This project is unofficial and is not affiliated with, endorsed, or sponsored by
Nintendo, Creatures Inc., GAME FREAK or The Pokémon Company. Note that the cards
depicted in `deckpal-app-icon.jpg` show invented creatures but are laid out in a
frame that follows trading-card convention closely; if that ever needs to read as
unambiguously generic, the cards are the part to redraw. The favicon's cards are
plain untitled rectangles.
