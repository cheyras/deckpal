# foil-video-reference - holofoil pattern reference corpus

Source: **[All 39 Pokemon Card Holo Patterns Explained](https://youtu.be/wQ2TvnHVdys)** (Jan 2026) by
**Sleeve No Card Behind** (Sleeve No Card Behind on YouTube / @SleeveNoCardBehind on Instagram; edited by @GabesPC).
All frames, clips, and transcript excerpts here are from that video and are used as
private research reference for building this repo's holofoil shader library
(`apps/web/src/foil/`, branch `foil/main`). Full credit to the creator - if you like
this material, go watch (and like) the video.

## Layout

Each pattern directory holds:
- `frame-01..08.jpg` - 8 keyframes (480px) spanning ONE tilt sweep of a real card/sheet
- `clip.webm` - 2-4s silent 360p clip of the tilt demo
- `notes.md` - chapter timestamps, cards shown, the video's usage claims, transcript excerpt
- `gemini-spec.md` - vision-model analysis of the frames (see `pipeline/`)

`pipeline/` holds the scripts + job files used to produce `gemini-spec.md` via
OpenRouter (google/gemini-3.1-pro-preview); every model call ran as a
verified Ringer task. `_interlude-what-is-a-holo/` is the video's production-physics
segment (transcript only).

The full video and raw VTT captions are NOT committed (media budget); regenerate with
yt-dlp + the scratchpad tooling recorded in DECISIONS.md.

## The 39 patterns (video order)

| Pattern | At | Usage claim (short) |
|---|---|---|
| [Starlight](starlight/) | 0:00 | Base Set, Jungle, Fossil - international (non-Japanese) printings only; Japanese equivalents used Cosmos. |
| [Cosmos](cosmos/) | 0:45 | First on English cards in Base Set 2; WOTC experimented with it earlier (e.g. Fossil cosmos copies given to WOTC employees, non-mainline promos). Japanese Base-era holos used it from the start. Later the dominant promo pattern (see cosmos-ii/iii). |
| [Fireworks](fireworks/) | 1:36 | Legendary Collection (2002, WOTC) only - English-exclusive set; the TCG's first parallel 'reverse' set (every card has a fireworks variant). |
| [Mirror](mirror/) | 2:23 | Introduced with Neo-series Shining cards (subject reflective instead of background); used on and off ever since; also the blank base other patterns are applied over. |
| [Rainbow mirror](rainbow-mirror/) | 2:53 | First widely seen on e-series (Expedition) reverse holos; a staple ever since; the base layer for later overprint patterns (prismatic pokeball, rainbow glitter). |
| [Big glitter](big-glitter/) | 3:19 | Used once: oversized box toppers during the e-series. |
| [Energy symbols](energy-symbols/) | 4:20 | EX Hidden Legends. The first bespoke pattern designed specifically for Pokemon (most TCG patterns are manufacturer stock). |
| [Energy symbols II](energy-symbols-ii/) | 4:54 | EX FireRed & LeafGreen. |
| [Cracked ice](cracked-ice/) | 5:07 | First: Skyridge acrylic oversized box toppers; then FRLG legendary-bird ex promos, POP Series, and for years the theme-deck-exclusive holo (deck-window card). No longer common (theme decks discontinued). |
| [Pinwheel](pinwheel/) | 5:41 | EX Deoxys reverse holos; revived to better effect on recent simplified-Chinese cards. |
| [EX Emerald](ex-emerald/) | 6:10 | EX Emerald only. |
| [Pokeball hologram](pokeball-hologram/) | 6:31 | EX Unseen Forces. A TRUE hologram (not just diffraction foil) - unique in the TCG. |
| [Vertical sheen rainbow](vertical-sheen-rainbow/) | 7:49 | First appearance of a 'sheen' holo: mirror foil + a vertical rainbow band, on a few EX-era sets after Unseen Forces. |
| [Vertical sheen](vertical-sheen/) | 8:20 | The long-running default: HeartGold & SoulSilver era onward - Platinum, Call of Legends, Black & White, into XY. Also the foil under MANY differently-inked reverse holos (see interlude). |
| [Cosmos II / pixel cosmos](cosmos-ii-pixel/) | 11:11 | Introduced in the Platinum series as a denser, more silvery redesign of Cosmos; became THE default promo pattern (tins, blisters, order bonuses). SV era also uses cosmos borders on regular cards. |
| [Cosmos III / smooth cosmos/ hd cosmos](cosmos-iii-smooth/) | 12:34 | Introduced in Legendary Treasures (final BW set); dominant for years; modern promos/blisters now ship in EITHER pixel or smooth variants (master-set chase, e.g. 151). |
| [Tinsel](tinsel/) | 13:24 | Introduced with Black & White (2011) regular holos. |
| [Tinsel II](tinsel-ii/) | 14:02 | Black Bolt & White Flare (2025) only - a resurrection of tinsel for the all-Gen-5 sets. |
| [Diagonal sheen (right)](diagonal-sheen-right/) | 15:12 | First as SECRET deck-exclusive variants (e.g. Battle Arena decks' Moltres EX); then adopted as the default holo for the next few sets (XY era). |
| [Diagonal sheen (left)](diagonal-sheen-left/) | 15:34 | The mirror-image rotation; used heavily on Sun & Moon series reverse holos. |
| [Horizontal sheen](horizontal-sheen/) | 15:49 | Sheen rotated horizontal: the default holo of the Scarlet & Violet series AND the standard holos in the Mega era. ('What a bummer' - creator.) |
| [Striped vertical sheen](striped-vertical-sheen/) | 16:01 | Sword & Shield series regular holos; also some Trick or Trade cards. |
| [Prism](prism/) | 16:28 | Pre-dates the TCG (1996 Carddass prism stickers, ~1 month before the card game); in the TCG proper only on BREAK cards (XY era); not seen since. |
| [Starlight II](starlight-ii/) | 17:19 | XY Evolutions (2016, 20th anniversary Base Set homage). |
| [Water web](water-web/) | 18:13 | Sun & Moon series standard holos and GX cards. |
| [Radiant](radiant/) | 18:28 | Radiant cards across a handful of SWSH sets (Astral Radiance onward). |
| [Rainbow glitter](rainbow-glitter/) | 18:55 | SWSH-era VMAX / rainbow ('hyper') rares and more. |
| [Rainbow glitter sheen](rainbow-glitter-sheen/) | 19:21 | Mega-era Mega EX cards and others. |
| [Ace spec](ace-spec/) | 19:32 | Unique to ACE SPEC cards in the SV era. (BW-era ACE SPECs used plain tinsel.) |
| [Pokeball / masterball](pokeball-masterball/) | 20:11 | Black Bolt & White Flare (2025) brought Japan's poke-ball / master-ball reverse patterns to English. |
| [Prismatic pokeball pattern](prismatic-pokeball/) | 20:20 | Prismatic Evolutions' pokeball pattern - NOT a foil embossing: texture + opaque ink over a rainbow-mirror foil. |
| [Radiant Collection Dots](radiant-collection-dots/) | 20:56 | Radiant Collection (Legendary Treasures / Generations). NOT a unique foil pattern: dot overprint on top of ink + white-ink shape windows (Pikachu heads/hearts/bolts) + plain mirror foil beneath. Some RC cards are non-holo but still carry the dot overprint. |
| [ex starfoil](ex-starfoil/) | 22:15 | SV-era ex cards: dense star pattern printed ON TOP of the face; the foil layer underneath is just diagonal sheen. |
| [Sequin](sequin/) | 22:48 | General Mills cereal-box promos only. |
| [Crosshatch](crosshatch/) | 23:08 | Pokemon League play promos exclusively (Pokemon, trainers, and energy cards); plentiful and affordable on eBay. |
| [TCG classic](tcg-classic/) | 23:47 | Pokemon TCG Classic premium product (Venusaur/Charizard/Blastoise decks) - every card holo, unique pattern. |
| [Confetti](confetti/) | 23:59 | Celebrations (25th anniversary) and EVERY English McDonald's promo set. |
| [Acid wash](acid-wash/) | 24:29 | Pokemon League promos around 2006; energy cards only; short-lived and hard to find. |
| [Disco](disco/) | 25:02 | NEVER officially released - late-'90s factory test pattern; authenticated prototypes exist (CGC / ex-WOTC employees). |

## Vocabulary extensions (2026-08-02, foil/vocab lane)

Four treatments the 39-pattern video does not cover, added for the assignment-swarm
residuals (specs: `../foil-patterns.md` §40-43). Same per-dir layout; frames/clips are
from OTHER creators' tilt footage — full credit to each, go watch their videos:

| Pattern | Source footage | Creator |
|---|---|---|
| [Gold secret](gold-secret/) | [Pokemon TCG Showcase I review Turbopatch Gold Secretrare 200/189 Darkness Ablaze](https://youtu.be/8CvE7sXbJOo) | **M W C G** (YouTube) |
| [VSTAR pearl](vstar-pearl/) | [Pulling Arceus Vstar 123/172 from Brilliant Stars Pokemon TCG](https://youtu.be/wRDwJyv-aP8) | **Ant's Collectables** (YouTube) |
| [Shiny vault](shiny-vault/) | [The Entire History of Shiny Pokémon Cards](https://youtu.be/_cyddOc1SMU) (18:19-19:30) | **Sleeve No Card Behind** — same creator as the 39-pattern video |
| [Detective Pikachu](detective-pikachu/) | [Charizard 5/18 - Pokemon Detective Pikachu](https://youtu.be/WjuDazguHnE) | **Pokemon Holo** (YouTube) |

Their `gemini-spec.md` files were produced by the same `pipeline/` rubric
(`pipeline/jobs/<slug>-vocab.json`); source videos are NOT committed (media budget).

## Synthesis documents

- `../foil-patterns.md` - canonical per-pattern animation/shader specs (video + Bulbapedia reconciled)
- `../foil-pattern-usage.json` - resolver-ready (set/era, rarity) -> pattern mapping with citations
