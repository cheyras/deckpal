# Energy-type icons — source & license

The 11 Pokémon TCG energy-type glyphs rendered by `EnergyIcon.tsx`
(Grass, Fire, Water, Lightning, Psychic, Fighting, Darkness, Metal, Fairy,
Dragon, Colorless) are **original geometric recreations** authored for this
project. They are hand-written inline SVG paths — not copied, traced, or
extracted from any third-party asset set, game rip, or scan.

## Why they are original (research trail)

Investigated, in the order the task prescribed:

1. **TCGdex assets** (`assets.tcgdex.net`) — our existing card-image source.
   Probed the likely type/energy paths (`/en/types/<t>.png|webp`,
   `/types/...`, `/univ/types/...`) for fire/water/grass/lightning: **all 404**.
   TCGdex does not serve type/energy symbols. Rejected.
2. **Permissive SVG sets on GitHub** — `duiker101/pokemon-type-svg-icons` (MIT)
   and `partywhale/pokemon-type-icons` (MIT) both ship only the **18 video-game
   types** (bug, electric, flying, ground, …). They do **not** contain the TCG's
   distinct energy set (`colorless`, `darkness`, `lightning`, `metal` are
   TCG-specific and absent). Not a match. Rejected.
3. **`collection-cards/collection.cards`** — an open-source TCG-database clone
   that does have TCG energy art, but its license resolves to **NOASSERTION**
   (no clear grant). Not redistributable. Rejected.

UI-SPEC §1.3 explicitly anticipated this: *"we should ship our own 11 energy
glyphs as SVG."* So the glyphs here were authored from scratch.

## License

Released into the **public domain under CC0 1.0**
(<https://creativecommons.org/publicdomain/zero/1.0/>). No rights reserved on
the glyph artwork in `EnergyIcon.tsx`.

## Trademark note

"Pokémon" and the individual energy-type *concepts* are trademarks of Nintendo /
The Pokémon Company. These glyphs are original artwork evoking those types for a
personal, non-commercial, self-hosted project (same posture as the card art);
the CC0 grant covers our artwork/code only, not any third-party trademark.
