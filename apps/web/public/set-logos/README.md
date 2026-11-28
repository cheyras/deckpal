# Template set logos

`<setId>.webp` — DeckPal's own logo for each set that has **no official logo of its own**: promo
pools, energy sets, subsets, trainer kits, McDonald's collections and one-off packs. 59 files,
owner-approved on 2026-11-27 (see
`decisions/2026/2026-11-27-template-set-logos-ship-and-become-the-standard-for-sets-without-an-official-log.md`).

## Where the bytes come from

Every file is a build output of `tools/set-logo-templates/` and nothing else. Do not edit one by
hand: change the template or the set's row and rebuild, or the next build silently undoes it.

1. **Inputs**, fetched only from the app's own image tier and pinned by SHA-256 in
   `tools/set-logo-templates/sources/tier-sources.json`:
   - set logos (`/deckpal/images/sets/<id>/logo.webp`), whose upstream is TCGdex or the approved
     pokemontcg.io crosswalk;
   - official Pokémon artwork for the trainer-kit plates (`/deckpal/images/sprites/art/<id>.png`,
     the pinned `PokeAPI/sprites` commit);
   - the Black Star PROMO mark, derived from `svp`'s tier logo.
2. **DeckPal's own drawing:** ribbons, plates, banners, lettering (Bahnschrift), strokes and shadows
   in the four PhotoCraft templates. The energy rows in `mee` and `sve` are DeckPal-drawn coins
   around E2's traced energy glyphs, not the CC0 originals `EnergyIcon` draws.
3. **Composited** by PhotoCraft (`photocraft-cli`, one data set per set), trimmed to the ink with a
   6 px margin, fitted inside 870x396 px without upscaling, and encoded as WebP (q88 colour,
   lossless alpha) by `tools/set-logo-templates/build/ship.py`.

So each file contains other parties' marks (set logos, the PROMO mark, Pokémon artwork) composed
with DeckPal's own artwork, which is why they are here and not in `../brand/` (whose rule is that
nothing in it is drawn by this project). McDonald's collections are plain type over a TCG wordmark,
never the Golden Arches or any McDonald's artwork (2026-08-10).

## How the app uses them

`TEMPLATE_SET_LOGOS` in `apps/web/src/lib/releasedSetAssets.ts` maps set ids to these paths, and
`SetLogo` draws one instead of the image tier only when the API's `logoUrl` for the set is null or
is the placeholder the template replaces. A set's own official logo, once upstream has one, always
wins.

Each file needs both ignore-file exceptions (`!apps/web/public/set-logos/*.webp` in `.gitignore`
and `.vercelignore`), and `apps/web/scripts/check-precache.mjs` fails the build if one named in
`releasedSetAssets.ts` is missing from `dist/`. They are not precached; the service worker caches
the ones a visitor sees (`deckpal-set-logos-v1`).
