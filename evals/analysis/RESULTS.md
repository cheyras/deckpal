# Analysis eval: results

## Baseline, 2026-10-17

**What ran.**
- Two full runs of the 9 cases × 3 configs, on the QA account against live deckpal.app (main at c626e9dd).
- The judge is Sonnet 5.5 at medium effort, with the card text of every card in the log.
- Total spend, smoke run included: $3.85.

**Each cell is run 1 / run 2.** The first five rows (Overall to Held-out) moved by 6 points or less between runs. The per-principle rows rest on few rubric points and move more.

| | A: Haiku end to end | B: Haiku gathers, Sonnet writes | C: Sonnet low, end to end |
|---|---|---|---|
| Overall | 61 / 59 | **78 / 76** | 68 / 68 |
| Must items | 67 / 65 | **83 / 77** | 71 / 69 |
| Owner cases | 66 / 64 | **83 / 83** | 73 / 73 |
| Held-out cases | 53 / 50 | **68 / 62** | 59 / 59 |
| P1 Facts come from a source¹ | 50 / 100 | 100 / 100 | 50 / 50 |
| P2 Every surprise has a mechanism | 54 / 43 | 61 / 64 | 50 / 57 |
| P3 Consequences cross the whole board | 75 / 75 | 94 / 81 | 81 / 75 |
| P4 The opponent is a decision-maker | 50 / 31 | 75 / 63 | 56 / 56 |
| P5 All the evidence, numbers reconciled | 62 / 73 | 81 / 85 | 81 / 81 |
| P6 Judgments are calibrated | 80 / 80 | 90 / 90 | 90 / 80 |
| False claims per review² | 2.0 / 1.8 | 2.1 / 1.9 | 2.0 / 2.7 |
| Model cost per review, judge excluded (run 1) | **0.6¢** | 5.4¢ | 4.4¢ |
| `get_card` calls over 9 reviews (run 1) | 15 | 31 | 4 |

¹ P1 is a single rubric point (Nighttime Mine on a Tera Pokémon), so each run scores it 0, 50 or 100. It is an anecdote, not a rate.

² The false-claim counts are approximate. With the card text, most listed claims are real, for example:
- "6 mulligans" when there were 5;
- an invented "Garchomp ex at 400 HP";
- Dragapult ex called naturally weak to Psychic, when Fairy Zone gave it that Weakness.

About one in four still reads "this is fine". Compare the configs on this row; don't read it as an absolute rate.

## What it says

1. **B gives the best reviews.**
   - It leads overall, on the held-out games, and on P2–P6 in both runs.
   - It costs about 1¢ more per review than C (5.4¢ against 4.4¢) and scores 9 points higher overall.
   - Against A it costs about 9× more and scores 17 points higher.
   - The Haiku gatherer, told to collect everything, pulls about twice the card text A does. The Sonnet writer reasons over it.
   - Sonnet alone at low effort (C) looks cards up least.
2. **The shared weak spot is P2, and it points at the tools.**
   - P2 (mechanisms) is not the lowest principle in every config:
     - A's lowest is P4;
     - C's is the single P1 point.
   - But P2 is low in all three (43–64%). It is the one principle no config handles well, so a model choice cannot fix it.
   - Misses every config shared:
     - Jamming Tower;
     - Shellnado Spin's counter-damage;
     - Darkness Weakness on Shuppet;
     - the hand that hns-36's log reveals.
   - The battle digest explains why. It reports "Weakness to Psychic: 160" without saying that Dragapult ex has no printed Weakness and Fairy Zone gave it one. It never says Nighttime Mine raised Phantom Dive's cost.
3. **P4 (the opponent decides) is Haiku's weakest principle** (50 / 31). B's Sonnet writer lifts it to 75 / 63, the largest gap between configs.
4. **Held-out games trail owner games by 11–21 points in every config.** A fix tuned to the owner's games would widen that gap; a fix to a principle should narrow it. That is the test for the next change.

## Recommendation

- **Fix P2 in the tool, as a class of event, not card by card.** `battle_digest` should list the effects in play that change the rules for this game, wherever they apply:
  - Weakness or Resistance changes (Fairy Zone);
  - cost changes (Nighttime Mine on Tera Pokémon);
  - Tools turned off (Jamming Tower);
  - damage riders (Cheer On to Glory, Shellnado Spin).

  Each entry names the Pokémon it touched. One rule covers every card that does any of these things. Re-run this eval and expect P2 to rise on the held-out split as well as the owner split.
- **For Deck-E (Phase 7):** a Haiku gatherer feeding one Sonnet writer for game reviews. It costs about a cent more per review than Sonnet doing the whole loop at low effort, and beats it on every summary row.

## Reproducing

```bash
node scripts/analysis-eval.mjs run --budget 3 --out evals/analysis/runs/<name>
# Judge a finished run again. The budget is cumulative over the directory, so leave headroom above
# what it already spent; the run refuses, before touching any verdict, if the re-judge could exceed it.
node scripts/analysis-eval.mjs run --budget 8 --rejudge --out evals/analysis/runs/<name>
```

## After the rule-effects digest (#351), 2026-10-17

**What ran.** One run of configs A and B against production with #351 deployed (main at 51f23e47). It cost $0.97, bringing all eval spend to $4.86. The baseline columns are run 1 / run 2 from above.

| P2 (mechanisms) | Baseline | After #351 |
|---|---|---|
| A, owner games | 56 / 50 | **72** |
| A, held-out games | 50 / 30 | 40 |
| B, owner games | 67 / 72 | 72 |
| B, held-out games | 50 / 50 | **60** |

**The points the change covers moved in both configs, on both splits:**
- `jamming-tower` (held-out hns-36): 0 / 0 → 0.5.
- `fairy-zone-340` (owner-99): 0.5 / 0.5 → 1.
- `crustle-mechanism` (owner-95, A): 0 / 0 → 1.

**The points it does not cover did not move:**
- `shellnado-dodge` is attack text.
- `dark-weakness` is a printed Weakness.
- `codebreaking-seek` is a Trainer combo.

That is the signature of a class fix rather than an instance fix: it moved the held-out Jamming Tower point, a card nobody wrote a rule for.

B's overall score was 71 against 78 / 76, a drop mostly in P4 and P5, which this change does not touch. That is within the spread of a single run.

**Verdict: kept.**

**Next mechanisms gap:** effects carried in ATTACK text, which the digest does not yet surface for the turn they apply:
- Shellnado Spin's counter-damage;
- Seek Inspiration copying an attack.

They are the next class, measured the same way.
