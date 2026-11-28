# Set-logo templates

DeckPal's standard way to make a logo for a set that has **no official logo of its own**: promo
pools, energy sets, subsets, trainer kits, McDonald's collections, one-off packs. Four PhotoCraft
templates, one data-set row per set, a build that renders every row and ships it to the app.

The owner approved the system and all 59 of its first renders on 2026-11-27: *"The other logo
treatments also look great. Let's get all of it in, and yeah whatever system you came up with let's
make that our go to for those."* See
`decisions/2026/2026-11-27-template-set-logos-ship-and-become-the-standard-for-sets-without-an-official-log.md`.

## The rule

1. **A set's own official logo always wins.** If the catalog (TCGdex) or the approved crosswalk
   (`packages/storage/src/setImageFallback.ts`) has one, that is the logo. Do not make a template
   for a set whose real logo merely hasn't been sourced yet: source it (`fill-missing-assets`).
   Delta Reign (`me06`) is the live example: its real logo exists and is awaiting an owner
   decision, so it gets no template.
2. **No official logo anywhere → a template logo, never a blank.** Not the set's name, not a
   generic stand-in either: the shared PROMO star, the generic "Pokémon Trading Card Game"
   wordmark and a parent set's bare wordmark are all placeholders, and a template replaces them.
3. The app enforces rule 1 at runtime: a template outranks only the placeholder URL it was made to
   replace (`replaces` in `apps/web/src/lib/releasedSetAssets.ts`). If upstream ever publishes a
   set's own logo, the API reports a new `logoUrl`, and that logo wins without anyone editing the
   table.

## Layout

```
tools/set-logo-templates/
  templates/<template>.pcraft   the four PhotoCraft templates (open these)
  data/<template>.csv           one row per set = one PhotoCraft data set (written by the build)
  build/                        the pipeline (Python 3.10+, Pillow)
    config.py                   every set, its template and its parameters  <- edit this to add a set
    prepare_sources.py          step 1: fetch/verify inputs, fit each into its slot box
    render.py                   step 2: build the .pcraft files, write the CSVs, render every data set
    ship.py                     step 3: renders -> apps/web/public/set-logos/<setId>.webp
    contact_sheet.py            optional: .work/contact-sheet.png, every render on the slot gradient
    build.py                    steps 1-3 + the contact sheet
  sources/
    tier-sources.json           pinned inputs: tier URL, upstream URL, SHA-256 (committed)
    energy-rows/<setId>.png     the energy rows, DeckPal's own drawing (committed)
    logos/ sprites/ marks/      fetched from the app's image tier (gitignored)
    prepared/                   inputs fitted to slot boxes (gitignored, generated)
  renders/<template>/<setId>.png  trimmed renders (gitignored, generated)
```

Template sizes: `promo-stack.pcraft` 0.9 MB, `energy-row.pcraft` 1.1 MB, `product-plate.pcraft`
1.1 MB, `subset-tag.pcraft` 1.6 MB. Each embeds the pixels of its example data set (`mep`, `mee`,
`swsh12tg`, `tk-xy-p`), so it opens showing a finished logo.

## Requirements

- Windows, for PhotoCraft and the font. Every lettering layer uses **Bahnschrift** Bold Condensed
  (`wght` 700, `wdth` 75, faux italic), which ships with Windows 10 and 11.
- `photocraft-cli` (default `C:\Program Files\PhotoCraft\photocraft-cli.exe`; override with
  `PHOTOCRAFT_CLI`).
- Python 3.10+ with Pillow.
- `vectorcraft-cli` only to redraw an energy row (`VECTORCRAFT_CLI`).
- Network access to `deckpal.app` the first time, to fetch the inputs (below).

## Running it

```bash
python tools/set-logo-templates/build/build.py                  # everything (~10 min)
python tools/set-logo-templates/build/build.py product-plate    # one template; comma-separate several
```

The first run fetches the Pokémon Company's images from the app's own image tier and checks each
against `sources/tier-sources.json`. Later runs reuse the gitignored caches. Rebuilt from a clean
checkout on 2026-11-27, every input and all 59 renders were pixel-identical to the approved ones.

To open a template in the PhotoCraft GUI and step through its data sets (Image > Apply Data Set),
run `build/prepare_sources.py` once first: the data sets point at `sources/prepared/`.

## Adding a set

1. **Check rule 1.** Search TCGdex in every language, the crosswalk and the approved sources in
   `research/CARD-ART-SOURCES.md`. If a real logo exists, stop: source that instead.
2. **Pick the template** from the table below, and add the set's row to the matching list in
   `build/config.py` (`PROMO`, `ENERGY`, `SUBSET` or `PRODUCT`). That row becomes the set's data-set
   row in `data/<template>.csv` when the build writes it; do not hand-edit the CSV, or the next build
   drops your change. A set id containing `.` is fine (see the quirks).
3. **Run the build** for that template: `build.py <template>`. If the set needs an input the tier
   has but `tier-sources.json` does not list (a new parent logo, a new Pokémon), the build fetches
   it, pins its hash and says so.
4. **Look at it**: `.work/contact-sheet.png`, and the shipped `apps/web/public/set-logos/<setId>.webp`.
   Long labels do not auto-fit (quirks), so check the lettering.
5. **Register it in the app**: add a `TEMPLATE_SET_LOGOS` entry in
   `apps/web/src/lib/releasedSetAssets.ts`. If the API reports a placeholder `logoUrl` for the set
   (`GET /api/sets/<setId>` -> `set.images.logoUrl`), list it in `replaces`; if it reports `null`,
   leave `replaces` out.
6. **Verify**: `pnpm --filter deckpal-web test:insights` (the table, the CSVs and the shipped files
   must list the same sets), `pnpm --filter deckpal-web build` (fails if a named file is missing from
   `dist/`), then the set's series page and set page in a browser at 390 px and desktop.
7. **Commit the render and its inputs**: `build/config.py`, `data/<template>.csv`, the rebuilt
   `templates/<template>.pcraft`, `sources/tier-sources.json` if it changed, the new `.webp`, and
   `releasedSetAssets.ts`. Not `renders/`, `sources/prepared/` or the fetched caches.

## How each template is parameterised

PhotoCraft variables can swap pixels, text and visibility, but not colour or geometry, so any
style choice (a ribbon colour, text beside or centred) is its own layer group switched by a
visibility variable.

**promo-stack.pcraft** (canvas 1120x600). Promo pools: the series wordmark stacked over the Black
Star Promo mark, the wordmark in front of the star's top point the way every Mega Evolution logo's
banner sits over its title.

| Variable | Kind | Layer | What it does |
|---|---|---|---|
| `wordmark` | pixels | Series wordmark (box 80,16 960x220, bottom-aligned) | the series' namesake set logo (`me01`, `sv01`, `swsh1`, `sm1`, `xy1`, `bw1`, `hgss1`, `dp1`) |
| `showWordmark` | visibility | Series wordmark | off for series with no wordmark |
| `seriesText` | text | Series name | text-mode label: `NINTENDO`, `WIZARDS`, `MISCELLANEOUS` |
| `showSeriesText` | visibility | group "Series name (text mode)" | a leaning black banner with a white outline, in place of a wordmark |
| `promoMark` | pixels | Black Star Promo mark (box 350,200 420x380) | the star, with a 10 px white outer stroke and a soft shadow so it reads on the dark slot without a light plate |

**energy-row.pcraft** (canvas 1120x470). Energy sets: the series wordmark over a tray of energy
symbols.

| Variable | Kind | Layer | What it does |
|---|---|---|---|
| `wordmark` | pixels | Series wordmark (box 60,10 1000x240, bottom-aligned) | `me01` / `sv01` |
| `energyRow` | pixels | Energy row (box 60,258 1000x176) | `sources/energy-rows/<setId>.png`: one coin per energy type the set prints |
| `showTray` | visibility | Tray | the dark pill under the coins |

Both energy sets print the same eight basic types (G R W L P F D M), checked against
`/api/sets/<id>`. `energy_row()` in `prepare_sources.py` lays out any list of types.

**subset-tag.pcraft** (canvas 1120x600). Subsets: the parent set's logo with a forward-leaning
ribbon overlapping its base.

| Variable | Kind | Layer | What it does |
|---|---|---|---|
| `parentLogo` | pixels | Parent set logo (box 40,8 1040x432, bottom-aligned) | the highest-resolution file among the subset's own tier logo and its parent's |
| `show_<style>` | visibility | group "Ribbon · <style>" | one of five ribbon styles: `gold`, `silver`, `red`, `ink`, `yellow` |
| `label_<style>` | text | "Ribbon label · <style>" | the subset name; every ribbon carries it, so any can be switched on to compare |

Ribbons in use: Trainer Gallery = gold (all four TG sets, one sub-brand), Galarian Gallery =
silver, Shiny Vault = ink, Classic Collection = red with gold lettering (after Celebrations),
Unown Collection = ink, Yellow A Alternate = yellow.

**product-plate.pcraft** (canvas 1120x600). Product lines: the era's wordmark over a name plate.

| Variable | Kind | Layer | What it does |
|---|---|---|---|
| `eraWordmark` / `showEraWordmark` | pixels / visibility | Era wordmark (box 160,10 800x190) | the era's series wordmark; for `bog`, the classic "Pokémon Trading Card Game" logo the tier already uses for it |
| `eraText` / `showEraText` | text / visibility | group "Era name (text mode)" | `EX SERIES`: the only EX-era file on the tier is "EX Ruby & Sapphire", which would mislabel them |
| `mascot` / `showMascot` | pixels / visibility | Mascot (box 740,120 360x480, bottom-aligned) | the kit's Pokémon (official artwork the app already serves); hidden for McDonald's and packs |
| `line1_beside`, `line2_beside`, `showTextBeside` | text / visibility | group "Text · beside mascot" | left-aligned name plate, used with a mascot |
| `line1_centred`, `line2_centred`, `showTextCentred` | text / visibility | group "Text · centred" | centred name plate, used without one |

## PhotoCraft quirks

- **Pixel Replacement shrinks the box.** PhotoCraft fits a replacement image into the layer's
  *current* content bounds, not the box the variable was defined with (Photoshop keeps the
  original). Apply four data sets in a row and the logo box was 36x8 px. The workaround, "the box
  trick": every pixel-slot input in `sources/prepared/` is exactly its slot's size with the art
  fitted inside, plus four 1/255-alpha "bounds keeper" pixels in its corners; a vector mask inset
  2 px on each pixel layer hides them so strokes and shadows never draw around them. So never drop
  an unprepared image into a slot by hand: it fits once and the box shrinks after that. Use
  `prepare()`, or fix the engine (`replace_pixels` in `crates/engine/src/variables_cmds.rs` uses
  `content_bounds()`).
- **`.` becomes `_` in exported names.** File > Export > Data Sets as Files writes `swsh12.5gg` as
  `swsh12_5gg.png`. `render.py` maps them back to set ids.
- **Data-set paths resolve against the document's folder.** A relative pixel path is stored as
  written and resolved, when the data set is applied, against the folder of the open `.pcraft`:
  not the CSV's folder and not the working directory (tested with the CLI, 2026-11-27). So the CSVs
  hold paths relative to `templates/` (`../sources/prepared/...`), which keeps the committed
  templates working from any checkout. `.work/`, where pass 1 is saved, sits beside `templates/`
  for the same reason.
- **`serve` mode refuses `image.applyDataSet`** (it reads ambient file paths, by design). The build
  uses `photocraft-cli run`.
- **Data sets cannot drive layout.** Text does not auto-fit, so a label much longer than today's
  longest ("PIKACHU LIBRE", "YELLOW A ALTERNATE") needs its size adjusted in the template.

## Constraints

- **McDonald's:** never the Golden Arches or any McDonald's artwork, traced or copied
  (2026-08-10, reconfirmed 2026-08-29). The product is named in plain type over the era's TCG
  wordmark; that is all. The printed McDonald's set *symbols* are a separate, approved slot.
- **Trainer kits:** every plate must be visibly distinct. The 2026-08-29 ruling kept the kits as
  text because the only artwork was one generic "Trainer Kit" wordmark shared by four sets, which
  "reads as a bug". Each plate carries its own Pokémon; the owner approved them on 2026-11-27.
- **Inputs only from the app's own image tier** (`/deckpal/images/sets/<id>/logo.webp`,
  `/deckpal/images/sprites/art/<id>.png`), which already serves only approved sources
  (`research/CARD-ART-SOURCES.md`). No new hosts.
- **The Pokémon Company's images are never committed** (2026-07-24, "Sprites are fetched, never
  committed"). They are fetched into gitignored caches and pinned by hash. The committed templates
  embed one example data set's pixels each, and the shipped WebPs are composites, the way the
  bundled 30th Celebration logo is.
- **Source resolution is the ceiling on sharpness.** The Black Star mark on the tier is 200x181
  (upscaled 4x, edges re-hardened); Shining Fates' logo is 357 px wide, Crown Zenith's 564 px at
  best. All are crisp in the 112x64 row slot; a few are slightly soft at 3x in the 290 px set
  header. Re-rendering larger does not help; only a better source does.

## Sources

`sources/tier-sources.json` lists every input with three things: the tier URL it is fetched from,
the upstream URL the API reports the tier filled it from (`logoUrl`, or the pinned
`PokeAPI/sprites` commit for artwork), and the SHA-256 and size of the bytes the tier served on
2026-11-27. `30th` and `30th-c` report no upstream: the catalog has no logo URL for them, and the
tier object's own `image_asset` row is the record of where it came from.

The Black Star mark is derived from `svp`'s tier logo (the shared PROMO star) by `black_star()`.

### Energy rows

`sources/energy-rows/mee.png` and `sve.png` are DeckPal's own drawing: one coin per type, a disc in
the card-sampled colour with a soft radial light and a dark rim, and the glyph in black. The glyphs
are the E2 VectorCraft traces of the printed energy symbols (review folder
`2026-11-27/E2-energy-symbols/svg/`), **not** the CC0 originals `EnergyIcon` draws
(`apps/web/src/components/ENERGY-ICONS-NOTICE.md`). Whether to adopt the traced glyphs as the app's
icons is a separate, open question with the owner, so the SVGs are not committed here; the rows are
rasters inside two set logos, which the owner approved. To redraw a row, copy those SVGs into
`sources/energy-glyphs/`, delete the row's PNG and run the build.

## Output

`ship.py` fits each render inside 870x396 px (the set header's 290x132 CSS box at 3x, which also
covers the series row's 112x64 slot at 3x), never upscaling, and writes WebP: lossy colour at q88,
lossless alpha. The 59 files total about 2.4 MB (22-62 KB each, ~41 KB on average). WebP is what
the image tier serves every other set logo as, and it keeps them out of the PWA precache
(`globPatterns` in `apps/web/vite.config.ts` does not match `.webp`); the service worker caches the
ones a visitor actually sees (`deckpal-set-logos-v1`, `apps/web/src/sw.ts`).
