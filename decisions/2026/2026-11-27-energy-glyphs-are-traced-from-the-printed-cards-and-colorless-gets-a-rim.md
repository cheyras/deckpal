---
date: "2026-11-27"
title: "Energy glyphs are traced from the printed cards, and colorless gets a rim"
decided_by: "Chey (via Claude Opus 5.5)"
areas: ["frontend"]
supersedes: ["2026-07-27 energy glyphs as original CC0 artwork (ENERGY-ICONS-NOTICE.md, fa395cb)"]
---
## 2026-11-27 — Energy glyphs are traced from the printed cards, and colorless gets a rim
**Decided by:** Chey (via Claude Opus 5.5)

**Decision:**
- **The 11 energy glyphs are traced from the printed cards.** `energyGlyphs.tsx` now holds the glyphs traced in the 2026-11-27 design review (E2), in place of the hand-drawn geometric ones.
  - Sources: Grass through Metal from Basic Energy `sve-001`–`sve-008`, Fairy from `xy1-140`, Dragon from Double Dragon Energy `xy6-97`. Colorless is a six-point star fitted to the attack-cost icon on `sv06-130`.
  - The token (disc, colours, raised treatment, ink choice) is unchanged. Ink stays dark, with white on the Darkness disc only.
  - The editable master stays outside the repo, in the maintainer's review folder; `ENERGY-ICONS-NOTICE.md` names it.
- **Cut-outs are holes.** Each glyph is one `evenodd` path in `currentColor`, so the veins, flame, highlights, eye and mouth show the disc itself. `var(--energy)` cut-out paint is no longer used, but the contract still allows it.
- **Path data** is the traced SVGs made relative and rounded to 0.01 unit. Rasterised at 960 px, it differs from the source by at most 0.03% of a glyph's pixels.
- **At 14px and below, two glyphs simplify.** Grass drops its veins and Psychic its iris highlight (`ENERGY_GLYPHS_SMALL`, `SMALL_GLYPH_MAX = 14`). Their outlines are unchanged. Every other type, and every larger size, draws the full trace.
- **Colorless gets a rim.** `.energy-token` gains `inset 0 0 0 1px var(--energy-rim, transparent)`. Only `[data-energy='colorless']` sets `--energy-rim`, to its own colour mixed 70% with black. The rim sits under the specular. It applies in both skins and both top bars, since the token is skin-independent.
- **The licence notice is rewritten.** `ENERGY-ICONS-NOTICE.md` now says the glyphs are traced copies of © Pokémon / Nintendo / Creatures / GAME FREAK artwork, lists the source card per type, and drops the CC0 claim. DeckPal claims no rights in them, so neither CC0 nor the repo's AGPL-3.0 covers them. The earlier original glyphs, and their CC0 grant, stay in git history.
  - `apps/web/public/brand/README.md` said energy symbols were "not drawn, traced or approximated"; it now says they are traced.

**Why:**
- **The owner's call:** *"The energy symbols are perfect. Keep them dark, swap the new ones in."* That settles the open question the review README raised: whether to ship traced TCG marks at all.
- **The old notice would have become false.** It said the glyphs were original, "not copied, traced, or extracted", and released CC0. Shipping traced shapes under that text would claim rights the project does not have.
- **Small sizes:** captured at 1x, a 13–14px Grass token's vein cut-outs fall under a pixel and read as noise. Psychic's eye blurs into a smudge of rings. Dropping one detail makes both read as a leaf and an eye again. Fighting, Fire and Metal stay legible at 13px, so they keep the full trace. 13–14px is only the GLC deck-type pills (`DecksIndex`, the deck header).
- **The rim:** the review sheet showed the Colorless disc vanishing on light grounds. In the app it can sit on light deck art (the `DecksIndex` pill) or a pale card scan. Its lit face is lighter than those, and the 0.5px ring alone was a hairline. On dark surfaces the rim reads as a coin edge.

**Implications:**
- **Do not describe the energy glyphs as original or CC0** anywhere: docs, credits or a licence file. A fork that needs licensable artwork has to replace `energyGlyphs.tsx`.
- **The size threshold is CSS px, not device pixels.** A 13px Grass token on a 3x phone also draws the simplified leaf. That was accepted as the simpler rule. If it ever matters, the choice belongs in `energyGlyphs.tsx`, not the token.
- **New uses of `EnergyIcon` at 14px or below** get the simplified Grass and Psychic automatically.
- **Other tokens can opt into a rim** by setting `--energy-rim`. No other type needs one today: Metal, the next palest, reads clearly against white in the captures.
- **`energyToken.test.ts` now also pins** that every glyph path is `evenodd` and that Colorless has its rim.
