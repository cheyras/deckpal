# Deck-box art for /decks

Design note for the deck tiles on `/decks` (owner feedback 2026-11-27, workstream D).
Code: `apps/web/src/components/deckArt/`. Tests: `apps/web/src/components/__tests__/deckArt*.test.ts`.
Art library: `tools/deck-art/` (prompts and pipeline) and `apps/web/src/components/deckArt/art/`
(the shipped files and `MANIFEST.json`, their provenance).

This note has two parts:
- **Pass 1** (everything up to "Pass 2") chose the structure, the derivation rules and the
  data path. All three still stand.
- **Pass 2** (at the end) replaced pass 1's painted SVG motifs with generated artwork, and
  added the deck's name on the box. Where pass 1 below describes motifs, read pass 2.

## The brief

Each tile used to show a cropped strip of one card. That card was the alphabetically
first Pokémon unless a cover had been set, and the web app has no way to set one. The
owner wants the tile to say what the deck is:

- **The box:** a small 3D deck box, with graphics driven by the deck's contents.
- **The cards:** the main attackers, standing in front of the box.
- **The energy:** the deck's energy types, printed on the box.
- **The art:** our own abstract artwork on the box, coloured by the deck.
- **The backdrop:** a studio backdrop, also coloured by the deck.

It must look good, must not slow the page, and nothing about it may look broken.

## What others do

- **Pokémon TCG Live.** Each deck has a cosmetic deck box (with sleeves and a coin),
  shown before each game. The Decks screen is a grid of those boxes, each with an energy
  symbol. This is the owner's reference, but the box is a purchased skin, so it says
  nothing about the cards inside.
  [Bulbapedia](https://bulbapedia.bulbagarden.net/wiki/Pok%C3%A9mon_TCG_Live),
  [gameplay items](https://bulbapedia.bulbagarden.net/wiki/List_of_Pok%C3%A9mon_Trading_Card_Game_Live_gameplay_items).
- **MTG Arena.** A deck is a box with the deck's chosen card art on it. The sleeve
  "pops out slightly from behind the deck box". That layering (a box, with a card in front
  of or behind it) is the composition used here.
  [Draftsim on Arena sleeves](https://draftsim.com/mtg-arena-sleeves/),
  [MTG wiki](https://mtg.wiki/page/Magic:_The_Gathering_Arena/Sleeves).
- **Legends of Runeterra.** The deck shows a champion's art and its region icons. Players
  noticed that the cover defaults to the deck's most powerful champion. Region icons are
  Runeterra's version of energy types: this is the closest prior art for deriving "who the
  deck is about" and "which colours it plays" from the list.
  [LoL wiki: Deck](https://leagueoflegends.fandom.com/wiki/Deck_(Legends_of_Runeterra)).
- **Hearthstone and Marvel Snap.** A Hearthstone deck tile is the class portrait and a
  Marvel Snap deck has a per-deck card back. Both are identity by cosmetic choice, not by
  contents.
  [Hearthstone collection manager](https://hearthstone.wiki.gg/wiki/Collection_manager),
  [Marvel Snap card backs](https://www.ginx.tv/en/marvel-snap/card-back).
- **Product photography.** The "studio backdrop" is a cyclorama (a sweep). A seamless
  curve hides the horizon line, and the background takes a gradient from light falloff.
  A coloured light, not a coloured wall, gives the mood.
  [Cyclorama](https://www.photographytalk.com/photography-articles/6535-what-a-cyclorama-is-and-why-you-need-one),
  [falloff gradients](https://www.photographytalk.com/photography-articles/6332-pro-tip-how-to-use-light-falloff-for-great-gradient-backgrounds).

The gap is that every game makes the box a skin the player picks. Nobody derives it
from the cards, which is the owner's ask and the thing a deck *list* page needs.

## Rendering: options compared

The page renders 16 or more of these at once, in a scrolling grid, on phones.

| | Per-frame cost while scrolling | Memory, battery | SSR / PWA | Reduced motion | Degrades to |
|---|---|---|---|---|---|
| **CSS 3D transforms** (`preserve-3d` box faces) | Composited, so cheap, but every face is its own GPU layer | 3–5 layers per tile at DPR 3. iOS Safari has crashed on layer counts like this ([dev.to](https://dev.to/ouvarov/i-crashed-a-mobile-browser-with-one-css-property-heres-what-i-learned-about-rendering-3o53), [web.dev](https://web.dev/articles/stick-to-compositor-only-properties-and-manage-layer-count), [Smashing](https://www.smashingmagazine.com/2016/12/gpu-animation-doing-it-right/)) | Fine | Fine | Flicker and z-fighting on old WebKit |
| **One shared WebGL canvas** (three.js, scissor per tile, [manual](https://threejs.org/manual/en/multiple-scenes)) | Has to redraw every visible view every scroll frame to track the DOM; iOS lags the canvas a frame behind the page | GPU busy while scrolling; ~150 kB gz of three on this route; context loss to handle ([views vs canvases](https://discourse.threejs.org/t/canvases-vs-views/55858)) | Needs a non-WebGL fallback anyway | Fine | A second renderer to maintain |
| **Pre-rendered bitmap per deck** (canvas, cached by deck hash) | Cheapest once cached: one `<img>` | One blob per deck per DPR in storage; first render ~20–40 ms per tile on a phone; card art re-encoded | Worker + cache plumbing | n/a | Stale art if invalidation slips |
| **SVG + DOM, painted "3D"** (chosen) | None: static painted content, scrolling is compositor-only | No extra layers; ~150 DOM/SVG nodes a tile; a ~400-byte spec per deck in localStorage | Plain markup | Garnish motion only, removed by the media query | The same box, neutral, with card backs |

**The choice is SVG + DOM.** The box is three flat polygons in one inline SVG. The view
is an oblique three-quarter view in which the front face is drawn square-on. That is the
trick that keeps it cheap: the artwork, the label band and the energy icons sit on an
untransformed rectangle. The side and the lid are plain polygons with gradient fills, so
there is nothing to texture or transform. The same technique dates back to the
[Mozilla isocube](https://hacks.mozilla.org/2009/06/3d-transforms-isocube/).

Lighting is painted in from one key light at the upper left:

- the lid is the brightest face and the side the darkest;
- the front shades down to the right, with a gloss streak;
- every edge that catches the light gets a hairline highlight;
- a same-colour round-joined stroke softens the folds.

The cards are real `<img>` elements, so they get native lazy loading, async decode and
the app's existing direct-Storage-then-image-tier fallback. The studio is CSS gradients:
a sweep, a coloured key light behind the box, a floor pool and a vignette.

Nothing animates continuously. Scrolling repaints nothing, and off-screen tiles skip
rendering entirely ([`content-visibility: auto`](https://web.dev/articles/content-visibility)).
The art box has a fixed `aspect-ratio`, so skipped tiles keep their size and nothing
shifts. All sizes are in container units of the art box, so no script measures anything.

## Deriving the art from the deck

`derive.ts` is pure and deterministic, and is unit-tested.

- **Featured cards (the main attackers).** Every Pokémon in the list is a candidate, with
  printings folded by name. Each candidate is scored on six things:
  - **copies in its evolution line:** a pre-evolution counts half, and is then never
    featured itself;
  - **stage:** Stage 2 > VSTAR/VMAX/Mega > Stage 1 > Basic;
  - **rule box:** ex/V/GX and similar;
  - **best printed damage:** with `+` and `×` scaled up, and the factor compressed so a
    3–3 line beats a one-copy tech;
  - **whether the deck's energy pays that attack:** this is what puts Charizard ex ahead
    of the Pidgeot ex that searches for it;
  - **strategy-guide mentions:** how often the deck's guide names the card.

  An Ability-led Pokémon whose attack does under 90 damage is marked as engine, not
  attacker. A second card is shown only when it scores at least half of the first.
- **Energy types.** Energy cards count once per copy, by the type named on the card;
  untyped special energy counts nothing. The featured attackers' attack costs count twice
  per symbol, and the main attacker's best attack counts again. That is why Raging Bolt
  reads Lightning/Fighting before the Grass it runs for Ogerpon. Other Pokémon's costs are
  ignored. A GLC deck's declared type always leads. A deck that pays only Colorless shows
  Colorless. Up to three types are kept.
- **Palette** (in OKLCH, so that "lightness 0.5" means the same thing for every hue):
  - **The box** is the leading type's colour.
  - **The motif** is printed in the deck's *other* colours: the second type, then the
    main attacker's art. A colour too close to the box's, or one that would turn brown
    when darkened on a pale box, is skipped for a tonal shade.
  - **The studio** is a near-neutral dark sweep lit by a key light in the art's colour.
- **The art colour** is one swatch sampled from the main attacker's artwork window, from a
  20×16 downscale of the image the tile shows anyway. It is a chroma-capped hue histogram,
  so a large teal sky outvotes a small red flame. It is snapped to a 15° and 0.02-chroma
  grid so that two browsers' decoders agree on it.
- **The motif** family follows the leading type:
  - rays for Fire and Lightning;
  - flowing bands for Water, Grass and Fairy;
  - ringed-planet orbits for Psychic, Darkness and Colorless;
  - cut facets for Fighting, Metal and Dragon.

  It is laid out by a seeded PRNG keyed on the deck id, so a deck keeps its own pattern
  across edits.

## Getting the data without slowing the page

`GET /decks` returns summaries only, so a tile needs the deck's cards (`GET /decks/:id`).
It also needs catalog facts for its top four candidates (`GET /cards/:id`), because the
deck rows carry no types or attacks. These steps keep that cost off the page:

1. **A finished spec is cached on the device**, keyed by deck id, version, updated-at,
   card count and `DERIVE_VERSION`. A repeat visit renders the final art synchronously,
   with zero extra requests. The cache is pruned to the current deck list and cleared on
   sign-out.
2. **Otherwise the tile waits** until it is within 400 px of the viewport. One shared
   IntersectionObserver serves all tiles.
3. **Then it queues** behind a page-wide limit of two decks at a time. It fetches through
   the app's own query cache, on the same `['deck', id]` and `['card', id]` keys the deck
   page and card sheet use. Opening a deck afterwards is instant, and a card shared
   between decks is fetched once.
4. **While it waits**, the tile shows the box in neutral stock with two blank card backs.
5. **A finished spec waits for the scroll to rest** (160 ms of quiet, capped at 3 s)
   before it renders, so a tile never repaints its scene under a moving finger. Then
   the cards rise in. That is opacity plus translate: compositor only, and off under
   reduced motion.
6. **A degraded spec is shown but not cached.** That is one built after a card lookup
   failed or the art could not be read, which would pin this device to colours another
   device would not derive. It is retried on the next visit.

## Measured (2026-11-27)

**The setup.**

- **Builds:** production cloud builds of `main` and of this branch, compared under the
  same conditions.
- **Browser:** Playwright Chromium at 390×844 @3x with mobile emulation, CPU slowed 4×,
  network at 1.6 Mbps with a 150 ms round trip. Service workers were blocked.
- **Data:** 20 realistic decks (Charizard, Dragapult, Gardevoir, Raging Bolt, Lugia, GLC,
  an empty deck and others). Card ids, stages, attacks and art are the live public
  catalog. The API was answered locally, with 120 ms added latency.
- **The scroll:** scripted top → bottom → top over 6 s, recording every frame interval
  with requestAnimationFrame.

The final runs compare `main` at f65877a with this branch, interleaved:

| | Frames | p50 / p95 | Frames > 20 ms | Long tasks | Extra API requests |
|---|---|---|---|---|---|
| `main`, first visit (4 runs) | 357–360 | 16.7 / 16.7–16.8 ms | 1, 0, 1, 0 (one 33 ms and one 50 ms frame) | 0 | — |
| branch, first visit: art derived *during* the scroll (4 runs) | 360 | 16.7 / 16.7 ms | **0, 0, 0, 0** | 0 | 19 deck details + 61 card lookups |
| `main`, repeat visit | 360 | 16.7 / 16.8 ms | 0 | 0 | — |
| branch, repeat visit (specs cached) | 360 | 16.7 / 16.7 ms | 0 | 0 | **0** |

(Before the scroll-rest deferral, the branch's first visit dropped 0–3 single 33 ms
frames per run. That is the same range as `main`, but it is why new art now waits.)

**What else was measured.**

- **Time to finished art on the first screen:** about 1.1 s after the tiles appear on a
  first visit. On a repeat visit the spec is synchronous, and only the card images load.
- **Layout shift:** CLS is 0 during load and while every tile derives.
- **Accessibility:** axe finds 0 violations in the deck grid.
- **Reduced motion:** 0 animations run in the tiles when their art arrives, and hover
  does not move the cards.

**The bundle**, which loads lazily with the /decks route:

- DecksIndex grew from 18.2 kB to 23.4 kB (5.8 kB to 8.1 kB gzipped).
- A new shared chunk holds the renderer and the rules: 16.6 kB (6.8 kB gzipped). The
  /design gallery shares it.
- The new CSS is 2.4 kB (0.9 kB gzipped).
- That is about **+10 kB gzipped for the route**, with no new dependencies.
- The critical path stays at 228.2 kB gzipped before and after.

**What the measurements changed.** The first version cross-faded the palette, animating
registered colour custom properties, and drew the art swatch from an undecoded image.
Under the same profile that cost three frames over 33 ms, one of them 66 ms, and a 52 ms
long task. An animated colour repaints every gradient on the tile on every frame, and
drawImage decodes synchronously. Both are gone: the palette now swaps in one frame, the
swatch calls `img.decode()` first, and new art waits for the scroll to rest.

**Caveat.** Headless desktop Chromium with CPU throttling stands in for a mid-range
phone; it is not one. iOS Safari was not measured on a device.

## Where this should end up

`GET /decks` already loads every deck's rows *and* Pokémon types in order to validate
them. Computing the spec there, by moving `derive.ts` server-side unchanged plus one
`card_attack` query, would remove the client's per-deck fetches altogether. That needs
`pnpm dev --local` to exercise, so it was left out of this change (scope: web only).

---

# Pass 2: generated artwork and the deck's name (2026-11-27)

## The ask

The owner reviewed pass 1 ("a good start") and asked for two things.

**Generated treatments for the art and the backdrop.** These should be "more complex",
with enough of them that decks "feel varied just based on what's in the deck, what type
of deck it is", and with colour filters run over them. They were to be made with the
Codex CLI.

**The deck's own name on the box.** It should use "some canonical text treatments of
different kinds… so it just looks super cool".

## The art library: a system, not a pile of images

The library has two layers. Each layer has families, and each family has several variants.

| Layer | Family is chosen by | Families | Variants | Images |
|---|---|---|---|---|
| Box panel | the deck's leading **energy type** | 11 (one per type, in that type's shape language: flame, wave, leaf, bolt, op-art rings, rock strata, smoke, steel, lace, scales, tessellation) | 3 | 33 |
| Studio | the deck's **style** (how it plays) | 5: `spotlight` (power), `gobo` (engine), `canvas` (control), `bokeh` (swarm), `sweep` (balanced) | 4 | 20 |

**Choosing a deck's art.** The variant is picked by the deck id's hash, so two Fire decks
print different Fire panels, and each deck keeps its own panel for life.

**Deck style.** Style comes from `derive.ts` `deckStyle()`. The rules are checked in order:

| Style | Rule |
|---|---|
| control | the deck runs at most 4 energy cards |
| swarm | nothing featured has a rule box (a single-prize deck) |
| power | the main attacker is a rule-box Pokémon hitting for 200 or more |
| engine | the main attacker is a Stage 2 |
| balanced | anything else |

Style also picks the title treatment, and power decks get a holographic foil sheen on the
panel.

**Why 53 images is enough.** The count is set by what a grid needs.
- Every energy type and every style has at least three choices. A user with four Fire
  decks therefore sees at most one repeated panel, and the studio and title vary
  independently of the panel.
- Combined with 7 title treatments and a palette that varies continuously (from the energy
  types and the attacker's art), two decks of the same type and style still differ in
  2–3 of four visible dimensions.
- More variants would add bytes to the library and to the asset map, but little visible
  variety per user.

**Recolouring.** Every image is generated and shipped **grayscale**, and the app recolours
it per deck with a **gradient map**. That is an SVG `feComponentTransfer` whose tables run
from the darkest palette stop to the lightest:
- **Box panel:** shadow → box colour → highlight, where the highlight is the second
  energy type or the attacker's art if lighter, else a light tint of the box.
- **Studio:** near-black → tinted wall → the key light in the art's colour.

This was chosen over the alternatives:
- **CSS `hue-rotate`** cannot colourise gray.
- **A blend-mode tint** (`luminosity`) gives a single hue, not a two-tone scheme.
- **Baking tinted copies** cannot cover a continuous palette.

The stops are tested to climb in lightness (a map that doesn't climb solarises the image).
One image therefore serves every colour a deck can be.

**Prompt approach.** Each prompt is a shared rule block for the layer plus a one-line
subject (`tools/deck-art/library.mjs`).
- **Box rule block:** grayscale; full tonal range for the map; packaging-print quality;
  full-bleed with even density so any crop works.
- **Studio rule block:** an empty product-photography set; floor in the lower third; key
  light at upper right; mid-to-dark tones.
- **Both:** no text, letters, numbers, logos, people, creatures, Pokémon or recognisable
  characters. The tests check every shipped asset's prompt carries that rule.

**Provenance.** Each shipped file is listed in
`apps/web/src/components/deckArt/art/MANIFEST.json` with:
- its prompt and subject;
- the tool (Codex CLI 0.154.0, `codex exec`), the model (`gpt-6-astra`) and Codex's image
  tool;
- the generation time;
- the source dimensions and SHA-256;
- every processing step;
- every output's real size in bytes.

A test fails if a shipped file is missing from the manifest, or its bytes have drifted.
Raw generations stay out of the repo (`.deck-art-raw/` is gitignored).

**Processing** (`tools/deck-art/process.mjs`):

| | Box panel | Studio |
|---|---|---|
| Crop | centre, to the face's 88:120 | centre, to 16:9 |
| Colour | grayscale | grayscale |
| Levels | normalised (0.5–99.5th percentile) | normalised (0.5–99.5th percentile) |
| Blur | — | light blur (a defocused set, and noise costs bytes) |
| Sizes | 104 / 208 / 312 px wide (1x/2x/3x of a phone tile's face) | 400 / 800 px (1x/2x) |
| WebP quality | 76 / 70 / 60 (denser screens hide compression in smaller pixels) | 66 / 62 |

3x screens use the studio's 2x file. The studio is soft by design, and 1200 px would cost
about 70% more bytes for detail it does not have.

**Weight budget**, and the actual figures:

| | Budget | Actual |
|---|---|---|
| Whole library, all densities | ≤ 1.5 MB on disk | **1.36 MB** |
| Box panel, 3x | — | median 19.5 kB, max 41.9 kB |
| Box panel, 2x | — | median 11.2 kB |
| Studio, 2x | — | median 3.8 kB |
| Per tile, 3x phone | ≤ 30 kB | **about 25 kB** |
| Per tile, 2x | — | about 17 kB |
| Per tile, 1x | — | about 6.6 kB |

A tile's two card images weigh more than its art.

**How the art loads.**
- The files are imported through Vite (`artAssets.ts`, `import.meta.glob` with
  `?no-inline`), so they ship as hashed `/assets/` files with a year's immutable cache, and
  a missing file fails the build.
- WebP is outside the service worker's precache globs, so nothing is downloaded until a
  tile within 400 px of the viewport asks for its two images.
- For a freshly derived deck, the two images are fetched and decoded before the spec lands,
  so the tile paints dressed in one go.

## The deck's name on the box: seven title treatments

**References.**
- **Hot-foil stamped titles** on premium packaging: most printed card products foil-stamp
  their title, sometimes with emboss. https://printninja.com/foil-stamping/
- **Athletic jersey lettering**, for the condensed, heavy, outlined look.
- **Eighties chrome logo lettering**: a gradient split hard at the horizon, a heavy
  keyline, and extrusion. https://blog.spoongraphics.co.uk/tutorials/videos/video-tutorial-80s-style-chrome-text-effect-in-photoshop
- **Stencilled crate and label-tape typography.**
- **Editorial serif labels** between fine rules.
- **The trading-card set logo lockup:** chunky letterforms with a coloured outer ring and a
  dark keyline.

| Treatment | Look | Legibility device |
|---|---|---|
| `foil` | Fraunces caps, metallic gradient, debossed shadow | dark printed plate with an inset keyline |
| `varsity` | Figtree 900, condensed, slanted, a bar beneath | thick outline in the deck's darkest shade, drop shadow, soft scrim |
| `outline` | screen-print: dark caps, light keyline, offset accent shadow | soft plate |
| `stencil` | caps cut by a stencil bridge, on askew label tape | the tape is the plate |
| `serif` | mixed-case Fraunces between rules ending in lozenges | soft plate |
| `arcade` | slanted chrome caps, stepped extrusion | heavy keyline, scrim |
| `crest` | chunky soft Fraunces, accent ring and dark keyline | outlines and drop shadow, scrim |

**Choosing a treatment.** The treatment comes from the deck's style: power decks get
arcade, varsity or crest; control decks get serif, foil or stencil; and so on. The deck's
hash picks within that list, so a grid of same-style decks mixes two or three looks
(`TREATMENTS_FOR_STYLE`, which is tested).

**Fonts.** No new font files are loaded. The treatments use the app's own Fraunces and
Figtree variable fonts, which are already on the page, plus SVG effects.

**Fitting** (`title.ts`, pure and unit-tested):
1. **One line** while it can print at 62% or more of the treatment's largest size.
2. **Otherwise, wrap.** Binary-search the largest size at which a greedy wrap fits in 2 or
   3 lines, and take the fewest lines within 15% of the best size.
3. **Words stay whole** unless a single word cannot fit at all. "CHARIZAR / D PIDGEOT" is
   the bug this rule exists to prevent; it is tested.
4. **CJK** breaks between characters, and an emoji (even a ZWJ sequence) is one grapheme.
5. **Over-long names** print at the minimum size, with the last line clamped by an
   ellipsis. The maximum is 120 characters, and every length up to it is tested for every
   treatment.

**What fitting costs.** Nothing per frame:
- Text is measured with a canvas `measureText` (no layout).
- Each (name, treatment) pair is measured once and cached.
- Lines are drawn with SVG `textLength`, so the printed width is exactly the measured
  width. A glyph rendered a hair wider than the canvas predicted can never overflow.
- If a font had not loaded when a name was measured, the title is re-fitted once
  `document.fonts.load` resolves.

**Accessibility.** The whole scene is `aria-hidden`, and the title is unselectable
decoration. The tile's heading keeps the real name for screen readers and selection.

**Loading state.** No title is printed while a deck's art is still being derived. The
treatment depends on the deck's style, and a title that changed typeface on arrival would
read as a glitch, so the blank neutral box with card backs is the loading state. An empty
deck prints its name in the `balanced` treatment.

## Quality pass

- **The box** is slightly smaller and lower (face 88×120 at y 38), so the lid no longer
  touches the Format chip on a phone.
- **The cards** stop short of the title zone, so a name is never hidden behind a card.
- **The side face:** the panel art wraps round onto it through an affine transform, under a
  deeper shade, so the box reads as one printed object.
- **Scrims:** title treatments without a printed plate get a soft scrim, so a light letter
  never sits on a light patch of a busy panel. The `arcade` keyline is heavier, and the
  `power` holo sheen is toned down.
- **Neutral types** (Metal, Colorless without art): the studio uses the box's chosen steel
  hue rather than the type colour's noise hue, which had tinted Metal studios green.
- **Motion** now uses the design system's tokens (`--duration-*` and `--ease-*`, from #410).
- **`content-visibility: auto` is gone.** In pass 1 it was free. With generated art and a
  typeset title on every box, it made Chrome lay out and paint each tile in the very frame
  it scrolled into view.
  - **Measured on the throttled profile:** 3–7 dropped frames per scroll with it, against 0
    once it was gone and idle dressing (next bullet) was in place.
  - **What replaced it:** every tile is laid out and painted once, and scrolling is
    compositor-only again. Only the images stay lazy, requested near the viewport.
  - **What it costs:** the grid's first render is a little heavier (measured below as
    load long tasks), in exchange for smooth scrolling.
- **Idle dressing.** Only the first six tiles draw their title and artwork in the first
  render. The rest are dressed two at a time in idle callbacks, never mid-scroll, nearest
  first. Until a tile is dressed, it shows its colours, box and cards.

## Measured (pass 2)

The same protocol as pass 1:
- **Builds:** production cloud builds of `main` (50c93eb), pass 1 and pass 2, run interleaved.
- **Browser:** 390×844 @3x, CPU 4× slower, 1.6 Mbps with a 150 ms round trip.
- **Data:** 20 decks.
- **The scroll:** top → bottom → top over 6 s.

**Frames over 20 ms** (each run had p50 16.7 ms and p95 16.7–16.8 ms):

| | First visit (4 runs) | Repeat visit |
|---|---|---|
| `main` | 2, 1, 1, 2 | 0 |
| pass 1 | 0, 0, 0, 1 | 0 |
| pass 2 as first built (generated art + titles, still with `content-visibility`) | 14, 23, 12, 10 | 10 |
| **pass 2, final** | **0, 0, 0, 0** | **0, 0** |

**Long tasks during the scroll:**

| | First visit | Repeat visit |
|---|---|---|
| `main` | 0–1 | 0 |
| pass 1 | 0 | 0 |
| pass 2 as first built | 1–6, max 83 ms | 1, 52 ms |
| **pass 2, final** | **0** | **0** |

**Longest task while the grid first renders:**

| | First visit | Repeat visit |
|---|---|---|
| `main` | 166–207 ms | 60 ms |
| pass 1 | 161–276 ms | 106 ms |
| pass 2 as first built | 206–231 ms | 259 ms |
| **pass 2, final** | 189–236 ms (one 360 ms outlier) | 134–162 ms |

**Blocking time while the grid first renders** (repeat visit): `main` 10 ms, pass 1 56 ms, pass 2 as first built 263 ms, **pass 2 final 84–112 ms**.

**Other measurements (pass 2, final):**
- **Art fetched** while scrolling all 20 decks: about 340 kB on a first visit (25 files at 3x) and 388 kB on a repeat visit. In each case that is only the tiles that came near the viewport.
- **Time to the first screen's finished art:** about 1.3–1.7 s after the tiles appear on a first visit. The panel and studio are preloaded with the spec.
- **Layout shift:** CLS 0.
- **Accessibility:** axe finds 0 violations.
- **Reduced motion:** 0 animations, and no hover movement.

**What got pass 2 back to pass 1's smoothness.** Three changes, each found with a Chrome trace of the throttled scroll:
1. **`content-visibility` came off.** It made each tile's layout and paint happen in the frame the tile scrolled into view. Layout was 437–698 ms over a 6 s scroll, against 285 ms for pass 1.
2. **Idle dressing.** Only the first six tiles draw their title and artwork in the first render. The rest are dressed two at a time in idle callbacks, never while the page is scrolling, nearest tiles first.
3. **The arrival of freshly derived art waits for the scroll to rest.** The cap went from 3 s to 8 s, so even a long fling never commits a new tile mid-scroll.

**Bundle** (lazy /decks route): DecksIndex 24.2 kB (8.5 kB gz) and the shared DeckBox chunk 37.4 kB (12.4 kB gz: renderer, title fitter and the 140-entry art URL map), CSS 2.6 kB (0.9 kB gz). That is +16 kB gz over main (pass 1 was +10 kB). The critical path is unchanged at 222.8 kB gz.

## What Codex could not do

- **Use its configured default model.** `gpt-6.2-sol` is not available to a ChatGPT
  account. The generator passes `-m gpt-6-astra` and `--ignore-user-config`, which also
  skips an unrelated MCP server that failed to authenticate.
- **Write into the repo from its sandbox on Windows.** It saves under
  `~/.codex/generated_images/<session>/`, reports the paths, and `generate.mjs` copies
  them.
- **Honour exact sizes.** Squares come back at 1254 × 1254, and 3:2 landscapes at
  1536 × 1024. The processor crops to the app's own aspect ratios, so this costs nothing.
- **Reproduce a result.** There is no seed, so re-running a prompt gives a different
  image. The shipped files and their SHA-256 hashes in the manifest are the record.
