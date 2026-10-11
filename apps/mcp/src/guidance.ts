import { z } from 'zod';

/**
 * What an MCP client is told beyond the tool descriptions: the server
 * `instructions` sent at initialization, and four prompts a person can pick.
 *
 * WHY THIS EXISTS. The owner, 2026-10-10: "even with just Claude, he will log
 * the battle but do the bare minimum — he won't analyse the battle much, and
 * won't write a great summary of the match." Until then the MCP server sent
 * no instructions and registered no prompts, so a connector client saw only
 * per-tool descriptions. Those say what a call DOES; none of them says that an
 * in-person game needs a debrief before it is logged, that the reader's words
 * and the assistant's analysis belong in different fields, or that a dead-draw
 * loss and a close game against a deck met five times deserve different
 * amounts of writing. Deck-E gets that judgment from its routed pathway texts
 * (apps/api/src/decke/pathways/texts/*.ts); this is the connector's copy.
 *
 * NOT IMPORTED FROM DECK-E, deliberately. Those texts call `ask_user` cards,
 * `showDeck`, `web_research`, `@pasted` log handles and Deep Think — none of
 * which an MCP client has. An instruction the client cannot follow is worse
 * than none: it either stalls looking for the tool or tells the reader that
 * something is broken. Everything named here is checked against the real
 * registry and the real advertised input schemas in
 * `__tests__/guidance.test.ts`, so a renamed field fails a test instead of
 * quietly turning into advice about an argument that no longer exists.
 *
 * SIZE. The instructions cross the wire on every connection and land in the
 * client's system prompt for every turn, battle-related or not, so they are
 * capped at 4,000 characters (tested). The prompts carry the longer playbooks
 * because they are loaded only when someone picks one.
 */

/** Sent as the MCP `instructions` field (initialize and server/discover). */
export const SERVER_INSTRUCTIONS = `DeckPal is the source of truth for card text, printings, legality, ownership, decks, battle logs and prices: read them with these tools, never from memory. Only changing metagame facts come from outside DeckPal, and those carry an as-of date.

Writes: a tool with \`dry_run\` previews by default. Show the preview, get the user's yes, then repeat the call with \`dry_run\`: false. \`deck_strategy\` has no preview, so show the new guide and ask first. If \`add_battle_log\` or \`save_deck\` is missing, this connection is read-only: say so and give the user the text instead.

LOGGING A BATTLE
- PTCG Live paste: pass the whole paste verbatim as \`add_battle_log\`'s \`log\`, never retyped or summarized. No deck named? Omit \`deck_id\`: it ranks the user's decks and writes nothing; confirm the pick, then call again with that \`deck_id\`.
- In-person game, or any game told as a story: BEFORE any \`add_battle_log\` call, ask 3–5 debrief questions in one message, skipping what they already said: the opponent's main attacker and notable cards; who went first; how the prizes went; the most frustrating play; the turn they'd replay. Only a bare "log a win vs X" is logged straight away. Then log with \`deck_id\`, \`origin\`: "in_person", an explicit \`result\` and \`opponent_deck\`.
- Two voices: the user's own words go in \`notes\`; your analysis (markdown) goes in \`review\`.
- Always set \`opponent_archetype\`; nothing fills it in for you. Key it by the main attacker(s), e.g. "dragapult-ex", and reuse a key already in the deck's record so games count together.
- Read \`battle_logs\` for the deck first: in its archetype record, an absent key is a new matchup and games >= 3 a familiar one. State the review depth in one line:
  Light: lopsided game, dead draw, early concession. 2–3 lines.
  Standard: close game, or "what went wrong?". The turning point (turn and event), one cause (variance, misplay, list or matchup) and one lesson.
  Deep: archetype new to this deck or met >= 3 times, a losing streak, or a requested breakdown. Fuller analysis from that record, plus dated research if you can search the web; at most one list change to watch.
- For a Standard or Deep review of a PTCG Live game, read \`battle_digest\` once it is logged (prize timeline, first attacks, opposing cards) rather than the raw log.
- The opponent's hand and prizes are unknown: never invent cards or plays. Check card text with \`get_card\` before explaining odd damage. Afterwards give the battle number, version and record.

REVIEWING RESULTS
Read \`battle_logs\` and \`deck_history\`. Give each archetype's record with its number of games and keep versions apart; a handful of games supports observations, not verdicts. Read \`battle_digest\` for the few losses that matter most, not every game. Classify losses only where notes, reviews or digests support it. A new analysis of an old game goes in \`edit_battle_log\`'s \`review\`, never over \`notes\`. End with at most two next steps, one line each, tied to specific games.

BUILDING OR ITERATING A DECK
Ground every card with \`search_cards\` or \`get_card\`: the cheapest printing of the same card unless asked (a shared name is not the same card). To iterate, read \`deck_history\` and \`battle_logs\` first and propose at most two swaps, each citing its evidence. Run \`check_deck\` on the full list, fix everything, and repeat until it is legal at 60. There is no deck widget here, so show the final list in chat. Explain the plan, 2–3 key choices, missing cards and cost. Preview \`save_deck\`; after a yes, save with \`dry_run\`: false and a \`version_note\` citing the evidence (the request, the matchup record, repeated notes).

PLANNING A COLLECTION
Use \`set_progress\` for missing cards and the cost to finish, and name the goal (complete, master or grandmaster) beside every count. Singles beat packs for specific cards; never invent pull rates.`;

export interface PromptArgumentDefinition {
  name: string;
  description: string;
  required: boolean;
}

/** Parsed prompt arguments: an optional argument the client omitted is absent. */
export type PromptArgs = Readonly<Record<string, string | undefined>>;

export interface DeckPalPromptDefinition {
  name: string;
  title: string;
  description: string;
  arguments: readonly PromptArgumentDefinition[];
  /** The text of the single user message `prompts/get` returns. */
  render: (args: PromptArgs) => string;
}

/**
 * `how` was specified as "paste or in-person summary", which reads two ways:
 * the mode, or the material itself. A prompt-argument box is where people put
 * either, so both work — a bare mode word sets up the conversation, anything
 * longer is treated as the paste or the story.
 */
function battleMaterial(how: string): string {
  const mode = how.trim().toLowerCase();
  if (/^(a )?(paste|ptcgl|ptcg ?live( log)?|live|log)$/.test(mode)) {
    return 'I will paste the PTCG Live battle log in my next message.';
  }
  if (/^(an? )?(in[ -]?person( game| summary)?|irl|paper|locals|league)$/.test(mode)) {
    return 'It was an in-person game. Ask me which deck and the result along with the debrief questions.';
  }
  return `Here is what I have:\n\n${how.trim()}`;
}

/**
 * User-selectable starting points. Each renders as one user message, so it is
 * written in the reader's voice; the server instructions still apply on top.
 */
export const PROMPTS: readonly DeckPalPromptDefinition[] = [
  {
    name: 'log-battle',
    title: 'Log a battle',
    description: 'Log a PTCG Live paste or an in-person game on the right deck, with a review sized to the game.',
    arguments: [
      {
        name: 'how',
        description:
          "Paste the whole PTCG Live battle log, or describe the in-person game (your deck, the opponent, the result, anything memorable). Or just write 'paste' or 'in person' and give the details in chat.",
        required: true,
      },
    ],
    render: ({ how = '' }) => `Help me log a Pokémon TCG battle in DeckPal.

${battleMaterial(how)}

Work through it like this:
1. A PTCG Live log goes to add_battle_log verbatim as \`log\`, never retyped or summarized. If I have not said which deck, omit deck_id so the tool ranks my decks, then tell me which deck it picked and why.
2. For an in-person game, unless I gave you only a bare result, ask me 3–5 debrief questions in one message BEFORE logging: the opponent's main attacker and notable cards, who went first, how the prizes went, the most frustrating play, and the turn I would replay. Skip anything I have already told you. Then log it with origin "in_person", an explicit result and opponent_deck.
3. Read battle_logs for the deck first. Set opponent_archetype to the main attacker's key, reusing a key already in the deck's archetype record when it is the same deck.
4. Tell me the review depth you chose and why: light (2–3 lines for a lopsided or dead-draw game), standard (turning point, cause — variance, misplay, list or matchup — and one lesson) or deep (new archetype, one met 3+ times, a losing streak, or I asked for a breakdown). Then write it. For a standard or deep review of a PTCG Live game, read battle_digest for it once it is logged: who went first, mulligans, each side's first attack, the prize timeline turn by turn and every card the opponent showed, in a fraction of the raw log. My own words go in notes; your analysis goes in review. Do not guess hidden cards.
5. Show me the dry-run preview and wait for my yes before dry_run: false. Afterwards tell me the battle number, the version it landed on, and the deck's record.`,
  },
  {
    name: 'review-results',
    title: 'Review my results',
    description: "Read a deck's logged games by opposing archetype and version, honestly sized, with at most two next steps.",
    arguments: [
      { name: 'deck', description: 'The deck to review, by name or id.', required: true },
    ],
    render: ({ deck = '' }) => `Review the logged results for my deck "${deck.trim()}" in DeckPal.

- Read battle_logs (its archetype record and per-version records) and deck_history.
- Show each opposing archetype's record with its number of games, and keep different versions of the list apart. Say plainly when a sample is too small for a verdict; a handful of games supports observations, not matchup conclusions.
- Before concluding, read battle_digest for the few games that matter most (the losses to the archetype I meet most, and any game I single out), not for every game. An in-person game has no log to digest; its notes and review are the evidence.
- Classify losses (variance, misplay, list or matchup) only where my notes, the saved reviews or those digests support it, and look for repeated evidence: the same dead card, the same missing out, the same setup failure.
- If a game has no opponent_archetype, offer to set it with edit_battle_log (dry run first). Any new analysis goes in review, never over my notes.
- Keep observations separate from proposals. End with at most two concrete next steps, one line each, each tied to specific games.`,
  },
  {
    name: 'build-deck',
    title: 'Build a deck',
    description: 'Build or improve a legal 60-card deck for a format and a budget or goal.',
    arguments: [
      { name: 'format', description: 'Standard, Expanded, GLC or Unlimited.', required: true },
      {
        name: 'budget_goal',
        description: 'Budget, cards-I-own-only, a Pokémon you love, playstyle, or the event you are preparing for.',
        required: false,
      },
    ],
    render: ({ format = '', budget_goal }) => `Help me build or improve a ${format.trim()} Pokémon TCG deck with DeckPal.
Budget / goal: ${budget_goal?.trim() ? budget_goal.trim() : 'not decided yet — ask me.'}

- Read my decks and collection before asking anything. Then ask at most four questions that change the build (paper or Live, casual or an event, cards I own only, a playstyle or Pokémon I love). If the direction is open, offer two directions and let me pick before building a full list.
- To improve an existing deck, read deck_history and battle_logs first, propose at most two swaps (one in, one out each), and cite the games behind them.
- Draft the list yourself with real card ids from search_cards or get_card, using the cheapest printing of the same card unless I ask for an art. Never make me type the list. Roughly 20 Pokémon, 30 Trainers and 10 Energy is a starting point, not a rule; explain deviations.
- Run check_deck on the complete list, fix everything it flags, and run it again until it is legal at 60.
- Show me the final list in chat, then the plan, the two or three choices that make it mine, its weaknesses, and the missing cards and cost.
- Preview save_deck (mode "create" for a new deck, "edit" for an existing one) and save with dry_run: false and a version_note that says why, only after I agree.`,
  },
  {
    name: 'plan-collection',
    title: 'Plan a set completion',
    description: 'Plan how to finish a set from what is missing and what it costs on DeckPal.',
    arguments: [
      { name: 'set', description: 'The set, by name, printed code or DeckPal set id.', required: true },
    ],
    render: ({ set = '' }) => `Plan how I finish ${set.trim()} in DeckPal.

- Use set_progress for what I am missing and DeckPal's cost to finish. Its goals are complete (one of any variant per card), master (every standard-tier variant) and grandmaster (every variant); ask which only if it changes the answer, and state the goal beside every count.
- Give a purchase order: cheap singles first when they move the binder, then chase cards with a budget or a wait threshold. Use card_price_history for a chase card's trend, within that tool's date rules.
- Singles beat packs for specific cards. Never invent pull rates or pack value, and never use remembered marketplace prices instead of DeckPal's.
- Offer, without doing it yet, to save the missing cards to a list with edit_list (dry run first) or to build a set_cart link.`,
  },
];

/**
 * The SDK schema for one prompt, built from the same argument list the tests
 * inspect. `prompts/list` derives each argument's name, description and
 * `required` flag from this schema's JSON form, so it is the single source.
 */
export function promptArgsSchema(prompt: DeckPalPromptDefinition) {
  return z.object(Object.fromEntries(
    prompt.arguments.map((argument) => {
      const text = z.string().trim().min(1).describe(argument.description);
      return [argument.name, argument.required ? text : text.optional()];
    }),
  ));
}
