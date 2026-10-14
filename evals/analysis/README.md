# Analysis eval

Does a review of a real game catch what matters? An agent gets DeckPal's MCP
tools and server instructions, fetched live, and is asked to review one game.
A judge marks each rubric point caught, partial or missed, and lists the
review's false claims.

The runner is `scripts/analysis-eval.mjs`. Its header holds the full contract;
the decision is `decisions/2026/2026-10-14-game-reviews-are-measured-per-principle-on-the-owner-s-games-and-held-out-ones.md`.

## Principles, not rules

Every rubric point is tagged with one of the six principles in
`principles.json`, and the report scores each one:

| | Principle |
|---|---|
| P1 | Facts come from a source |
| P2 | Every surprise has a mechanism |
| P3 | Consequences cross the whole board |
| P4 | The opponent is a decision-maker |
| P5 | All the evidence, numbers reconciled |
| P6 | Judgments are calibrated |

A point is an instance of its principle. A fix aimed at a principle should
move that principle's score on the held-out cases as well as the owner's. If
it moves only the owner's, it learnt the instance.

## Cases

| Case | Game | Split |
|---|---|---|
| owner-94 | Loss 2–6: Nighttime Mine on a Tera Dragapult ex; Fairy Zone | owner |
| owner-95 | Win by concession 1–0 against Crustle | owner |
| owner-99 | Loss 5–6: a last-turn Cursed Blast gives the 6th Prize | owner |
| owner-100 | Win 0–4 on the opponent's inactivity | owner |
| owner-101 | Win by concession at 0–0: Hide 'n' Sneak against Powerful Hand | owner |
| owner-103 | Win 6–5: your own counters fuel Night Joker | owner |
| heldout-tbs-62 | Win by concession 2–0: Codebreaking into Seek Inspiration | held-out |
| heldout-hns-10 | Win 2–0, opponent has no Bench left; they timed out twice | held-out |
| heldout-hns-36 | Loss 3–6: Tenacious Tail counts your Pokémon ex | held-out |

Logs:
- **Owner cases:** under `games/`, anonymised (PlayerA is the player).
- **Held-out cases:** they reuse the sim's fixtures in `packages/sim/src/__tests__/fixtures/live-logs/`.

Decks: `decks.json` holds the lists the logs are filed under on the QA account.

## Rules for cases

- **Check every fact first:** check each rubric fact against the card text before writing it down. `check` and the CI test hold each case's result, Prizes, turns, ending and first player to its log.
- **Tag every point:** every point names one principle and says whether it is a must.
- **List known false claims:** add `false_claims` for the wrong things a review is likely to say.
- **Never tune on held-out cases:** do not write playbook or tool text with them in view. Add new held-out games over time, as the old ones get looked at.

## Running

```bash
pnpm --filter @deckpal/sim build                        # the log parser comes from its dist/
node scripts/analysis-eval.mjs check                     # free
node scripts/analysis-eval.mjs setup                     # decks + logs on the QA account
node scripts/analysis-eval.mjs run --budget 5            # A, B and C on every case, judged
node scripts/analysis-eval.mjs run --budget 1 --configs A --cases owner-101
node scripts/analysis-eval.mjs report --out evals/analysis/runs/<time>   # free
```

- **QA token:** `.qa-account` must hold `QA_MCP_TOKEN` and `QA_USERNAME`. The maintainer runs `node scripts/qa-token.mjs` to mint the token; it records the username, and the eval refuses any token whose account is not that one.
- **Gateway key:** set `AI_GATEWAY_API_KEY`. It is never printed.
- **Output:** runs land in `runs/`, which is gitignored. They hold every tool call and result, the reply, the judge's verdicts and the cost.
- **Resuming:** a rerun with the same `--out` skips the judged pairs, reruns errored runs and re-judges unjudged ones. Scores count judged runs only.
