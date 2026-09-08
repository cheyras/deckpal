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
