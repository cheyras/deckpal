---
date: "2026-10-14"
title: "battle_digest reads the game through the simulator's replay: boards, attacks, moments and how much a review is worth"
decided_by: "Chey (via Claude)"
areas: ["agents", "decks"]
supersedes: []
---
## 2026-10-14 — battle_digest reads the game through the simulator's replay: boards, attacks, moments and how much a review is worth
**Decided by:** Chey (via Claude)

**Decision:** `GET /decks/:id/logs/:logId/digest` now also returns `replay`, the battle simulator's reading of the same stored log (`replayInsights` in `packages/sim/src/replay/insights.ts`, via `apps/api/src/deck/replayDigest.ts`). `battle_digest` renders it after the prize-race digest. It reads the log twice:
- **Live's own lines (the parser):** every attack, with its printed damage, Live's breakdown (Weakness, Resistance, bonuses) and whether it Knocked Out.
- **The engine's replay of the whole game:** the board as each turn began (HP left with HP effects counted, Energy, Tools, Special Conditions, Prizes left, hand size), so each attack also knows how much HP its target had.

**Moments.** From those two readings the digest lists the moments worth a look. Each is a fact, not a judgement:
- `self_ko`: a Pokémon Knocked Out on its owner's own turn, with the Prizes that gave away;
- `no_damage`: an attack that prints damage and did none, without a failed coin flip (its cause is not asserted);
- `blocked`: "Effects of X did not affect Y";
- `near_ko`: an attack that left its target on 30 HP or less;
- `timer`: a turn that ended because a player "didn't take an action in time";
- `ending`: a concession, a timeout, an empty Bench or the last Prize.

**Also in the digest:**
- **One line per card each side showed**, from DeckPal's card data, with Tera marked.
- **A `review worth` line.** It scores 0–10 and maps to brief, standard or deep, with its reasons listed. The score comes from the owner's criteria: closeness, a changed lead, those moments, a loss, length, the reader's notes, and a short concession.
- **`detail: 'turns'`**, which adds the board at the start of every turn.
- **The text budget.** The prize digest keeps its 3,000-character ceiling. The replay adds at most 5,000 characters, or 11,000 with turns. Long lists shrink first and say so.

**Players.** In moment texts players are `{p0}`/`{p1}`. They render as "me"/"opp", or as escaped screen names when the reader is unknown, so a crafted screen name is never printed bare.

**Deck-E.** The battle logging and battle review pathways tell Deck-E to treat the moments as facts to explain, to let `review worth` confirm the depth (an explicit ask from the reader still wins), and to read Deep games with `detail: 'turns'`.

**Why:** In the owner's claude.ai tests (2026-10-13), Haiku reviewing a game:
- missed a self-Knock-Out that gave up the last Prize;
- missed the opponent's timed-out turns;
- explained damage to a Benched Tera Pokémon from memory.

The old digest said who took which Prize when, and nothing about the board. The simulator already replays real logs move by move: all 10 fixture games replay completely in 11–170 ms. So the facts a review needs come from code rather than from a model reading 50,000 characters. The owner also asked for a definition of a battle worth analysing, weighing the reader's notes; `review worth` is that definition, written down where it can be argued with.

**Implications:**
- **Past games improve automatically.** The digest is recomputed on every call, so every past game gets the replay with no backfill and no migration.
- **A partial replay is said.** Where the replay stops early (a card the engine does not script, a rules gap), the boards end there, and the digest says so. The attacks and moments still cover the whole game, because they come from Live's lines.
- **No judgement yet.** `near_ko` is the only judgement-adjacent moment, and it is arithmetic. Asking the strongest simulator pilot what it would have done on a turn is the next Phase 2 PR, not this one.
- **MCP description grows.** The `battle_digest` description grew and the tool gained `detail`; tools/list stays under its 70,000-character budget.
