---
date: "2026-10-11"
title: "Battle simulator: rulings follow-ups (moved counters lost on a protected target, Resolute Heart settling, search takes the shortest win)"
decided_by: "@cheyras (asked for everything the rulings audit and reviews identified to be fixed); built by a Claude Sonnet 5.5 lane, verified by Claude Opus 5.5."
areas: ["decks"]
supersedes: []
---
## 2026-10-11 — Battle simulator: rulings follow-ups (moved counters lost on a protected target, Resolute Heart settling, search takes the shortest win)
**Decided by:** @cheyras (asked for everything the rulings audit and reviews identified to be fixed); built by a Claude Sonnet 5.5 lane, verified by Claude Opus 5.5.

**Decision:**
- **Moved counters on a protected target (#2150).** Damage counters that an effect moves onto a Pokémon protected from them leave the source and are lost, the same rule as Cofagrigus (#2192). `charizard.moveAllCounters` now works this way for its three users: Team Rocket's Wobbuffet, Ninetales and Flutter Mane.
- **Resolute Heart (Pikachu ex), the two cases no ruling settles.** We read the rulebook's Knock Out procedure as follows:
  - A second damage instance in the same attack, after the Pokémon was saved, first settles the 10 HP remaining and then lands, so it Knocks the Pokémon Out.
  - Healing before the Knock Out check heals from the settled 10 HP: 30 healed leaves 40 HP.

  `settleBrace` (query.ts) is called from `healSlot` and `dealDamage`. These are interpretations, not rulings. Change them if TPCi rules otherwise.
- **The search CPU takes the shortest winning line.** It used to take the first winning line in option order. With an Ability usable as often as you like (Rocket Brain), using the Ability again was also a "winning line", because the attack still came after it, so the CPU never attacked. That was the stalled fuzz game in `std-c33.ts`.
- **Replay of Cinderace's setup choice.** Replay mulligans a no-Basic Cinderace hand while that seat's logged mulligans remain, and keeps it after that.
- **Coverage only.** Tests now pin:
  - the general evolve-Knock-Out rule (Tinkatuff);
  - the full-Bench search leaving the Prizes unknown;
  - #588's ordering (no counters reach Emolga before it returns);
  - the Resistance half of #620;
  - rulebook B-09: an unrestricted "takes less damage from attacks" reduces self-damage, while "from your opponent's Pokémon" doesn't.

**Why:** These came from the rulings audit (#328), the engine PR review (#329) and a fuzz stall. The owner asked for all of them to be fixed.

**Implications:**
- `determinism.test.ts` is re-pinned: the search CPU's choices change wherever two winning lines differ in length.
- Five or six "during the opponent's next turn" effects (Mega Abomasnow ex, Mega Zygarde ex, Team Rocket's Moltres ex, Clamperl, Zamazenta, Bronzong me05-064) are marked `fromOpp` although their text doesn't say "opponent's Pokémon". This can't matter in play today, so it's left as is.
- Still open:
  - The greedy pilot values any Ability at a flat amount, so it could loop on an unbounded Ability the same way the search CPU did. Fuzz doesn't hit it.
  - Replay over-counts a cumulative "took 5 mulligans" log line. That predates this change.
