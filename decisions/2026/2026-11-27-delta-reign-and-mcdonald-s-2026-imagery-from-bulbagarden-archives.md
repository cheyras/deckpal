---
date: "2026-11-27"
title: "Delta Reign and McDonald's 2026 imagery from Bulbagarden Archives"
decided_by: "PENDING @cheyras's per-file acceptance; prepared by Claude Opus 5.5"
areas: ["images","catalog"]
supersedes: []
---
## 2026-11-27 — Delta Reign and McDonald's 2026 imagery from Bulbagarden Archives
**Decided by:** PENDING @cheyras's per-file acceptance; prepared by Claude Opus 5.5

> **HOLD — do not merge until the owner has said yes to these three files, and
> his words are recorded below** (the 2026-09-03 process note: consent lives
> with whoever heard it; an agent's task prompt is not the owner's yes).
>
> **Owner's words:** _(to be filled in by the session that asks him)_

**Decision:** Three Bulbagarden Archives files join the set-image crosswalk
(`packages/storage/src/setImageFallback.ts`):

| Pair | File | Verified 2026-11-27 |
|---|---|---|
| `me06` logo | `File:ME6 Logo EN.png`, served at MediaWiki's 800px rendition `…/thumb/e/e9/ME6_Logo_EN.png/800px-ME6_Logo_EN.png` | 200 `image/png`, PNG magic, 800×383, 445,714 B, no redirect. Original 1920×919, sha1 `015fc7c10415d5dd7c9674d12ebe682db3c5608a` (matches the wiki's record). Looked at: the "Mega Evolution / Delta Reign" logo, reads on dark and light. |
| `me06` symbol | `File:SetSymbolDelta Reign.png` | 200 `image/png`, PNG magic, 47×27, 651 B, sha1 `5ae99b4f…`. Looked at: the printed "DLR" set-code box. |
| `2026me` symbol | `File:SetSymbolMcDonalds Collection 2026.png` | 200 `image/png`, PNG magic, 150×83, 17,755 B. Looked at: the "M26 EN" box; soft (upscaled upstream), legible at tile size. |

**Why:** Delta Reign (`me06`, released 2026-11-06) shows no logo or symbol;
the owner noticed it first on 2026-11-27 ("We need to find it."). No approved
source has it:

- **TCGdex** (primary): the set API returns no `logo`/`symbol` field for
  `me06` in en, fr, es, it, pt or de (ja, ko, zh-tw, zh-cn, id, th do not have
  the set). The asset CDN 404s for `{lang}/me/me06/logo.{webp,png,jpg}` in every
  language and for `univ/me/me06/symbol.{webp,png,jpg}`. The set's source file
  in tcgdex/cards-database carries no imagery fields; TCGdex simply has not
  uploaded the assets yet.
- **pokemontcg.io** (approved fallback): `images.pokemontcg.io/me6/logo.png`
  and `/symbol.png` 404 (so do `me5`'s — sets from that point on are hosted on
  a successor CDN that is not approved), and `api.pokemontcg.io` answered
  500/502 on every attempt.
- **Bulbagarden Archives** has both, under its usual
  `{{i-Fairuse-tcg-noncard}}` tag. Bulbagarden files have entered this table only
  as per-file owner acceptances — 2026-08-29 ("not a precedent for the slot")
  and 2026-09-03 — and the table is frozen to the owner's approval, so this is
  that acceptance, asked for these three files only.

McDonald's Collection 2026 is included because it is the same question about
the same source on the same day: the McDonald's *symbols* are the class the
owner already accepted (2026-08-29); its *logo* stays excluded under the
2026-08-10 trademark ruling, and a test pins that.

**Implications:**

- Needs `fix/set-logo-audit` (the API reports a crosswalk URL as the set's
  `logoUrl` / `symbolUrl`). Without it the API reports `card_set.logo_url`,
  which is NULL for `me06`, and the series row and set header never ask for
  the logo.
- The fill is the deployed image tier's own lazy fill after deploy (or
  `pnpm --filter deckpal-images warm:cloud -- --assets sets`); provenance is
  `fromUrl(<URL actually fetched>)` through `putStorageAsset`, as for every
  crosswalk row.
- The 800px rendition is used instead of the 1.59 MB original because the tier
  stores set imagery as fetched; 446 KB is in line with the largest logos
  already served (e.g. `sve`, 438 KB).
- When TCGdex publishes Delta Reign's assets, the next catalog refresh fills
  `card_set.logo_url`/`symbol_url`, which wins over these rows. Only the
  already-stored object would still be Bulbagarden's until it is refreshed.
- The remedy if Bulbagarden's posture is ever challenged is removing these
  three rows and their objects, as for the earlier files.
