---
name: sim-card
description: Implement (script) a Pokémon TCG card for DeckPal's battle simulator (`packages/sim`, `@deckpal/sim`). Use whenever asked to "implement a card", "script a card for the simulator", "add a card script", "cover the gauntlet decks", fix a card that plays wrong in the sim, or extend the card DSL. It covers gap analysis, writing a CardScript from printed text only, the scenario test, the text round-trip check, and rulings.
---

# sim-card: make a card playable in the simulator

The full guide is **`packages/sim/CARDS.md`**. Read it before you write a script.
It holds the loop, the clause catalogue with real examples, statics, triggers and
timed effects, reprint keys, data quirks, the escape-hatch policy, licensing and
the test helpers. This file only points you at it.

## The loop (details in CARDS.md)

1. **Gap analysis.** `node --import tsx scripts/coverage.ts` (run from `packages/sim`) lists cards without a script.
2. **Vocabulary.** Compose the clauses in `src/dsl.ts`. A new clause is engine code: it needs a test, a rendering in `src/cards/render.ts`, and a flag for review.
3. **Script.** Write it from the printed text in `src/cards/frames.ts` **only**, in your lane's `src/cards/scripts/*.ts`, with each printed sentence quoted above the clause that implements it.
4. **One scenario test** per card (`scenario()` plus the `choose`/`pick`/`yes` helpers in `src/__tests__/cards.test.ts`).
5. **Round trip.** `node --import tsx scripts/roundtrip.ts <id|name>` must show no structural problems. Justified exceptions go in `ROUNDTRIP_ALLOW`, with a reason.
6. **Rulings.** Cite the source, or set `status: 'needs_ruling'` with the question in `notes`.

## Commands (from `packages/sim`)

```bash
node --import tsx scripts/coverage.ts
node --import tsx scripts/roundtrip.ts <id or name>     # add --problems to list only failures
node --import tsx --test src/__tests__/*.test.ts
npx tsc --noEmit -p .
```

## Hard rules

- Card text is the only specification. No twinleafgg code, and no Kaggle or cabt competition material. ryuu-play (MIT) ideas are fine, with credit.
- Fix catalog errors on the script (`fix.specialEnergy`, `fix.tera`, `fix.aceSpec`), never in the generated `frames.ts`.
- Use `custom` (`src/customs.ts`) only for genuinely bespoke effects. Give it a `CUSTOM_GLOSS` written from the function's code, plus its own card test.
