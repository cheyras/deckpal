# Analysis eval: results

## Baseline, 2026-10-17

**What ran.**
- Two full runs of the 9 cases × 3 configs, on the QA account against live deckpal.app (main at c626e9dd).
- The judge is Sonnet 5.5 at medium effort, with the card text of every card in the log.
- Figures are the mean of the two runs. Each run's score was within 5 points of the other on every summary row.
- Total spend, smoke run included: $3.85.

| | A: Haiku end to end | B: Haiku gathers, Sonnet writes | C: Sonnet low, end to end |
|---|---|---|---|
| Overall | 60% | **77%** | 68% |
| Must items | 66% | **80%** | 70% |
| Owner cases | 65% | **83%** | 73% |
| Held-out cases | 52% | **65%** | 59% |
| P1 Facts come from a source¹ | 75% | 100% | 50% |
| P2 Every surprise has a mechanism | 49% | **63%** | 54% |
| P3 Consequences cross the whole board | 75% | **88%** | 78% |
| P4 The opponent is a decision-maker | 41% | **69%** | 56% |
| P5 All the evidence, numbers reconciled | 68% | **83%** | 81% |
| P6 Judgments are calibrated | 80% | **90%** | 85% |
| False claims per review² | ~1.9 | ~2.0 | ~2.3 |
| Model cost per review, judge excluded | **0.6¢** | 5.4¢ | 4.4¢ |
| `get_card` calls (9 reviews, run 1) | 15 | 31 | 4 |

¹ P1 is a single rubric point (Nighttime Mine on a Tera Pokémon), so this row is one case.

² The false-claim counts are approximate. After the card text was added, most listed claims are real, for example:
- "6 mulligans" when there were 5;
- an invented "Garchomp ex at 400 HP";
- Dragapult ex called naturally weak to Psychic, when Fairy Zone gave it that Weakness.

About one in four still reads "this is fine". Compare the configs on this row; don't read it as an absolute rate.

## What it says

1. **B is the best review, at about 5¢.**
   - It leads on every principle and on held-out games, not only on the owner's.
   - The Haiku gatherer, told to collect everything, pulls about twice the card text A does, and the Sonnet writer reasons over it.
   - Sonnet alone at low effort (C) costs nearly as much, scores lower, and looks cards up least. That is where its P1 miss comes from.
2. **The gaps are the same in every config, which points at the tools, not the model.**
   - P2 (mechanisms) is the weakest principle everywhere, at 49–63%.
   - All three configs missed Jamming Tower, Shellnado Spin's counter-damage and Darkness Weakness.
   - The battle digest reports "Weakness to Psychic: 160" without saying Dragapult ex has no printed Weakness and Fairy Zone gave it one.
   - It never says Nighttime Mine raised Phantom Dive's cost.
   - No config reconstructed the hidden-then-revealed hand in hns-36: no tool tracks a hand through Lillie's Determination.
3. **P4 (the opponent decides) is Haiku's weakest principle**, at 41%. B's Sonnet writer lifts it to 69%, the largest gap between configs.
4. **Held-out games trail owner games by 13–18 points in every config.** A fix tuned to the owner's games would widen that gap; a fix to a principle should narrow it. That is the test for the next change.

## Recommendation

- **Fix P2 in the tool, as a class of event, not card by card.** `battle_digest` should list the effects in play that change the rules for this game, wherever they apply:
  - Weakness or Resistance changes (Fairy Zone);
  - cost changes (Nighttime Mine on Tera Pokémon);
  - Tools turned off (Jamming Tower);
  - damage riders (Cheer On to Glory, Shellnado Spin).

  Each entry names the Pokémon it touched. One rule covers every card that does any of these things. Re-run this eval and expect P2 to rise on the held-out split as well as the owner split.
- **For Deck-E (Phase 7):** a cheap Haiku gatherer feeding one Sonnet writer for game reviews. It costs about a tenth of Sonnet doing the whole loop and beats it on every principle.

## Reproducing

```bash
node scripts/analysis-eval.mjs run --budget 3 --out evals/analysis/runs/<name>
node scripts/analysis-eval.mjs run --budget 1 --rejudge --out evals/analysis/runs/<name>   # judge again
```
