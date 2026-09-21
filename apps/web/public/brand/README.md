# Third-party brand marks

Assets in this directory are **other people's trademarks**, used under their own
brand guidelines. Nothing here is drawn, traced or approximated by this project
— the same rule `src/components/ENERGY-ICONS-NOTICE.md` states for energy
symbols. A redrawn logo is still the logo, only worse.

## `powered-by-stripe.svg`

Stripe's official "Powered by Stripe" badge, **white variant**, shipped
byte-for-byte as Stripe distributes it.

| | |
|---|---|
| Source | Stripe's brand assets page, <https://stripe.com/newsroom/brand-assets> → *Powered by Stripe badges* |
| Archive | `Powered_by_Stripe-badge.zip` from `assets.stripeassets.com` |
| Variant | `Powered by Stripe - white.svg` (the kit also ships `black` and `blurple`) |
| Added | 2026-09-05 |
| Size | 3,595 bytes, `viewBox="0 0 150 34"` |

**White, because the app is dark.** The badge is an outlined pill and the
outline has to read against `--color-surface-secondary`; the black variant
disappears on it and the blurple one fights the cyan accent.

Rendered by `src/components/billing/StripeTrust.tsx` (`PoweredByStripe`), which
falls back to the words set in DeckPal's own type if this file is ever missing —
so removing it degrades the surface rather than breaking it.

### Rules that come with using it

These are conditions of the licence to display the mark, not preferences:

- **Ship it unmodified.** Do not recolour it, restretch it, crop it, add
  effects, or re-export it through an optimiser that rewrites the paths. If it
  needs to be a different colour, take a different variant from the kit.
- **Respect the clear space.** Keep a margin around it of at least the height of
  the badge's own outline radius; do not crowd it against other logos or text.
- **Do not imply endorsement.** It says who processes the payment. It must not
  be placed so as to read as Stripe recommending, partnering with, or vouching
  for DeckPal.
- **Only where it is true.** It belongs on surfaces where Stripe genuinely
  handles the payment. It is not a general-purpose trust badge.

If Stripe refreshes the kit, replace the file from the same source rather than
editing this one.

## `pokemon-30th-celebration-logo.webp`

The English set logo for **30th Celebration**, the Pokémon 30th anniversary
expansion (Mega Evolution series, street date 2026-09-16).

| | |
|---|---|
| Source | Bulbagarden Archives, [`File:30th Celebration Logo EN.png`](https://archives.bulbagarden.net/wiki/File:30th_Celebration_Logo_EN.png) |
| Original | `30th_Celebration_Logo_EN.png`, 2173×1200 PNG, 784,949 bytes |
| Shipped | 448×247 WebP, 19,292 bytes — resized with `sharp` (q88), nothing else |
| Added | 2026-09-11 |

**Why this file is here and not in the image tier.** Both `30th` and `30th-c`
released 2026-09-16. TCGdex publishes both sets (`30th`, 158 cards; `30th-c`,
30 cards) with `logo: null` and `symbol: null` — neither the object tier nor the
image tier returns art for these paths. The asset is now a permanent bundled
fallback, not an upcoming placeholder. `SetLogo` checks `bundledSetLogo(setId)`
from `apps/web/src/lib/releasedSetAssets.ts` after the image-tier sources are
exhausted; `BUNDLED_SET_LOGOS` maps both `'30th'` and `'30th-c'` to
`'/brand/pokemon-30th-celebration-logo.webp'`. When the image tier is eventually
populated by upstream, it wins and this fallback is silently bypassed — stale
`BUNDLED_SET_LOGOS` entries are harmless.

**Bulbagarden Archives is an already-approved source for set imagery**, not a
new one: `SET_IMAGE_FALLBACK_TABLE` in `@deckpal/storage` sources the `mfb` logo
and nine set symbols from it under the owner's 2026-08-29 approval. That table
is deliberately NOT touched here — it is frozen. The approval for this specific
asset (`File:30th_Celebration_Logo_EN.png`) extends to both set entries in
`BUNDLED_SET_LOGOS`; it does NOT extend to any other asset, CDN, or source.

**Deployment inclusion.** This WebP needs the exact
`!apps/web/public/brand/pokemon-30th-celebration-logo.webp` exception in both
`.gitignore` and `.vercelignore`. The first keeps it in Git; the second keeps it
in Vercel's upload. A successful local build alone does not prove both.

Keep the metadata path local (`/brand/pokemon-30th-celebration-logo.webp`).
`SetLogo` prefixes it with `import.meta.env.BASE_URL` so the same asset loads
at cloud `/` and self-host `/deckpal/`.
