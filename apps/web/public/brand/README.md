# Third-party brand marks

Assets in this directory are **other people's trademarks**, used under their own
brand guidelines. Nothing here is drawn, traced or approximated by this project
— the same rule `src/components/ENERGY-ICONS-NOTICE.md` states for energy
symbols. A redrawn logo is still the logo, only worse.

## `powered-by-stripe.svg` — NOT YET ADDED

`components/billing/StripeTrust.tsx` renders this file as the "Powered by
Stripe" badge on the support prompt. While it is absent the component falls back
to the words set in DeckPal's own type, so the page is never broken — it is just
missing the mark.

To add it:

1. Go to <https://stripe.com/newsroom/brand-assets> (Stripe's official brand
   assets page) and download the **"Powered by Stripe"** badge, SVG, in the
   variant that reads on a dark background.
2. Save it here as exactly `powered-by-stripe.svg`.
3. That is all — nothing to import, nothing to register. The component picks it
   up on the next build.

Keep the file as Stripe ships it. Do not recolour it, stretch it, add effects,
or set it against a background that breaks the clear-space rules in Stripe's
guidelines; those are conditions of the licence to use the mark at all.
