# DEX-DATA.md — Pokédex capture mechanic & Trainer Level: data sourcing

**Author:** research subagent · **Date of all measurements:** 2026-07-24
**Scope:** where the species list, the sprites, and the TCG-card → National-Dex-number mapping come from, and what the data model must store to support "capture", "shiny" and Trainer Level.
**Out of scope (owned by other work-streams):** pkmn.gg's help-center/UI semantics for levelling, TCGdex self-hosting/Docker viability, card image caching, pricing.

---

## 0. Method & honesty notes

Every number below traces to a command or fetch reproduced in **Appendix A**. Rules I held myself to:

1. **TCGdex API was queried exactly 6 times** (another agent is hitting it concurrently). All bulk/coverage analysis was done **offline** against a local clone of `tcgdex/cards-database`, then **spot-verified** against the live API. Where the local repo and the live API were both checked, they agreed.
2. **No `du` on the scratchpad for size claims.** The scratchpad is `tmpfs` with a **16 KiB** block size; the target filesystem (`/`, the microSD) is ext4 with a **4096-byte** block size. `du` in the scratchpad overstates small-file cost by ~4×. All disk figures below are either **apparent bytes** (sum of file sizes) or **ext4@4K** (sum of `ceil(size/4096)*4096`), computed from real per-file byte sizes. This matters a lot: pokesprite's Gen-8 sprite set is 0.81 MB of bytes but **5.28 MB of ext4 blocks**.
   ```
   $ rtk stat -f -c "%T blocksize=%s" /home/cheyras/pokedex
   ext2/ext3 blocksize=4096
   $ rtk stat -f -c "%T blocksize=%s" <scratchpad>
   tmpfs blocksize=16384
   $ rtk df -h /home/cheyras
   /dev/mmcblk0p2  118G   48G   65G  43% /
   ```
3. Anything I inferred rather than measured is tagged **[projected]**. Anything I could not verify is in **§F**.
4. All clones were made into the scratchpad and deleted afterwards (Appendix A, last block). Nothing outside `research/DEX-DATA.md` and the scratchpad was written.

---

## 1. TL;DR — recommendations

| Question | Answer | Measured cost |
|---|---|---|
| Card → species mapping | **TCGdex `dexId` is the primary key path.** It exists, it is an `Array<number>`, and it covers **99.63 %** of non-Pocket Pokémon cards. Add a deterministic name-normalisation fallback for the rest. | — |
| Expected end-to-end match rate | **≥ 99.9 % of Pokémon cards** resolve to at least one correct species (dexId first, name fallback second). See §A.6. | — |
| Species dataset | **`PokeAPI/pokeapi`, `data/v2/csv/` — vendored as static CSV.** BSD-3-Clause, complete through Gen 9 (1025 species), no live API dependency. | **~186 KB** vendored (9 files, English-only i18n) |
| Sprite set | **`PokeAPI/sprites`**, two styles: `sprites/pokemon/{n}.png` + `shiny/` (96×96 pixel art, for the dex grid) and `other/official-artwork/{n}.png` + `shiny/` (475×475, for the species detail/capture card). | **8.13 MB** (pixel art only) or **270.64 MB** (both styles) on ext4 |
| Reject | **`msikma/pokesprite`** — hard-stops at National Dex **#905**. No Gen 9 sprites at all. Disqualified. | — |
| Reject | **`veekun/pokedex`** — its `pokemon_species.csv` stops at **#898**. Stale since 2022. | — |
| Granularity | **Species-level (1025 rows).** Form-level is not derivable from `dexId` — TCGdex maps Alolan Meowth to 52, i.e. the base species. | — |
| Capture state | **Derive on read**, cache per-user. Full 1025-row dex page measured at **19.9–57.1 ms** on this Pi across collection sizes 500→40 000. No materialisation needed for v1. | — |

---

## 2. Corpus at a glance (measured)

```
tcgdex/cards-database @ master, pushed_at 2026-07-22T16:17:22Z, MIT, GitHub size 79,740 KB
  data/                       23,780 files, 40.6 MB apparent, 93.6 MB ext4@4K
  parsed as card definitions  23,538
    category Pokemon          19,963
    category Trainer           3,042
    category Energy              533

Excluding the "Pokémon TCG Pocket" serie (a different game; pkmn.gg does not track it):
  cards                       21,058
    Pokemon                   17,680
    Trainer                    2,845
    Energy                       533
```

---

# A. The card → species mapping

## A.1 Yes — TCGdex carries a dex number, and it is an array

Upstream type declaration (`tcgdex/cards-database/interfaces.d.ts:275-278`):

```ts
	/**
	 * Pokemon Pokedex ID
	 */
	dexId?: Array<number>
```

Note the `?`. **The field is optional and, when absent, is omitted entirely from the JSON response** — not `null`. Verified live in §A.4.

### Real API responses, five eras

All fetched from `https://api.tcgdex.net/v2/en/cards/<id>` on 2026-07-24.

**Base Set (1999) — `base1-4` Charizard.** Full unmodified response:

```json
{"category":"Pokemon","id":"base1-4","illustrator":"Mitsuhiro Arita","image":"https://assets.tcgdex.net/en/base/base1/4","localId":"4","name":"Charizard","rarity":"Rare","set":{"cardCount":{"official":102,"total":102},"id":"base1","logo":"https://assets.tcgdex.net/en/base/base1/logo","name":"Base Set"},"variants":{"firstEdition":true,"holo":true,"normal":false,"reverse":false,"wPromo":false},"variants_detailed":[{"type":"holo","subtype":"unlimited","size":"standard","variantId":"4ffrmhcfiaejakhepqdkx7o","pricing":{"cardmarket":{"updated":"2026-07-23T08:02:25.017Z","unit":"EUR","idProduct":273699,"avg":446.7,"low":100,"trend":421.11,"avg1":140,"avg7":407.33,"avg30":445.6,"avg-holo":null,"low-holo":null,"trend-holo":123.63,"avg1-holo":207.4,"avg7-holo":129.55,"avg30-holo":202.71},"tcgplayer":{"unit":"USD","updated":"2026-07-23T08:02:22.177Z","holofoil":{"productId":42382,"lowPrice":510,"midPrice":826.6,"highPrice":2571.35,"marketPrice":800.43,"directLowPrice":544.99}}}},{"type":"holo","subtype":"shadowless","size":"standard","stamp":["1st-edition"],"variantId":"mtltux8qtgdu4exu903oasum21juxbvx6lx","pricing":{"cardmarket":null,"tcgplayer":null}},{"type":"holo","subtype":"shadowless","size":"standard","variantId":"3takscxpcqoqcfnxk1ivs2y6","pricing":{"cardmarket":null,"tcgplayer":null}},{"type":"holo","subtype":"1999-2000-copyright","size":"standard","variantId":"zqq5g2u9n0st0gren5bssktmac2ywqaw"}],"dexId":[6],"hp":120,"types":["Fire"],"evolveFrom":"Charmeleon","description":"Spits fire that is hot enough to melt boulders. Known to unintentionally cause forest fires.","stage":"Stage2","abilities":[{"type":"Pokemon Power","name":"Energy Burn","effect":"As often as you like during your turn (before your attack), you may turn all Energy attached to Charizard into Fire Energy for the rest of the turn. This power can't be used if Charizard is Asleep, Confused, or Paralyzed."}],"attacks":[{"cost":["Fire","Fire","Fire","Fire"],"name":"Fire Spin","effect":"Discard 2 Energy cards attached to Charizard in order to use this attack.","damage":100}],"weaknesses":[{"type":"Water","value":"×2"}],"resistances":[{"type":"Fighting","value":"-30"}],"retreat":3,"legal":{"standard":false,"expanded":false},"updated":"2026-07-11T09:49:03+01:00","pricing":{ … }}
```

→ `"dexId":[6]`.

**EX era (2005) — `ex11-1` Beedrill δ (Delta Species):**
```json
{ "id": "ex11-1", "name": "Beedrill δ", "category": "Pokemon",
  "dexId": [15], "types": ["Grass","Metal"], "rarity": "Rare",
  "set": "Delta Species", "stage": "Stage2" }
```

**Sun & Moon era (2019) — `sm9-33` Pikachu & Zekrom GX (TAG TEAM):**
```json
{ "id": "sm9-33", "name": "Pikachu & Zekrom GX", "category": "Pokemon",
  "dexId": [25, 644], "hp": 240, "types": ["Lightning"],
  "suffix": "TAG TEAM-GX", "rarity": "Ultra Rare", "set": "Team Up" }
```

**Sword & Shield era (2021) — `swsh8-1` Caterpie:**
```json
{ "id": "swsh8-1", "localId": "1", "name": "Caterpie", "category": "Pokemon",
  "dexId": [251], "hp": 50, "types": ["Grass"], "stage": "Basic",
  "rarity": "Common", "set": "Fusion Strike" }
```
⚠ `dexId: [251]` is **Celebi**. Caterpie is #10. This is a genuine upstream data error — see §A.5 F6.

**Scarlet & Violet era (2025) — `sv08.5-092` Terapagos ex:**
```json
{ "id": "sv08.5-092", "name": "Terapagos ex", "category": "Pokemon",
  "dexId": [1024], "suffix": "ex", "rarity": "Double rare",
  "set": "Prismatic Evolutions" }
```

**Mega Evolution era (2026, newest) — `me02.5-026` Ethan's Ho-Oh ex:**
```json
{ "id": "me02.5-026", "name": "Ethan's Ho-Oh ex", "category": "Pokemon",
  "suffix": "ex", "rarity": "Double rare", "set": "Ascended Heroes" }
```
⚠ **No `dexId` key at all.** Not `null` — absent. Your deserialiser must treat missing as "unknown", not as an empty array or a zero.

## A.2 Coverage, measured over the whole database (not sampled)

Parsed all 23,538 card definition files in the local clone and counted (`coverage.mjs`, Appendix A):

```
### WHOLE DATABASE  (n=23538)
  Pokemon: 19963, with dexId: 19897 (99.67%), missing: 66
  Trainer: 3042, with dexId: 4 (0.13%)
  Energy : 533, with dexId: 0 (0.00%)
  Multi-dexId Pokemon cards: 126 (0.63%)
  ALL cards with dexId: 19901/23538 (84.55%)

### EXCLUDING Pokémon TCG Pocket  (n=21058)   <-- the number that matters for us
  Pokemon: 17680, with dexId: 17614 (99.63%), missing: 66
  Trainer: 2845, with dexId: 4 (0.14%)
  Energy : 533, with dexId: 0 (0.00%)
  Multi-dexId Pokemon cards: 126 (0.71%)
  ALL cards with dexId: 17618/21058 (83.66%)
```

Read the two headline numbers correctly:

- **83.66 % of *all* cards carry `dexId`** — because Trainers and Energy legitimately don't have one. That number is *not* a defect.
- **99.63 % of *Pokémon-category* cards carry `dexId`** — that is the number the capture mechanic actually depends on.

Per-serie, the field is essentially perfect everywhere except the newest release:

```
  Scarlet & Violet               3159 pk    3159 withDex  100.00%
  Sword & Shield                 3043 pk    3043 withDex  100.00%
  Sun & Moon                     2424 pk    2424 withDex  100.00%
  XY                             1590 pk    1590 withDex  100.00%
  EX                             1463 pk    1463 withDex  100.00%
  Black & White                  1289 pk    1289 withDex  100.00%
  Mega Evolution                  847 pk     781 withDex   92.21%   <-- the only gap
  Diamond & Pearl                 796 pk     796 withDex  100.00%
  Platinum                        480 pk     480 withDex  100.00%
  E-Card                          456 pk     456 withDex  100.00%
  Base                            406 pk     406 withDex  100.00%
  HeartGold & SoulSilver          381 pk     381 withDex  100.00%
  Neo                             329 pk     329 withDex  100.00%
  McDonald's Collection           259 pk     259 withDex  100.00%
  Trainer kits                    215 pk     215 withDex  100.00%
  Gym                             186 pk     186 withDex  100.00%
  POP                             171 pk     171 withDex  100.00%
  Legendary Collection             99 pk      99 withDex  100.00%
  Call of Legends                  86 pk      86 withDex  100.00%
  Miscellaneous                     1 pk       1 withDex  100.00%
  Pokémon TCG Pocket             2283 pk    2283 withDex  100.00%
```

**Every single one of the 66 gaps is in the "Mega Evolution" serie**, and all 66 are "Owner's Pokémon" names:

```
### Pokemon cards with NO dexId: 66   (54 distinct names, all serie = "Mega Evolution")
    2  Erika's Tangela          2  Ethan's Magcargo       2  Iono's Bellibolt ex
    2  Iono's Wattrel           2  Lillie's Clefairy ex   2  Team Rocket's Mewtwo ex
    2  Hop's Trevenant          2  Team Rocket's Mimikyu  2  Team Rocket's Dugtrio
    2  Cynthia's Spiritomb      2  N's Zoroark ex         2  Larry's Staraptor
    1  Erika's Oddish  …  1  Ethan's Ho-Oh ex  …  1  Cynthia's Garchomp ex   (54 names total)
  by serie: {"Mega Evolution":66}
```

**This is a data-freshness lag, not a structural inability to represent Owner's Pokémon.** Proof: the *same character* in an older set is populated —

```
Ethan's Ho-Oh ex | dexId= null  | Mega Evolution/Ascended Heroes/026.ts
Ethan's Ho-Oh ex | dexId= [250] | Scarlet & Violet/Destined Rivals/039.ts
Ethan's Ho-Oh ex | dexId= [250] | Scarlet & Violet/Destined Rivals/209.ts
```
and Gym/EX-era owner cards are all populated (`Sabrina's Abra → [63]`, `Rocket's Raikou ex → [243]`, `Rocket's Scizor ex → [212]`). The repo is actively maintained (`pushed_at` 2026-07-22), so **[projected]** these gaps close within weeks. Design for it anyway — new sets will always land before contributors backfill.

### Every species is reachable

```
### Distinct dexId values referenced: 1025   min=1  max=1025
  values outside 1..1025: []
  National Dex 1..1025 species never referenced by any card: 0
```

So a complete TCG collection captures the complete National Dex. There is no species you can never catch, and there is no stray out-of-range id to defend against.

## A.3 Multi-species cards

126 Pokémon cards carry more than one dex id (excluding Pocket). The distribution:

```
### Multi-dexId cards: 127 (126 Pokemon + 1 Trainer)
  dexId array length distribution: {"2":115,"3":10,"4":1,"5":1}
```

Real examples from the local data:

| Card | `dexId` | File |
|---|---|---|
| `Pikachu & Zekrom GX` | `[25, 644]` | Sun & Moon/Team Up/33.ts |
| `Palkia & Dialga LEGEND` | `[484, 483]` | HeartGold & SoulSilver/Triumphant/101.ts |
| `Rayquaza & Deoxys LEGEND` | `[384, 386]` | HeartGold & SoulSilver/Undaunted/89.ts |
| `Togepi & Cleffa & Igglybuff GX` | `[173, 174, 175]` | Sun & Moon/Cosmic Eclipse/143.ts |
| `Arceus & Dialga & Palkia GX` | `[483, 484, 493]` | Sun & Moon/Cosmic Eclipse/156.ts |
| `Moltres & Zapdos & Articuno GX` | `[146, 145, 144]` | Sun & Moon/Hidden Fates/44.ts |
| `Buried Fossil` | `[138, 140, 142]` | E-Card/Skyridge/47.ts |
| `Tropical Tidal Wave` (a **Trainer**) | `[25, 183, 54, 187]` | HeartGold & SoulSilver/HGSS Black Star Promos/HGSS18.ts |
| `Terapagos & Friends` | `[1024, 25, 906, 909, 912]` | Scarlet & Violet/SVP Black Star Promos/500.ts |

Three design consequences:

1. **The array order is not the name order.** `Palkia & Dialga LEGEND → [484,483]` puts Dialga (483) second even though it is named second — fine — but `Reshiram & Charizard GX` has `dexId[0] = 6` (Charizard), i.e. reversed relative to the name. **Never treat `dexId[0]` as "the" species.** Store all of them.
2. **`Buried Fossil` proves a Pokémon-category card can have dex ids and no species in its name.** A name-only mapper cannot handle it.
3. **`Tropical Tidal Wave` proves a Trainer card can have dex ids.** If you capture on "has dexId", a Stadium card will silently capture Pikachu, Marill, Psyduck and Hoppip. **Gate capture on `category = 'Pokemon'`.** (Of the 4 Trainers with dexId, 3 — `Buizel` DP13, `Glameow` Majestic Dawn 65, `Combusken` Nintendo Black Star Promos 9 — look like upstream mis-categorisations of actual Pokémon cards, and 1 is a real Trainer.)

Whether a TAG TEAM captures *both* species, or only one, or neither, is a **rules** question that belongs to the pkmn.gg-behaviour work-stream. The data supports any of those; store the full array with an ordinal and let the rule layer decide.

## A.4 The failure modes, ranked

**F1 — Field absent on brand-new sets (66 cards today, 0.37 % of Pokémon cards).**
Absent, not null. All in the newest serie, all "Owner's Pokémon". Mitigation: name fallback (resolves **100 %** of these 66, §A.5) + a re-sync job that re-reads `dexId` on every catalog sync so backfills land automatically.

**F2 — Cards with no English name at all (127 in scope; 93 of them Pokémon-category).**
```
cards with no English name: all series = 222 | excl. Pocket = 127
   | of those, Pokemon-category = 93 | with dexId = 93
```
93 Pokémon cards (0.53 % of the 17,680) have **no English name** — and **all 93 have `dexId`**. Some entries are French-only. Example — `McDonald's Collection/Collection McDonald's 2013/1.ts`:
```ts
const card: Card = {
	name: {
		fr: "Phyllali",
	},
	illustrator: "Masakazu Fukuda",
	rarity: "None",
	category: "Pokemon",
	set: Set,
	dexId: [470],
```
These have `dexId` but **no English name**, so they are exactly the cards a name-based mapper cannot touch. Another argument for `dexId`-first.

**F3 — Multi-species cards (126).** See §A.3. `dexId[0]` is unsafe.

**F4 — Trainers/Energy with a dex id (4 cards).** See §A.3.

**F5 — Punctuation and codepoint drift *inside TCGdex itself*.**
This one bit me during the fallback simulation. TCGdex uses **both** apostrophe codepoints for the same species:
```
Farfetch'd | dexId= [83] | Base/Base Set/27.ts          <- U+0027 APOSTROPHE
Farfetch’d | dexId= [83] | Black & White/Boundaries Crossed/107.ts   <- U+2019 RIGHT SINGLE QUOTE
```
and **PokeAPI uses U+2019 exclusively** (`83:Farfetch’d`, `865:Sirfetch’d`). A naive `=` join drops half the Farfetch'd cards. Other real traps confirmed in the data:
`Nidoran♀` / `Nidoran♂` (U+2640/U+2642), `Mr. Mime`, `Mime Jr.`, `Type: Null`, `Ho-Oh`, `Porygon-Z`, `Jangmo-o`/`Hakamo-o`/`Kommo-o`, `Flabébé` (U+00E9), `Wo-Chien`/`Chien-Pao`/`Ting-Lu`/`Chi-Yu`, `Beedrill δ` (U+03B4), `Shaymin ◇` (U+25C7), `Groudon Star`, and one card literally named `ナッシー[Exeggutor]`.

**F6 — TCGdex `dexId` is occasionally simply wrong (13 cards, 0.075 %).**
I cross-checked every single-species Pokémon card's `dexId` against what its own English name implies, using the §A.5 resolver. Complete list of disagreements:

```
=== FULL single-species conflicts: 13 of 17395 (0.075%), 10 distinct
  x  4  Inteleon VMAX | dexId=888 (=Zacian)     name implies 818 (=Inteleon)  Sword & Shield/Fusion Strike/266.ts
  x  1  Chimchar      | dexId=391 (=Monferno)   name implies 390 (=Chimchar)  McDonald's Collection 2021/12.ts
  x  1  Mega Absol ex | dexId=351 (=Castform)   name implies 359 (=Absol)     Mega Evolution/Mega Evolution/086.ts
  x  1  Electrode     | dexId=130 (=Gyarados)   name implies 101 (=Electrode) Scarlet & Violet/My First Battle/22.ts
  x  1  Lapras        | dexId=129 (=Magikarp)   name implies 131 (=Lapras)    Scarlet & Violet/My First Battle/31.ts
  x  1  Pawmot ex     | dexId=921 (=Pawmi)      name implies 923 (=Pawmot)    Scarlet & Violet/Obsidian Flames/073.ts
  x  1  Tapu Lele     | dexId=785 (=Tapu Koko)  name implies 786 (=Tapu Lele) SM Black Star Promos/SM45.ts
  x  1  Tapu Bulu     | dexId=786 (=Tapu Lele)  name implies 787 (=Tapu Bulu) SM Black Star Promos/SM61.ts
  x  1  Tapu Fini     | dexId=787 (=Tapu Bulu)  name implies 788 (=Tapu Fini) SM Black Star Promos/SM92.ts
  x  1  Caterpie      | dexId=251 (=Celebi)     name implies  10 (=Caterpie)  Sword & Shield/Fusion Strike/1.ts
```

This list is only as complete as the resolver: it can only flag a conflict on a card whose name the resolver can resolve at all (it resolves 99.99 % of them, §A.5), so treat 13 as a tight lower bound rather than a proven ceiling.

Verified against the live API, not just the repo — see the `swsh8-1` response in §A.1. Also verified in the source file:
```ts
// data/Sword & Shield/Fusion Strike/1.ts
const card: Card = {
	dexId: [251],
	set: Set,
	name: { en: "Caterpie", … },
```
The Tapu family is an off-by-one run across three promos. `Inteleon VMAX → Zacian` costs 4 cards.

**Mitigation:** at catalog-sync time, run the name-derived id as a *cross-check* and log/flag disagreements into a `card_species_conflict` table with a `manual_override` escape hatch. 13 rows is a five-minute one-time human review, and the check keeps working as new sets land. Do **not** silently prefer one source — flag and default to `dexId`.

**F7 — Regional/mechanic forms collapse to the base species (by design, not a bug).**
```
Alolan Meowth      -> [52]   (Meowth)
Alolan Exeggutor   -> [103]  (Exeggutor)
Galarian Zigzagoon -> [263]  (Zigzagoon)
Galarian Obstagoon -> [862]  (Obstagoon — its own species, so it gets its own number)
Hisuian Growlithe  -> [58]   (Growlithe)
Paldean Wooper     -> [194]  (Wooper)
Charizard VMAX     -> [6]
Dark Charizard     -> [6]
Beedrill δ         -> [15]
Terapagos ex       -> [1024]
```
361 cards (2.05 % of Pokémon cards) carry a regional prefix — Galarian 138, Alolan 117, Hisuian 78, Paldean 28 — spanning 67 distinct names that collapse onto **65 distinct dex ids**. If you ever want form-level granularity, `dexId` will not give it to you; you would have to parse the prefix yourself. See §E for why I recommend against that.

## A.5 The fallback: name normalisation against the species list

Because `dexId` fails in F1/F2, we need a deterministic fallback. I built one and **measured it against TCGdex's own `dexId` as ground truth** across all 17,521 non-Pocket Pokémon cards that have one — i.e. a true held-out evaluation, not a hand-wave.

**Algorithm (`namefallback2.mjs`, Appendix A):**
1. Normalise: NFC; fold `‘ ’ ʼ \` ´ → '`; fold `é è ê → e`; lowercase; drop `. : ?`; fold all Unicode dashes to `-`; collapse whitespace.
2. Build a species index keyed on the normalised name with `-`, `'` and spaces **removed entirely**, so `Ho-Oh`/`ho oh`/`hooh` collide.
3. Try whole-name exact match first.
4. Otherwise: strip `[...]` brackets, `_____`, and possessives (`X's `); split on `&`; for each segment, search the **longest contiguous token window** that hits the species index — first over all tokens, then over tokens with a noise-word list removed (`ex gx v vmax vstar break legend star δ ◇ mega m alolan galarian hisuian paldean dark shining radiant dusk mane dawn wings origin forme single strike rapid strike ice rider gmax …`).

**Measured result:**

```
=== v2 NAME-ONLY FALLBACK (token-window) vs TCGdex dexId
evaluable Pokemon cards: 17521   (cards with no truth: 66)
  correct   : 17468  99.70%
  WRONG     :    51   0.29%
  unresolved:     2   0.01%

  unresolved (distinct): ["Buried Fossil", "ナッシー[Exeggutor]"]

=== multi-species cards: 126; full dexId-set recovered by name alone: 124 (98.41%)
=== 66 dexId-less Pokemon cards: fallback resolves 66 (100.00%); unresolved: []
```

Decomposition of the 51 "wrong", measured:

```
=== decomposition of the 51 "wrong":
      multi-species ordering        = 38
      single-species genuine conflicts = 13
```

**38 of them are TAG-TEAM/duo cards where the fallback picks the first-named species and TCGdex's `dexId[0]` is the second-named one** (`Celebi & Venusaur GX` → fallback 251, TCGdex `[3,251]`). Those are ordering disagreements, not errors — the multi-species `resolveAll` recovers the complete set for 124/126 cards. The remaining **13** are the genuine TCGdex errors of F6.

**Ordering caution — noise-word lists are a foot-gun.** My first pass put `sandy` in the noise list (for Wormadam Sandy Cloak) and it broke **Sandy Shocks ex** (#989 — *corrected: this doc originally said #1005, which is Roaring Moon; the importer used the authoritative PokeAPI CSV and maps Sandy Shocks to 989*). The fix is the ordering above: *try the full token window before removing any noise word*. That ordering change alone moved the fallback from 95.39 % → 99.17 %.

## A.6 Expected match rate, with reasoning

Composing the two sources on the **17,680 non-Pocket Pokémon cards**:

| Path | Cards | Rate | Basis |
|---|---|---|---|
| `dexId` present and correct | 17,601 | 99.55 % | 17,614 with dexId − 13 measured-wrong |
| `dexId` present but wrong | 13 | 0.074 % | measured, F6; caught by the cross-check, fixable by override |
| `dexId` absent → name fallback succeeds | 66 | 0.37 % | measured — 66/66 resolved |
| Unresolvable by either | 0 today | 0 % | the only two fallback failures (`Buried Fossil`, `ナッシー[Exeggutor]`) both *have* `dexId` |

**→ 99.93 % correct with zero human input; 100.0 % after a one-time review of the 13 flagged conflicts.**
**→ 100 % of the 1025 species remain reachable** regardless, since even with all 12 errors in place every species is referenced by some other card.

**Steady-state [projected from the Mega-Evolution sample]:** each newly-released set arrives with roughly `66/847 ≈ 7.8 %` of its Pokémon cards missing `dexId` until contributors backfill. With the name fallback in place that is a **0 %** user-visible gap, because the fallback resolved 66/66 of exactly this population. Budget the fallback as permanent infrastructure, not a stopgap.

---

# B. Species dataset

## B.1 Candidates evaluated

| Source | License | Species coverage | Static file? | Repo size | Verdict |
|---|---|---|---|---|---|
| **`PokeAPI/pokeapi` → `data/v2/csv/`** | **BSD-3-Clause** | **1025 (Gen 1–9), complete** | **Yes — plain CSV in git** | 64.5 MB repo; the CSV dir is **180 files / 39.36 MB**; our subset **~186 KB** | ✅ **Recommended** |
| `PokeAPI/api-data` | BSD-3-Clause | same, pre-rendered as the full v2 JSON API | Yes — static JSON tree | **257.4 MB** (pushed 2026-07-23) | Viable if you want a zero-transform drop-in static API, but 1400× larger than the CSV subset for data we'd only ever read via SQL. Not recommended. |
| `veekun/pokedex` | MIT | **898** — stops at Calyrex, no Gen 9 | Yes | 21.9 MB (last push 2022-07-21) | ❌ Stale. PokeAPI's CSVs are the maintained descendant of exactly these files. |
| `fanzeyi/pokemon.json` | **none declared** | Gen 1–8 era | Yes | 115.5 MB, **archived**, last push 2020-06-09 | ❌ Archived + unlicensed. |
| Live `pokeapi.co` API | — | — | **No** | — | ❌ Violates the brief's "must keep working if every upstream disappears". |

Verification of the two coverage claims:

```
$ head -1 pokemon_species.csv
id,identifier,generation_id,evolves_from_species_id,evolution_chain_id,color_id,shape_id,
habitat_id,gender_rate,capture_rate,base_happiness,is_baby,hatch_counter,has_gender_differences,
growth_rate_id,forms_switchable,is_legendary,is_mythical,order,conquest_order

pokemon_species rows: 1025  max id: 1025
generations: 1:generation-i … 9:generation-ix
species per generation: {"1":151,"2":100,"3":135,"4":107,"5":156,"6":72,"7":88,"8":96,"9":120}
last 3 species: 1023 iron-crown | 1024 terapagos | 1025 pecharunt
english species names: 1025
```
```
$ rtk wc -l veekun_species.csv    # veekun/pokedex master
899                               # = 898 rows + header
$ rtk tail -1 veekun_species.csv
898,calyrex,8,,476,5,,,-1,3,100,0,120,0,1,0,1,0,898,
```

**Independent corroboration of 1025:** TCGdex's card data references exactly 1025 distinct dex ids, `min=1 max=1025`, with nothing out of range. Two unrelated projects agree that the National Dex is 1025 species as of 2026-07-24.

## B.2 A load-bearing fact I verified

For all 1025 default forms, **`pokemon.id == pokemon_species.id`**:

```
is_default rows where pokemon.id != species_id: 0
max default pokemon id: 1025
non-default id range: 10001 - 10326
```

This is what makes the whole pipeline cheap: TCGdex's `dexId` is directly usable as (a) the `dex_species` primary key, and (b) the PokeAPI sprite filename. `sprites/pokemon/6.png` *is* Charizard, no join table required. Alternate forms are safely quarantined in the 10001–10326 range and will never collide with a `dexId`.

## B.3 Exactly what to vendor

Vendor into `data/pokeapi/` at these paths, pinned to a specific PokeAPI commit SHA recorded in the repo:

| File | Bytes | Why |
|---|---|---|
| `pokemon_species.csv` | 56,884 | the 1025 rows: id, identifier, generation_id, evolves_from_species_id, evolution_chain_id, is_baby/is_legendary/is_mythical, order |
| `pokemon_species_names.csv` **filtered to `local_language_id=9`** | 404,502 → **33,052** | display names + genus ("Flame Pokémon") |
| `pokemon.csv` | 47,082 | species → form ids; needed only if you later go form-level |
| `pokemon_types.csv` | 19,058 | 2,116 rows — type badges on the dex grid |
| `types.csv` | 321 | 21 types |
| `type_names.csv` **filtered to lang 9** | 2,843 → **266** | English type labels |
| `generations.csv` | 193 | generation filter tabs |
| `evolution_chains.csv` | 2,648 | evolution family grouping |
| `pokemon_evolution.csv` | 26,468 | 550 evolution edges |

**Total vendored: ~186 KB** (152,654 B of non-i18n files + 33,052 + 266). That is nothing on a 65 GB budget, it is diffable in git, and it removes any runtime dependency on `pokeapi.co`.

Deliberately **not** vendored: `pokemon_species_flavor_text.csv` (9.2 MB), `pokemon_moves.csv` (10.7 MB), `encounters.csv` (3.2 MB), and the other 168 files — none of them serve the capture mechanic. If you later want Pokédex flavour text on the species page, add the English rows of `pokemon_species_flavor_text.csv` and re-measure; the full file is 9.2 MB of which English is a fraction.

**License position:** PokeAPI is BSD-3-Clause and requires only that the copyright notice be retained. Its LICENSE.md itself states *"Pokémon and Pokémon character names are trademarks of Nintendo."* Ship a `data/pokeapi/LICENSE.md` copy verbatim alongside the CSVs. This is redistribution-safe even in a public repo; the trademark caveat is about names, which we are using descriptively in a private app.

---

# C. Sprites / artwork

## C.1 `msikma/pokesprite` — measured, then rejected

MIT-licensed (code), 24.9 MB repo, 68×56 px Gen-8 box sprites, both regular and shiny, plus 40×30 icons. Measured on the actual worktree (11,122 files, apparent bytes converted to ext4@4K blocks):

```
path                                     files     apparent      ext4@4K
icons/pokemon/shiny                       1194      0.48 MB      4.66 MB
icons/pokemon/regular                     1194      0.41 MB      4.66 MB
pokemon-gen8/shiny                        1353      0.86 MB      5.29 MB
pokemon-gen8/regular                      1352      0.81 MB      5.28 MB
pokemon-gen7x/shiny                       1206      0.46 MB      4.71 MB
pokemon-gen7x/regular                     1206      0.44 MB      4.71 MB
...
TOTAL                                    11122     10.69 MB     48.77 MB
$ rtk file pokemon-gen8/regular/bulbasaur.png
PNG image data, 68 x 56, 8-bit/color RGBA, non-interlaced
```

**Disqualified.** It has no Gen 9:

```
sprigatito.png     gen8/regular:no   gen8/shiny:no
fuecoco.png        gen8/regular:no   gen8/shiny:no
quaxly.png         gen8/regular:no   gen8/shiny:no
koraidon.png       gen8/regular:no   gen8/shiny:no
pecharunt.png      gen8/regular:no   gen8/shiny:no
terapagos.png      gen8/regular:no   gen8/shiny:no
enamorus.png       gen8/regular:YES  gen8/shiny:YES     <-- #905, the last one it has
```
`data/pokemon.json` contains **905 entries**; the README badge still reads *"Updated for Pokémon Sword/Shield (Crown Tundra DLC)"*; last push 2024-05-07. **120 of the 1025 species (11.7 %) would have no sprite** — and those 120 are exactly the Scarlet & Violet species that dominate the sets a modern collector is opening. Non-starter.

Secondary problem even if it were current: pokesprite files are keyed by **English slug** (`bulbasaur.png`), so you would need a slug↔dex table and would inherit every naming trap from §A.4-F5. PokeAPI's numeric filenames avoid that entirely.

## C.2 `PokeAPI/sprites` — recommended

Repo: **1,622,333 KB (1.55 GB)** total per the GitHub API — do **not** clone it whole onto the microSD. Everything below was measured **without downloading blobs**, by reading the git tree via the GitHub API and summing the per-blob `size` field (`treesize.sh`, Appendix A).

```
sprites/pokemon (whole subtree)   n=60113  apparent=1654.71 MB  ext4@4K=1811.06 MB
    other/                       n=13344  apparent=1345.81 MB  ext4@4K=1371.65 MB
    versions/                    n=40335  apparent= 299.84 MB  ext4@4K= 411.71 MB
    back/                        n= 3167  apparent=   4.03 MB  ext4@4K=  13.28 MB
    (front-default root files)   n= 1532  apparent=   2.79 MB  ext4@4K=   7.16 MB
    shiny/                       n= 1632  apparent=   2.15 MB  ext4@4K=   6.86 MB
    female/                      n=  103  apparent=   0.09 MB  ext4@4K=   0.41 MB

other/                           n=13344
    showdown/                    n= 6272  apparent= 578.82 MB  ext4@4K= 590.87 MB   (animated GIF)
    home/                        n= 3260  apparent= 389.21 MB  ext4@4K= 395.57 MB   (512×512)
    official-artwork/            n= 2666  apparent= 337.10 MB  ext4@4K= 342.28 MB   (475×475)
    dream-world/                 n= 1146  apparent=  40.67 MB  ext4@4K=  42.93 MB   (SVG)
```

**Shiny coverage is complete in every style — this is the decisive advantage.**

```
                                       numeric  1..1025 present  missing  formIds>1025
sprites/pokemon/ (front default)          1341            1025        0            315
sprites/pokemon/shiny/                    1341            1025        0            315
sprites/pokemon/back/                     1341            1025        0            315
sprites/pokemon/back/shiny/               1341            1025        0            315
other/official-artwork/                   1339            1025        0            314
other/official-artwork/shiny/             1327            1025        0            302
other/home/                               1336            1025        0            310
other/home/shiny/                         1328            1025        0            303
```

Every one of the 1025 National Dex numbers has both a normal and a shiny file in all four styles. Plus 302–315 alternate-form files at ids ≥ 10001 (unused at species granularity, safely skipped).

Dimensions, verified by fetching the actual files:

```
sprites/pokemon/6.png                          PNG 96 x 96,   4-bit colormap
sprites/pokemon/shiny/6.png                    PNG 96 x 96,   4-bit colormap
sprites/pokemon/other/official-artwork/6.png   PNG 475 x 475, 8-bit RGBA
sprites/pokemon/other/official-artwork/shiny/6.png  PNG 475 x 475, 8-bit RGBA
sprites/pokemon/other/home/6.png               PNG 512 x 512, 8-bit RGBA
sprites/pokemon/other/dream-world/6.svg        SVG
```

### Measured subset costs (dex 1..1025 only, normal + shiny)

```
=== species-level subsets (dex 1..1025 only)
front-default 1..1025          n=1025  apparent=  1.02 MB  ext4@4K=  4.08 MB  avg=  1.0 KB  max= 15.2 KB
front-default shiny 1..1025    n=1025  apparent=  0.99 MB  ext4@4K=  4.05 MB  avg=  1.0 KB  max= 10.4 KB
  -> OPTION A (front-default normal+shiny):  n=2050  apparent=  2.01 MB  ext4@4K=   8.13 MB
official-artwork 1..1025       n=1025  apparent=126.52 MB  ext4@4K=128.53 MB  avg=126.4 KB  max=261.8 KB
official-artwork shiny 1..1025 n=1025  apparent=132.02 MB  ext4@4K=133.98 MB  avg=131.9 KB  max=258.2 KB
  -> OPTION B (official-artwork normal+shiny): n=2050 apparent=258.53 MB  ext4@4K= 262.51 MB
home 1..1025                   n=1025  apparent=120.41 MB  ext4@4K=122.41 MB  avg=120.3 KB  max=250.6 KB
home shiny 1..1025             n=1025  apparent=121.55 MB  ext4@4K=123.55 MB  avg=121.4 KB  max=253.0 KB
  -> OPTION C (home normal+shiny):          n=2050  apparent=241.95 MB  ext4@4K= 245.97 MB
  -> OPTION A+B combined:                          apparent=260.54 MB  ext4@4K= 270.64 MB
```

### Recommendation

**Vendor Option A + Option B = 4,100 files, 260.54 MB apparent, 270.64 MB on the microSD.**

- **Option A (96×96 pixel art, 8.13 MB)** is the dex *grid*. 1025 tiles on one page at ~1 KB each; the whole normal set is 1 MB, so the browser can hold it all. Silhouette/greyscale for "uncaught" is a CSS `filter: brightness(0) opacity(.35)` on the same file — **no third asset set needed**, which is why I am not recommending a separate caught/uncaught treatment.
- **Option B (475×475 official artwork, 262.51 MB)** is the species *detail/capture* view — a full-art hero image, and the visual payoff that makes "you caught a shiny" feel like something. Serve lazily, one at a time.
- **Skip `home/`** — 512×512 3D renders, 245.97 MB for a style that overlaps Option B's job. **Skip `showdown/`** (590.87 MB of animated GIFs) and **`versions/`** (411.71 MB of per-generation retro sprites) outright.

**Budget check against the brief's constraint:** 65 GB free; the card-image cache is the multi-GB item. 270.64 MB of sprites is **0.42 % of free space**. Even Option A alone (8.13 MB) is defensible if you want to be maximally frugal, at the cost of the hero image. If disk ever gets tight, Option B is the drop — it is 97 % of the sprite footprint.

**Fetch method — do not `git clone` this repo.** Use a sparse, blobless clone or direct raw fetches; the full history is 1.55 GB and the full working tree is another ~1.8 GB. See Appendix A.

### C.3 Licensing — the honest position

`PokeAPI/sprites/LICENCE.txt`, first two lines, verbatim:

```
All image contents within are Copyright The Pokémon Company.

This repository is distributed under CC0 1.0 Universal
```

That is self-contradictory on its face: **CC0 cannot be applied to a work you do not own the copyright to.** PokeAPI is waiving rights it does not hold. `msikma/pokesprite` is more careful and says the true thing: *"The sprite images are © Nintendo/Creatures Inc./GAME FREAK Inc. Everything else, and the programming code, is governed by the MIT license."*

**So state it plainly rather than leaning on the CC0 badge:** these are Nintendo/Creatures/GAME FREAK assets. The upstream licence tag does not launder that. What makes this project defensible is the *use*, not the licence:

- single user, one person's own hardware, no public exposure;
- non-commercial, no ads, no resale, nothing behind a paywall;
- **not redistributed** — the sprites live in the deployment, and the deployment is one Pi on one LAN;
- functionally identical in kind to the card art the brief already accepts caching from TCGdex.

**Concrete guardrails I'd recommend the lead agent adopt:**
1. If the pokedex repo is ever pushed to a public host (including Gitea over `cheyrasnet.tplinkdns.com`), **keep sprites out of git**. Vendor a `scripts/fetch-sprites.sh` + a pinned commit SHA + a checksum manifest instead. The repo then ships the *recipe*, not the assets — same reproducibility, no redistribution.
2. Ship a `NOTICE.md` naming Nintendo / Creatures / GAME FREAK / The Pokémon Company as the rights holders of all Pokémon imagery and names, and TCGdex/PokeAPI as the data sources.
3. Do not add the sprite directory to any publicly-reachable nginx location. LAN/Authelia-gated only, consistent with the brief's default posture.

I am not a lawyer and this is not legal advice; it is a risk posture, and it is the same posture the brief already takes for card art.

---

# D. Trainer Level & capture — data-model implications only

> Scope guard: I did **not** research pkmn.gg's help centre or observe its UI. Whether a TAG TEAM captures one species or two, whether a reverse-holo counts as a separate "unique card", and the exact level curve are **rules** questions owned by the behaviour work-stream. Everything below is about what the *storage* must be able to answer, and it is deliberately built so any of those rules can be layered on without a migration.

## D.1 Proposed schema

`user_id` is present on every user-scoped table (locked decision), even though there is one user.

```sql
-- ============ VENDORED / STATIC (from PokeAPI CSV; rebuilt from files, never from the network)
CREATE TABLE dex_species (
  id                       INTEGER PRIMARY KEY,      -- National Dex number, 1..1025
  identifier               TEXT    NOT NULL,         -- 'charizard'
  name                     TEXT    NOT NULL,         -- 'Charizard'  (may contain ’ ♀ ♂ : . -)
  genus                    TEXT,                     -- 'Flame Pokémon'
  generation               SMALLINT NOT NULL,        -- 1..9
  evolves_from_species_id  INTEGER REFERENCES dex_species(id),
  evolution_chain_id       INTEGER,
  is_baby                  BOOLEAN NOT NULL DEFAULT FALSE,
  is_legendary             BOOLEAN NOT NULL DEFAULT FALSE,
  is_mythical              BOOLEAN NOT NULL DEFAULT FALSE,
  dex_order                INTEGER NOT NULL          -- PokeAPI 'order' col, for evolution-family sort
);

CREATE TABLE dex_species_type (
  dex_id INTEGER NOT NULL REFERENCES dex_species(id),
  slot   SMALLINT NOT NULL,                          -- 1 or 2
  type   TEXT     NOT NULL,                          -- 'fire'
  PRIMARY KEY (dex_id, slot)
);

-- Sprites are convention, not rows: sprite_path(dex_id, style, shiny)
--   'pixel'  -> sprites/pokemon/{dex_id}.png            | shiny/{dex_id}.png     (96x96)
--   'art'    -> other/official-artwork/{dex_id}.png     | shiny/{dex_id}.png     (475x475)
-- A table is only warranted if we ever add per-form sprites. Keep it a pure function for now.

-- ============ DERIVED AT CATALOG SYNC (rebuilt idempotently from the card catalog)
CREATE TABLE card_species (
  card_id  TEXT     NOT NULL REFERENCES card(id) ON DELETE CASCADE,
  dex_id   INTEGER  NOT NULL REFERENCES dex_species(id),
  ord      SMALLINT NOT NULL,        -- position in TCGdex's dexId array; 0 is NOT authoritative
  source   TEXT     NOT NULL,        -- 'tcgdex' | 'name_fallback' | 'manual_override'
  PRIMARY KEY (card_id, dex_id)
);
CREATE INDEX card_species_dex_idx ON card_species(dex_id);

-- 13 known upstream errors today (§A.4-F6). Populated by the sync's cross-check; reviewed by hand.
CREATE TABLE card_species_conflict (
  card_id        TEXT PRIMARY KEY REFERENCES card(id) ON DELETE CASCADE,
  tcgdex_dex_id  INTEGER,
  name_dex_id    INTEGER,
  resolved_to    INTEGER,          -- NULL until a human decides
  noted_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============ USER STATE (owned by the collection work-stream; shown for the join shape)
-- collection_item(id, user_id, card_id, variant_id, quantity, ...)
--   UNIQUE (user_id, card_id, variant_id)

-- ============ OPTIONAL CACHE — add only if measurement says so (it currently does not)
CREATE TABLE user_dex_state (
  user_id           INTEGER NOT NULL,
  dex_id            INTEGER NOT NULL REFERENCES dex_species(id),
  unique_cards      INTEGER NOT NULL DEFAULT 0,   -- distinct card_id owned that map here
  total_copies      INTEGER NOT NULL DEFAULT 0,   -- SUM(quantity)
  first_captured_at TIMESTAMPTZ,                  -- NOT derivable later — see D.3
  PRIMARY KEY (user_id, dex_id)
);

CREATE TABLE user_profile (
  user_id                     INTEGER PRIMARY KEY,
  unique_cards                INTEGER NOT NULL DEFAULT 0,  -- COUNT(DISTINCT card_id)
  unique_card_variants        INTEGER NOT NULL DEFAULT 0,  -- COUNT(DISTINCT (card_id,variant_id))
  trainer_level               INTEGER NOT NULL DEFAULT 1,
  trainer_level_recomputed_at TIMESTAMPTZ
);
```

## D.2 Capture-state derivation

Capture and shiny are **pure functions of `collection_item ⋈ card_species`**. Nothing needs to be written at collection-edit time.

```sql
-- captured / shiny, per species, for the whole dex page
SELECT s.id, s.name, s.generation,
       COUNT(DISTINCT ci.card_id)              AS unique_cards,
       COALESCE(SUM(ci.quantity), 0)           AS copies,
       COUNT(DISTINCT ci.card_id) > 0          AS captured,
       GREATEST(COALESCE(SUM(ci.quantity),0) - 1, 0) AS shiny_count   -- rule layer decides the -1
FROM dex_species s
LEFT JOIN card_species cs ON cs.dex_id = s.id
LEFT JOIN collection_item ci
       ON ci.card_id = cs.card_id AND ci.user_id = $1 AND ci.quantity > 0
GROUP BY s.id;
```

Three data rules that are **not** negotiable regardless of what the behaviour spec says:

1. **Gate on `card.category = 'Pokemon'`** when populating `card_species`, or `Tropical Tidal Wave` (a Trainer) captures four species (§A.3).
2. **Never use `dexId[0]` as "the" species.** Join through all rows of `card_species`.
3. **`quantity > 0`** — a "Need" row with quantity 0 must not capture.

Both `unique_cards` and `copies` are materialised in the query, so the behaviour spec can define shiny as "extra *copies*" or "extra *distinct cards*" without a schema change. Same for Trainer Level: `user_profile` stores both `unique_cards` and `unique_card_variants` because "unique cards" is ambiguous the moment variants exist, and I don't own that decision.

## D.3 Derived-on-read vs materialised — measured, not guessed

I built the real schema in SQLite on this Pi, loaded the **real** 17,760-row `card_species` mapping and the real 1025-row species table, seeded synthetic collections at four sizes, and timed it. (`bench.py`, Appendix A.)

```
sqlite 3.46.1  |  rows: card=21058  card_species=17760  dex_species=1025

collection_item rows = 500     (species captured: 326/1025)
   full 1025-row dex page  (Q_DEX)                 19.85 ms
   captured species count  (Q_CAPTURED)             0.42 ms
   trainer-level input     (Q_LEVEL)                0.10 ms

collection_item rows = 2000    (species captured: 749/1025)
   full 1025-row dex page  (Q_DEX)                 21.73 ms
   captured species count  (Q_CAPTURED)             1.55 ms
   trainer-level input     (Q_LEVEL)                0.36 ms

collection_item rows = 10000   (species captured: 1008/1025)
   full 1025-row dex page  (Q_DEX)                 27.47 ms
   captured species count  (Q_CAPTURED)             7.37 ms
   trainer-level input     (Q_LEVEL)                1.71 ms

collection_item rows = 40000   (species captured: 1025/1025)
   full 1025-row dex page  (Q_DEX)                 57.12 ms
   captured species count  (Q_CAPTURED)            28.10 ms
   trainer-level input     (Q_LEVEL)                6.00 ms

EXPLAIN QUERY PLAN Q_DEX:
   (10, 0, 0, 'SCAN s')
   (12, 0, 0, 'SEARCH cs USING INDEX card_species_dex (dex_id=?) LEFT-JOIN')
   (19, 0, 0, 'SEARCH ci USING INDEX collection_uq (user_id=? AND card_id=?) LEFT-JOIN')
   (77, 0, 0, 'USE TEMP B-TREE FOR count(DISTINCT)')

bench db size: 4.00 MB
```

**Verdict: derive on read.** Even at 40,000 collection rows — an enormous personal collection — the *entire* 1025-species dex page computes in **57 ms** on this Pi, and the two scalar queries that drive the profile header are **28 ms** and **6 ms**. The ~20 ms floor is the fixed `dex_species × card_species` join, not the collection.

Recommendation:
- **v1: no materialisation.** Compute on request; put a short in-process cache (or an HTTP `ETag` keyed on `max(collection_item.updated_at)`) in front of the dex page. `user_dex_state` and `user_profile` stay in the schema as an optimisation you can switch on, not something you build now.
- **One exception — `first_captured_at`.** This is the single field that is **not** recoverable later. If you want a "caught on" date or a capture activity feed, you must write it at capture time from the outset. Cheap insurance: an `INSERT … ON CONFLICT DO NOTHING` into `user_dex_state(user_id, dex_id, first_captured_at)` on every collection add. Do this in v1 even though nothing reads it yet.

**Caveats on these numbers, stated plainly:**
- SQLite, not Postgres. The brief prefers Postgres for the price time-series. Postgres has higher per-query overhead but a better planner for this shape; **[projected]** same order of magnitude, likely 1.5–3× the SQLite figures at these row counts. Re-measure once the real DB is chosen — do not carry my numbers forward as Postgres numbers.
- The benchmark DB lived on tmpfs (I was not permitted to write to the microSD). At 4.00 MB the working set is fully page-cached after first touch on either filesystem, so these are CPU-bound numbers and the storage medium is not the variable. First-read-from-cold on microSD would add a one-off few-ms penalty.
- Synthetic collection: cards drawn uniformly at random across the whole catalogue with a fixed seed. A real collection is clustered by set, which would *reduce* distinct species and make `Q_DEX` slightly faster, not slower. These are conservative.

---

# E. Corpus size: species-level vs form-level

## E.1 The numbers

```
species                                        1025      (Gen 1: 151 … Gen 9: 120)
pokemon rows (species x major form)            1351      = 1025 default + 326 non-default
pokemon_forms rows (incl. cosmetic/battle)     1579      of which is_mega=97, is_battle_only=162
species with more than one form                 224
most forms for a single species                  17      (species 25 = Pikachu)
species with an evolves_from parent             484
pokemon_evolution edges                          550
```

So the honest answer to "how many distinct forms": **1351 at the meaningful-form level, 1579 if you count cosmetic and battle-only forms.**

## E.2 Recommendation: **species-level, 1025 rows.** Reasons, in order of weight:

1. **The data cannot support form-level.** TCGdex's `dexId` is a *species* number. `Alolan Exeggutor → [103]`, `Alolan Meowth → [52]`, `Hisuian Growlithe → [58]`. There is no form discriminator on the card. You would have to reconstruct it by parsing the card name — reintroducing every trap in §A.4-F5 for the 361 regional-form cards (2.05 %), and getting nothing at all for the 222 cards with no English name.
2. **The mechanic is "a National Pokédex".** 1025 slots is the recognisable artefact. 1351 or 1579 slots is not a Pokédex anyone recognises, and it would make 100 % completion depend on obtaining cards that may not exist for every form.
3. **Completion stays achievable and provably so.** All 1025 species are referenced by at least one card (§A.2). I did **not** verify that all 1351 forms are — and given regional variants collapse to base ids, most are not.
4. **It costs nothing to defer.** `dex_species.id` is the National Dex number; `pokemon.csv` (47 KB, already in the vendor list) carries the species→form mapping; alternate-form sprites already exist at ids 10001–10326 in `PokeAPI/sprites`. A future `dex_form` table joins cleanly with no migration of existing capture state.
5. **Sprite cost scales with the choice.** Form-level pixel art is 2,680 files / 10.61 MB ext4 (vs 8.13 MB) — negligible. Form-level *official artwork* is 2,666 files / **342.28 MB** vs 262.51 MB — a 30 % increase for a granularity the mapping can't feed.

**Where form-level should show up instead:** on the *card* record, not the *dex* record. "Alolan Meowth" is a property of the card and should render on the card tile; it captures species #52 in the dex. That gives the user the visual information without a data model that can't be filled.

---

# F. What I could not verify

1. **Postgres query costs.** I benchmarked SQLite because there was no way to benchmark Postgres without creating a database on the user's live 5432 instance, which is out of bounds. The SQLite numbers are real and measured; the Postgres numbers in §D.3 are marked **[projected]** and must be re-measured.
2. **Whether the 66 Mega-Evolution `dexId` gaps will actually be backfilled.** I verified the *pattern* (the same characters are populated in the older Destined Rivals set) and the repo's activity (`pushed_at` 2026-07-22). The forward projection is inference, not measurement.
3. **Whether the National Dex is still 1025 species.** Both PokeAPI (`max id 1025`) and TCGdex (`max dexId 1025`) say so as of 2026-07-24, which is strong mutual corroboration from two unrelated projects. I did not independently confirm that no Generation 10 has shipped; if one has, PokeAPI would need re-vendoring and I would expect its `pokemon_species.csv` to be the first place it appears.
4. **The `dexId` correctness of the ~2,283 Pokémon TCG Pocket cards.** I excluded that serie from all analysis (it is a different game and outside pkmn.gg's scope). Its raw coverage is 100 % (2,283/2,283) if you ever want it.
5. **Whether TCGdex's REST API supports server-side filtering by `dexId`.** I did not spend a request testing query syntax, because we vendor the catalogue into our own DB and query it in SQL. Someone standing up the self-hosted API may want to check.
6. **Sprite visual quality per species.** I verified dimensions, file presence, and byte sizes for every one of the 1025×2 files programmatically, and eyeballed the format of six samples. I did not view 2,050 images.
7. **`msikma/pokesprite` upstream forks.** There may be a maintained Gen-9 fork. I checked the canonical repo only and rejected it on that basis; a fork search was out of budget. Given `PokeAPI/sprites` is complete, current, and numerically keyed, I don't think it's worth chasing.

---

# Appendix A — Reproduction

Every figure in this document comes from one of these. Scratchpad = `/tmp/claude-1000/-home-cheyras/9d4785a9-85a1-4d4e-8806-8c5c927c16c1/scratchpad`.

**Repo metadata (no clone):**
```bash
rtk curl -s "https://api.github.com/repos/tcgdex/cards-database"   # size 79740 KB, MIT, pushed 2026-07-22
rtk curl -s "https://api.github.com/repos/PokeAPI/pokeapi"         # size 66014 KB, BSD-3-Clause
rtk curl -s "https://api.github.com/repos/PokeAPI/sprites"         # size 1622333 KB, NOASSERTION
rtk curl -s "https://api.github.com/repos/msikma/pokesprite"       # size  25493 KB, MIT, pushed 2024-05-07
rtk curl -s "https://api.github.com/repos/veekun/pokedex"          # size  22445 KB, MIT, pushed 2022-07-21
rtk curl -s "https://api.github.com/repos/PokeAPI/api-data"        # size 263620 KB, BSD-3-Clause
```

**TCGdex card data (blobless sparse clone — 6 API calls total, listed in §A.1):**
```bash
rtk git clone --depth 1 --filter=blob:none --no-checkout \
    https://github.com/tcgdex/cards-database.git $S/dexdata-cardsdb
cd $S/dexdata-cardsdb && rtk git sparse-checkout init --cone \
  && rtk git sparse-checkout set data && rtk git checkout
node analyze-dex.mjs      # -> cards-parsed.json: 23538 card defs, name/category/dexId per file
node coverage.mjs         # -> §A.2 coverage tables
node namefallback2.mjs    # -> §A.5 fallback evaluation
node errors2.mjs          # -> §A.4-F6 full conflict list + F2 scoping + wrong-count decomposition
```
*Parser note:* `analyze-dex.mjs` extracts the **top-level** `name:` block (a `name:` at exactly one tab of indentation). Field order in these files is inconsistent — some cards put `attacks:` or `dexId:` before `name:` — and a naive "first `name: { en: … }`" regex silently returns *attack* names for ~50 cards. That bug cost me a wrong first measurement; it is fixed in the numbers above.

**Sprite sizing without downloading blobs:**
```bash
# tree SHAs from a blobless clone, sizes from the GitHub trees API (blob 'size' field)
rtk git clone --depth 1 --filter=blob:none --no-checkout https://github.com/PokeAPI/sprites.git $S/dexdata-sprites
cd $S/dexdata-sprites && rtk git ls-tree HEAD:sprites            # -> pokemon tree sha addbf098...
bash treesize.sh PokeAPI/sprites addbf0986725947289ba86e81f94ab076eb0762c pokemon
bash treesize.sh PokeAPI/sprites e9c6cb7bcc622e9949a465806eac7ef0a4a1d54e other
bash treesize.sh PokeAPI/sprites 5fe88a779861766802f941ad3f63a9dc2331ab0d officialart
bash treesize.sh PokeAPI/sprites 2ed4212542d62a73c2e29562610a7f1c7203878b home
node sprcover.mjs         # -> 1..1025 coverage per style
node sprsubset.mjs        # -> exact apparent + ext4@4K bytes per subset
```

**Recommended production fetch (do NOT clone the 1.55 GB repo):**
```bash
git clone --depth 1 --filter=blob:none --sparse https://github.com/PokeAPI/sprites.git
cd sprites
git sparse-checkout set --no-cone \
  '/sprites/pokemon/*.png' \
  '/sprites/pokemon/shiny/*.png' \
  '/sprites/pokemon/other/official-artwork/*.png' \
  '/sprites/pokemon/other/official-artwork/shiny/*.png'
git rev-parse HEAD > ../SPRITES_PIN.txt   # pin it
# then delete .git and keep only the files -> 260.54 MB apparent / 270.64 MB on ext4
```

**Species CSVs:**
```bash
rtk curl -s "https://api.github.com/repos/PokeAPI/pokeapi/contents/data/v2/csv?ref=master"   # 180 files, 39.36 MB
for f in pokemon_species.csv pokemon_species_names.csv pokemon.csv pokemon_types.csv \
         types.csv type_names.csv generations.csv evolution_chains.csv pokemon_evolution.csv; do
  rtk curl -sL "https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/$f" -o pokeapi-csv/$f
done
rtk curl -sL "https://raw.githubusercontent.com/veekun/pokedex/master/pokedex/data/csv/pokemon_species.csv"  # 898 rows
```

**Query benchmark:**
```bash
rtk python3 bench.py      # sqlite3 3.46.1, real card_species + dex_species, synthetic collections
```

**Cleanup (run):**
```bash
rm -rf $S/dexdata-cardsdb $S/dexdata-sprites $S/dexdata-pokesprite $S/dexbench.db*
```
