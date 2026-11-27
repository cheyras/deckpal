---
date: "2026-11-27"
title: "Set chrome reports the approved crosswalk; 15 approved logos were hidden by a catalog-column gate"
decided_by: "Claude Opus 5.5 on behalf of @cheyras (2026-11-27 feedback pass, workstream F); @cheyras reviews before merge"
areas: ["images","frontend","catalog"]
supersedes: []
---
## 2026-11-27 — Set chrome reports the approved crosswalk; 15 approved logos were hidden by a catalog-column gate
**Decided by:** Claude Opus 5.5 on behalf of @cheyras (2026-11-27 feedback pass, workstream F); @cheyras reviews before merge

**Decision:** The API's set chrome (`logoUrl` / `symbolUrl` on
`GET /series/:slug`, `GET /sets/:setId` and `GET /cards/:id`) now reports the
catalog column, else the approved set-image crosswalk entry
(`setChromeUrl` in `apps/api/src/images/setChrome.ts`) — the same order the
image tier resolves in. The SPA's gate (`set.logoUrl || bundledSetLogo(...)` in
the series row and set header) is unchanged and now sees those logos.

**Why:** The owner reported Crown Zenith Galarian Gallery, Silver Tempest and
Lost Origin Trainer Gallery with no logo. An audit of all 203 catalog sets
against the live image tier (every `/deckpal/images/sets/<id>/{logo,symbol}.webp`
probed, every served object downloaded and measured) and against the rendered
series pages found that **15 sets have an approved logo the image tier serves,
which the app never displays**: `sv05` Temporal Forces, `sm3.5` Shining Legends,
`sm7.5` Dragon Majesty, `mfb` My First Battle, `bog`, `svp`, `sve`, `cel25cc`,
`swsh4.5sv`, `sma`, `swsh12.5gg`, `swsh12tg`, `swsh11tg`, `swsh10tg` and
`swsh9tg`. All 15 are in the owner-approved crosswalk, and `card_set.logo_url`
is NULL for every one of them — which is the definition of a crosswalk entry.
The SPA only asks for a logo when `logoUrl` is non-null, so it rendered the name
for exactly the sets the crosswalk exists to fill. The tier's `curl → 302` check
passed the whole time; only the rendered page showed the gap.

**Why not "attempt the logo for every set" (what `SetSymbolTile` does).** It was
the first version of this fix, and CI's Deck-E scroll test caught the cost: the
symbol tile is a fixed-size box, the logo slot is not. In the set header a
logo-less set's failed image is swapped for its name a couple of round trips
later, the header row reflows on a phone, and the page jumps under the reader.
Every logo-less set (about 40 — Trainer Kits, McDonald's, promo pools) would also
spend two failing requests per view. The server already knows which sets the
tier can source, so it says so, and the client never asks for what does not
exist.

**Implications:**

- `logoUrl` / `symbolUrl` keep their documented meaning — the upstream URL the
  set's image is filled from — but can now be a pokemontcg.io or Bulbagarden
  URL as well as TCGdex. Clients still load set imagery from
  `/deckpal/images/sets/<id>/…`, never from these URLs. `API.md` says so.
- Not self-healing for an image that only a recorded manifest source knows
  (none today; the 30th Celebration pair is covered by `bundledSetLogo`). A new
  source for a set goes in the crosswalk, and the API reports it from then on.
- `/api/series`' representative-set choice (`repHasLogo`) still reads the
  catalog column in SQL; no series is affected today.
- Subset rows now show their parent's wordmark (the approved crosswalk files for
  `swsh12.5gg`, `swsh*tg`, `cel25cc`, `swsh4.5sv`, `sma` are the parent's logo,
  as the 2026-08-29 decision recorded for their symbols). `bog` and `sve` show
  the generic Pokémon TCG wordmark and `svp` the generic PROMO star, which is
  what their approved entries are. The owner asked (same feedback pass, E1) for
  per-family templates — subset-of-parent, promo stack, energy row — and those
  are being drafted for review separately; when approved they replace these.
- **Delta Reign (`me06`) is NOT fixed by this change, and why is recorded
  here.** Its `card_set.logo_url` and `symbol_url` are NULL. TCGdex has no logo
  or symbol for it in any language (set API: no `logo`/`symbol` field for en,
  fr, es, it, pt, de; asset CDN 404 for `logo.{webp,png,jpg}` in every language
  and for `univ/me/me06/symbol.*`). The approved fallback, pokemontcg.io, 404s
  at `images.pokemontcg.io/me6/{logo,symbol}.png` (as it does for `me5` — newer
  sets moved to a CDN that is not approved) and its API answered 500/502 all
  session. Bulbagarden Archives has both: `File:ME6 Logo EN.png` (1920×919,
  sha1 `015fc7c1…`, the real "Mega Evolution / Delta Reign" logo) and
  `File:SetSymbolDelta Reign.png` (47×27, the printed DLR mark), under the
  wiki's fair-use tag. Bulbagarden files have only ever entered the crosswalk
  as per-file owner acceptances ("not a precedent for the slot", 2026-08-29;
  2026-09-03), and the crosswalk is frozen to the owner's approval, so these
  two are put to the owner as a scoped question rather than added here. The
  same applies to `File:SetSymbolMcDonalds Collection 2026.png` for `2026me`'s
  symbol. If they are accepted, this change is what makes them show.
- Residue after this change (renders the name / derived tag, by design or for
  want of a source): logos for `me06`, `mee`, `mep`, `miscp`, `exu`, `ex5.5`,
  `xya`, the 13 McDonald's Collection sets (trademark ruling, 2026-08-10) and
  the 20 Trainer Kits (2026-08-29 ruling); symbols for `me06`, `2026me`,
  `30th-c`, `mfb`, `miscp`.
