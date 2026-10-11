# Data diff: catalog frames against pokemon-tcg-data

Every printed frame the simulator snapshots (`src/cards/frames-all.ts`: DeckPal
catalog, derived from TCGdex) is compared with a second database that was built
independently, the open [PokemonTCG/pokemon-tcg-data](https://github.com/PokemonTCG/pokemon-tcg-data)
repo (MIT, `cards/en/<setId>.json`). When both sources say the same thing, the
frame is almost certainly right. When they disagree, the engine has to be told
which one is correct.

```bash
cd packages/sim
node --import tsx scripts/data-diff.ts          # grouped report; exits 1 on an open disagreement
node --import tsx scripts/data-diff.ts --json
node --import tsx scripts/data-diff.ts --refresh  # refetch the cached set files
```

The set files are cached in `packages/sim/.cache/ptcg-data/`, which the repo-wide
`.cache/` rule already ignores. `PTCG_DATA_REF` pins a commit.

## Run of 2026-10-10

Source: pokemon-tcg-data `master` @ `39a26a14` (2026-09-17).

- **172 frames, 172 compared, 1,734 field checks.** 166 matched directly by set
  and number. 6 had no entry at that number and were matched to a reprint with
  the same name and the same attack names:

  | Frame | Matched to | Why |
  |---|---|---|
  | mee-002 Fire Energy | sve-2 | Mega Evolution Energies (`mee`) has no file in that repo |
  | mee-005 Psychic Energy | sve-5 | same |
  | mee-006 Fighting Energy | sv1-258 | same |
  | mee-007 Darkness Energy | sv6pt5-98 | same |
  | mee-008 Metal Energy | sv6pt5-99 | same |
  | mep-078 Toxel | me2-67 | that repo is missing the Mega Evolution promos (`mep`) |

- **Set ids.** TCGdex `svNN` / `meNN` map to `svN` / `meN`, and the `.5` suffix
  maps to `pt5` (`sv06.5` → `sv6pt5`, `sv08.5` → `sv8pt5`, `me02.5` → `me2pt5`).
  Three are named outright: `30th` → `me55` (30th Celebration), `sv10.5b` →
  `zsv10pt5` (Black Bolt), `sv10.5w` → `rsv10pt5` (White Flare). The rest keep
  their ids: `base1`, `base4`, `sve`.
- **Spellings that are not disagreements.** Weakness `x2` vs `×2` (mep-078),
  "Psychic Energy" vs "Basic Psychic Energy", and `é` are normalised, and so is
  the order of cost symbols. Attack and Ability *text* is not compared, since the
  two sources word it differently and the text round-trip already covers it.

## Disagreements: 12, all resolved, 0 open

The engine side of each comparison is the frame with the card script's `fix`
applied, so a disagreement that a fix corrects is reported as FIXED.

| Field | Card | Frame (TCGdex) | pokemon-tcg-data | Resolution |
|---|---|---|---|---|
| weakness | sv10.5b-067 Genesect ex | none | Fire ×2 | **New fix, this change.** ptcg-data is right: the card prints Weakness {R}×2 / Resistance {G}-30, the usual Metal pair (6 of the 7 other Metal Pokémon in the snapshot print the same; Mega Skarmory ex is the exception). Gameplay impact: before this, a Fire attacker did 1× damage instead of 2× to a 220-HP ex. |
| resistance | sv10.5b-067 Genesect ex | none | Grass -30 | **New fix, this change.** The card prints Resistance {G}-30. |
| evolvesFrom | 30th-123 Hisuian Zoroark | none | Hisuian Zorua | Existing `fix.evolvesFrom` (lane:misc). |
| energyKind | me03-087 Rocky Fighting Energy | Basic ("Normal") | Special | Existing `fix.specialEnergy`. This is the known TCGdex problem of marking Mega-era Special Energy "Normal". |
| energyKind | me03-088 Telepathic Psychic Energy | Basic ("Normal") | Special | Existing `fix.specialEnergy`. |
| energyKind | sv10.5w-086 Ignition Energy | Basic ("Normal") | Special | Existing `fix.specialEnergy`. |
| aceSpec | sv05-157 Prime Catcher | not flagged | ACE SPEC | Existing `fix.aceSpec`. The frame has no ACE SPEC field at all, so every ACE SPEC needs this fix. |
| aceSpec | sv05-162 Neo Upper Energy | not flagged | ACE SPEC | Existing `fix.aceSpec`. |
| aceSpec | sv06-163 Secret Box | not flagged | ACE SPEC | Existing `fix.aceSpec`. |
| aceSpec | sv06-165 Unfair Stamp | not flagged | ACE SPEC | Existing `fix.aceSpec`. |
| aceSpec | sv06-167 Legacy Energy | not flagged | ACE SPEC | Existing `fix.aceSpec`. |
| aceSpec | sv08-185 Precious Trolley | not flagged | ACE SPEC | Existing `fix.aceSpec`. |

No disagreements in HP, types, stage, attack count, names, costs or damage,
Ability names, Retreat, Trainer type, or Tera.

## The new fix kind: `fix.weakness` / `fix.resistance`

`CardScript.fix` (src/dsl.ts) gains `weakness?: PType` and
`resistance?: { type: PType; amount: number }`. `buildDef` (src/cards/frame.ts)
uses them in place of the frame's values. Genesect ex carries
`fix: { weakness: 'Fire', resistance: { type: 'Grass', amount: 30 } }`, and
`cards-metal.test.ts` checks that the compiled def has both, and that the
snapshot gap it covers is still there. That second check means the fix gets
revisited once the catalog is corrected.

**Caveat on fixes:** a fix belongs to a *script*, so it only reaches printings
that resolve to that script by text key. The text key includes Weakness and
Resistance, so another Genesect ex printing whose catalog frame *does* list them
gets a different key and does not resolve to this script. That is the same
limitation that `fix.evolvesFrom` already has. A frame-level override table
keyed by card id, applied before `textKey`, would remove it, but no current
printing needs one.

## Known gaps in the second source (not disagreements)

- pokemon-tcg-data is missing some Mega Evolution promos (`mep`) and has no
  `mee` file. Those printings are compared with a reprint, as shown above.
- It still marks rotated F/G-mark cards Standard-legal. Legality is not compared
  here; the simulator does not use it.

## Keeping it clean

When a new disagreement turns out to be the frame being right, add
`'<id>|<field>': '<reason, citing the source>'` to `ACCEPTED` in
`scripts/data-diff.ts` and a row above. When ptcg-data is right, add a `fix` to
the card's script with a card test, as was done for Genesect ex.
