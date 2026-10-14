---
date: "2026-10-13"
title: "Battle logs know which player is you: a PTCG Live name in the profile, learned after three games"
decided_by: "Chey (via Claude)"
areas: ["decks", "agents"]
supersedes: []
---
## 2026-10-13 — Battle logs know which player is you: a PTCG Live name in the profile, learned after three games
**Decided by:** Chey (via Claude)

**Decision:** Migration 086 adds `user_settings.ptcgl_name` and `ptcgl_name_source` (`manual` or `auto`).
- **Setting it.** The reader can set or clear the name in Profile, as "Your PTCG Live screen name".
- **Learning it.** While the name is empty, it fills itself in after a PTCG Live game is logged, once three such games attribute the same name to the reader and no other name has as many. The UPDATE itself guards `ptcgl_name IS NULL`, so a name is never changed automatically once set, typed or learned.
- **Using it.** When the name is set and appears in a pasted log as a player, three routes read the log from that player's side unless the caller names one:
  - adding the log;
  - ranking it against the reader's decks (`/decks/log-preview`);
  - its digest.
- **Backfill.** The migration fills the name once, by the same rule, for readers who already qualify.
- **Before 086 is applied.** Nothing breaks: the API ignores the name, settings load without it, and saving it answers 503.

**Why:** The owner asked for it on 2026-10-13: "something the user can manually set, and if it's empty and they have logged let's say 3 battles with the exact same username attributed to them, it just automatically gets filled in. So it's not a tool the agent even has to call… it's never automatically changed if they've filled it in themselves."
- A pasted PTCG Live log names both players and not which one is the reader. The parser guessed from card overlap with the reader's decks, and short games show few cards. In the owner's tests a five-turn concession was read from the wrong side.
- Agents asked "which one is you?" on every log.

**Implications:**
- Two accounts played equally are never guessed at.
- A log from an account other than the stored name is parsed as before, because the stored name is used only when it appears in the log as a player.
- `add_battle_log`'s description says the profile name is used, so the MCP playbooks no longer need to ask for the name.
- API.md documents the settings fields, and DEPLOYMENT.md the migration.
