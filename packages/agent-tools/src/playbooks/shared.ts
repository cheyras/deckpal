/**
 * Rules both of DeckPal's agent guides state word for word (Phase 7). One guide is the playbooks served to claude.ai
 * and MCP agents (`texts.ts`, the `playbook` tool and deckpal.app/skill). The other is Deck-E's routed pathway texts
 * (`apps/api/src/decke/pathways/texts`). Each rule is interpolated into both, and a test on each side checks it is there
 * unchanged, so changing a rule here changes it everywhere.
 *
 * Only WHAT is true and how to judge belongs here. HOW each client acts stays in its own text: Deck-E's approval
 * cards, `log: "@pasted"`, `ask_user` and `showDeck`; the playbooks' `dry_run` steps. Nothing here may mention dry runs
 * or previews: a "preview first" line once took Deck-E's write calls to 0/15 (`adapters/aisdk.ts`).
 *
 * Owner rulings, 2026-10-26: the digest's review worth decides the depth, with the record only raising standard to
 * deep; at least three ranked options when tuning a deck; the five-cause review with the Opponent line and the strict
 * misplay bar everywhere.
 */
export const SHARED_RULES = {
  /** How deep a game review goes. */
  reviewDepth: `**Depth** comes from the digest's \`review worth\` line: **brief** is the **Read** line alone, **standard** is the standard review, **deep** is the deep review. An explicit ask for a review always gets at least a standard one. Raise standard to deep only when the deck's record says the matchup matters: an archetype new to this deck, one met at least three times before, or a second straight loss to it. A record read after logging already counts this game. Whatever the player flagged, the review addresses.`,

  /** The bar for calling a play a mistake. */
  judgeFairly: `Before calling a play a mistake, ask: (1) what did the player know that the log does not show (their hand, their Prizes)? (2) what is the best reason for the play? (3) does another line clearly do better on what was visible, with the damage checked against card text? It is a **misplay** only when (3) is clearly yes and (1)-(2) do not explain it. Otherwise write "Worth a look: <alternative>, because <reason>. You may have had a reason the log can't show." The opponent's hand and Prizes are unknown; never guess them.`,

  /** The one cause a review names. */
  causes: `The review names one cause:
- **Variance:** no Basic, mulligans, a key card Prized, missing draws with outs left.
- **Misplay:** only by the bar above.
- **List:** a missing answer or dead card seen in more than one game. The first time it is a **Watch**.
- **Matchup:** a normal game with no clear misplay, where the deck is structurally behind.
- **Ending:** a concession or the timer decided it; say which, who, and on which turn.`,

  /** The review's shape, by depth. */
  reviewShape: `A standard review, in markdown:

    **Read:** <cause>: <turning point, with turn and event>
    **Prizes:** <the race, e.g. "you took two-Prize KOs on T3 and T5, then fell behind">
    **Opponent:** <what they chose and why it worked or failed>
    **Lesson:** <one lesson for this matchup>. **Watch:** <one list item, only if real>

A deep review adds:

    **Key turns:** <the 1-2 deciding turns: what was played, what the turn review showed>
    **Pattern:** <earlier games against this archetype, with the record>
    **Try next:** <one concrete play or list change to test>

A brief review is the **Read** line alone.`,

  /** A record is split by how its games ended. */
  endingSplit: `Split every record by how the games ended, and report the groups apart: **decided on Prizes** (the real win/loss evidence); **concessions** (who conceded and how early: an early concession says the board was already decided, not that the deck lost a close race); **deck-outs** (about resources, not the Prize race); and **other**, the timer or no Pokémon left in play (say "ended another way" if you cannot tell). A \`battle_logs\` row marked "ended before the last Prize" ended another way, and \`battle_digest\` says how. Never count a concession, timeout or deck-out as a Prize result.`,

  /** When results justify a new deck version. */
  newVersion: `Do not propose a new deck version before the current one has about 10 games; until then a list idea goes in a game's notes.`,

  /** How deck changes are offered. */
  deckOptions: `Offer at least three ranked options, best first, unless the player asked for one specific change (then make it, without an evidence lecture). Each option is normally one card in and one out, or a count shift. Each cites its evidence in plain words ("dead in battles #12, #15 and #19", a \`deck_odds\` number, a \`simulate_battles\` result) and says what result would support keeping it. Two losses raise a question; they do not prove a matchup is bad. The player picks; do not decide for them.`,

  /** The goals `set_progress` counts against. */
  setGoals: `\`set_progress\` counts a set against one of four goals:
- **complete:** every card once, any variant, secret rares included;
- **master:** every standard variant, so reverse holos too;
- **grandmaster:** every variant;
- **numbered:** cards 1 to the printed total, any variant, no secret rares ("the main set"). Only \`set_progress\` takes it; for a list (\`edit_list\` \`add_missing\`) or a cart (\`set_cart\`) use complete and leave out secret rares with \`rarity_exclude\`.
Always name the goal beside the count ("12 missing for numbered").`,

  /** Where rules answers come from, and how a settled finding is shared. */
  rulesSources: `The game's rules and official rulings come from \`rules_lookup\`; card text, tags (Tera, Ancient, Future) and legality from \`get_card\`. Never from memory. Either may also show community notes: findings other agents proposed and a DeckPal reviewer approved. A note points at its source; the card text and the rulings still decide. When research outside DeckPal settles how named cards interact and DeckPal had no ruling for it, offer to share it with \`propose_note\`: the \`cards\`, the finding as the \`statement\`, a rulings page as the \`source_url\` (not a forum guess) and the source's own words as the \`quote\`. Never include anything about the player.`,
} as const;

export type SharedRule = keyof typeof SHARED_RULES;
