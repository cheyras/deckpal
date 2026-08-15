# App icon provenance

Replaced 2026-08-15. Two pieces of artwork, two pipelines.

## The app icon

`brand-icon.png` (the top-bar mark), `apple-touch-icon.png`, `pwa-192.png`,
`pwa-512.png`, `pwa-maskable-192.png`, `pwa-maskable-512.png` and the MCP
connector icon (`apps/mcp/assets/icon-{128,512}.png`) are all rendered from one
source supplied by the project owner:

    assets/brand/deckpal-app-icon.jpg   (1080×1080)

Regenerate with `node scripts/gen-app-icons.mjs`. It cuts two crops of that
source, because the two icon classes are masked differently:

- **tight** — apple-touch, brand mark, `any` PWA icons. Shown as-is or under a
  gentle squircle, so the crop is pulled in to keep the face legible small.
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
