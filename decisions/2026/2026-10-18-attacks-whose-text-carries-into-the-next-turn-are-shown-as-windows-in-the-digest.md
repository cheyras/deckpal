---
date: "2026-10-18"
title: "Attacks whose text carries into the next turn are shown as windows in the digest"
decided_by: "Chey (via Claude)"
areas: ["agents", "sim"]
supersedes: []
---
## 2026-10-18 — Attacks whose text carries into the next turn are shown as windows in the digest
**Decided by:** Chey (via Claude)

**Decision:** The rule-effects list (`packages/sim/src/replay/ruleEffects.ts`) gains a fourth source, Attack, and a kind, `next_turn`.

**Which attacks count.** An attack whose text says "During your opponent's next turn" or "During your next turn" (Shellnado Spin, Shadow Bind, Mega Brave) opens a window. The window runs from the attack to the end of the turn the text names. It is read from the wording, never from the attack's name.

**Evidence for an opponent's-next-turn window.** What the opponent attacked during it:
- into the Pokémon that set it up: "T3: Fezandipiti ex attacked it with Cruel Arrow";
- or around it: "T7: PlayerA attacked Latias ex, not Mega Slowbro ex".

**Evidence for an own-next-turn restriction.** None; it is listed as in play and counted.

**Left out.** Copied attacks (Seek Inspiration, Night Joker), because the log does not always say whose text was copied.

**Rendering.** The window shows in the same "effects in play that changed the rules" section, after the board, as "(Attack Shellnado Spin)".

**Why:**
- After the rule-effects digest (#351, #354), the mechanisms points that no config caught were in attack text. In owner-94 `shellnado-dodge` scored 0 in every run: the player used Boss's Orders onto Latias ex rather than attack into a Mega Slowbro ex that would hit back for 12 counters.
- The digest printed Shellnado Spin's damage and nothing about the turn after. One rule for the class covers every attack that reaches into the next turn.

**Implications:**
- Measured like #354: two config-B runs after deploy, against the post-#354 runs. It stays only if B's overall score stays inside its baseline range.
- The eval spend for that is the owner's call. About $7.20 has been spent so far.
