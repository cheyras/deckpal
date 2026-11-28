# Energy-type glyphs — source & licence

## What they are

The 11 Pokémon TCG energy-type glyphs in `energyGlyphs.tsx` (Grass, Fire,
Water, Lightning, Psychic, Fighting, Darkness, Metal, Fairy, Dragon and
Colorless) are **traced from the energy symbols printed on Pokémon TCG Energy
cards**. They were traced, and put into the app, at the owner's direction on
**2026-11-27**: *"The energy symbols are perfect. Keep them dark, swap the new
ones in."*

They are **not original work**. They are copies of artwork that belongs to its
rights holders, the ones every card names: © Pokémon / Nintendo / Creatures /
GAME FREAK.

## Where each one was traced from

The card images came from the app's own image tier (`/deckpal/images/en/...`).
Nothing was fetched from anywhere else.

| Type | Traced from | Notes |
|---|---|---|
| Grass | `sve-001` Basic Grass Energy (Scarlet & Violet Energy) | |
| Fire | `sve-002` Basic Fire Energy | |
| Water | `sve-003` Basic Water Energy | |
| Lightning | `sve-004` Basic Lightning Energy | Traced in straight-line mode |
| Psychic | `sve-005` Basic Psychic Energy | |
| Fighting | `sve-006` Basic Fighting Energy | |
| Darkness | `sve-007` Basic Darkness Energy | Mirrored from its left half |
| Metal | `sve-008` Basic Metal Energy | Straight-line mode; mirrored from its left half |
| Fairy | `xy1-140` Fairy Energy (XY) | No modern basic Fairy Energy exists; mirrored from its left half; scaled to 95% |
| Dragon | `xy6-97` Double Dragon Energy (Roaring Skies) | No basic Dragon Energy exists. Gold on a black coin there, drawn as ink here as modern type icons print it; scaled to 88% and centred; the tail rebuilt as one curve where the coin's highlight ate into it |
| Colorless | the attack-cost icon printed on `sv06-130` (Dragapult ex, Twilight Masquerade), cross-checked against `xy1-130` | A regular six-point star, constructed and fitted to that icon (area overlap 0.95) rather than traced point by point |

Mega Evolution Energy (`mee`) prints the same glyphs as `sve`.

**Method.** Each energy sphere's circle was fitted, cropped to a 1024 px
square and thresholded to a mask. The mask was traced with VectorCraft's Image
Trace and simplified at 2 pt tolerance. The area overlap between each final
glyph and its card mask is 0.978–0.996 for the ten traced glyphs. The glyphs
keep the card's own placement and scale inside the disc, except where the table
says otherwise.

## The editable source (outside the repo)

On the maintainer's machine, in the 2026-11-27 design review folder:

```
%USERPROFILE%\Documents\DeckPal Review\2026-11-27\E2-energy-symbols\
  energy-symbols.vectorcraft      the editable master (VectorCraft; a hidden,
                                  locked "Reference (card art)" layer sits
                                  under every glyph)
  svg-glyph-only\<type>.svg       24×24, currentColor, glyph only: what this
                                  file was built from
  svg\<type>.svg                  the same, with a disc
  reference\<type>-reference.jpg  the card crops traced from
  trace-vs-card-reference.png     every glyph laid over its card
  _build\                         the masking, tracing and assembly scripts
```

The folder's `README.md` (one level up) has the full method. These are not
committed, on purpose: they include the card crops.

## What the app does with them

- **Path data.** `energyGlyphs.tsx` holds the `svg-glyph-only` paths, made
  relative and rounded to 0.01 unit of the 24-unit box, one `<path>` per type.
  Rasterised at 960 px, the result differs from the source SVGs by at most
  0.03% of a glyph's pixels.
- **Cut-outs are holes.** Every glyph is filled `evenodd`, so the grass veins,
  the inner flame, the water highlight, the psychic eye and the dragon's mouth
  show the token's own disc.
- **Ink.** The token, not the glyph, picks the colour: dark ink as printed, and
  white on the Darkness disc, which is too dark to carry dark ink
  (`EnergyIcon.tsx`, `data-ink`).
- **Small sizes.** At 14 CSS px and below (the GLC deck-type pills) two glyphs
  drop one detail that is narrower than a pixel there: Grass loses its veins and
  Psychic its iris highlight. Their outlines are unchanged.
  (`ENERGY_GLYPHS_SMALL` in `energyGlyphs.tsx`.)
- **The disc** — colour, raised treatment, Colorless's rim — is ordinary UI
  styling in `EnergyIcon.tsx` and the `.energy-token` rule in `theme.css`. It is
  not traced; its colours were picked to match the printed cards.

## Licence

**There is no licence grant on these shapes.** DeckPal claims no rights in
them, so it cannot give any. They are not CC0, and the repository's AGPL-3.0
does not cover them. They are used to show which energy type a card has, in a
fan-made collection tool, the same way the app shows the card art itself.

If you redistribute or fork DeckPal and need energy glyphs you can license,
replace `energyGlyphs.tsx`. The token does not depend on the shapes.

## History

Until 2026-11-27 the glyphs were **original geometric recreations** drawn for
this project and released under CC0 1.0. Nothing permissively licensed existed
to use instead:

- TCGdex serves no type or energy symbols; its type paths 404.
- The permissive SVG sets on GitHub (`duiker101/pokemon-type-svg-icons`,
  `partywhale/pokemon-type-icons`, both MIT) cover the 18 video-game types, not
  the TCG's energy set.
- `collection-cards/collection.cards` has TCG energy art, but its licence
  resolves to NOASSERTION.

Those original glyphs, and the CC0 grant on them, remain in the git history
(`apps/web/src/components/energyGlyphs.tsx` before this change, and inline in
`EnergyIcon.tsx` before #408). The CC0 grant applied only to them. It
does not carry over to the traced shapes that replaced them.

## Trademark note

"Pokémon", the energy-type names and the energy symbols are trademarks of
Nintendo, Creatures, GAME FREAK and The Pokémon Company. DeckPal is not
affiliated with or endorsed by them.
