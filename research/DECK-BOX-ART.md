# Deck-box art for /decks

Design note for the deck tiles on `/decks` (owner feedback 2026-11-27, workstream D).
Code: `apps/web/src/components/deckArt/`. Tests: `apps/web/src/components/__tests__/deckArt.test.ts`.

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

| | Frames | p50 / p95 | Frames > 20 ms | Long tasks | Extra API requests |
|---|---|---|---|---|---|
| `main`, first visit (3 runs) | 358–360 | 16.7 / 16.7–16.8 ms | 1, 0, 1 (one 33 ms frame each) | 0 | — |
| branch, first visit: art derived *during* the scroll (3 runs) | 358–359 | 16.7 / 16.7–16.8 ms | 0, 0, 1 (one 33 ms frame) | 0 | 19 deck details + 61 card lookups |
| `main`, repeat visit | 359 | 16.7 / 16.7 ms | 0 | 0 | — |
| branch, repeat visit (specs cached) | 359 | 16.7 / 16.8 ms | 0 | 0 | 0 |

**What else was measured.**

- **Time to finished art on the first screen:** about 1.15 s after the tiles appear on a
  first visit. On a repeat visit the spec is synchronous, and only the card images load.
- **Layout shift:** CLS is 0 during load and while every tile derives.
- **Accessibility:** axe finds 0 violations in the deck grid.
- **Reduced motion:** 0 animations run in the tiles when their art arrives, and hover
  does not move the cards.

**The bundle**, which loads lazily with the /decks route:

- DecksIndex grew from 18.2 kB to 22.9 kB (5.8 kB to 7.9 kB gzipped).
- A new shared chunk holds the renderer and the rules: 16.6 kB (6.8 kB gzipped). The
  /design gallery shares it.
- The new CSS is 2.5 kB (0.9 kB gzipped).
- That is about **+9.8 kB gzipped for the route**, with no new dependencies.
- The critical path stays at 228.2 kB gzipped before and after.

**What the measurements changed.** The first version cross-faded the palette, animating
registered colour custom properties, and drew the art swatch from an undecoded image.
Under the same profile that cost three frames over 33 ms, one of them 66 ms, and a 52 ms
long task. An animated colour repaints every gradient on the tile on every frame, and
drawImage decodes synchronously. Both are gone: the palette now swaps in one frame, and
the swatch calls `img.decode()` first.

**Caveat.** Headless desktop Chromium with CPU throttling stands in for a mid-range
phone; it is not one. iOS Safari was not measured on a device.

## Where this should end up

`GET /decks` already loads every deck's rows *and* Pokémon types in order to validate
them. Computing the spec there, by moving `derive.ts` server-side unchanged plus one
`card_attack` query, would remove the client's per-deck fetches altogether. That needs
`pnpm dev --local` to exercise, so it was left out of this change (scope: web only).
