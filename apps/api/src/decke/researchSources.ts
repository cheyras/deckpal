/**
 * WHERE a research question should be answered from, and why it depends on the
 * question.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * THE DISTINCTION, IN THE OWNER'S WORDS
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *   "Since the nature of TCGs is constant evolution and change with new drops,
 *    meta changing, etc. we definitely need some intelligence around that.
 *    Collection is mostly evergreen, a cool card years ago is still a cool card
 *    now, and overall info about how the card scene operates generally doesn't
 *    change constantly, but for battle strategy we definitely want to make sure
 *    we're not pulling from outdated sources."
 *
 * Two kinds of question with opposite relationships to time:
 *
 *   COMPETITIVE — what is winning, which deck is strong, how a matchup plays,
 *                 what rotated. Standard rotates annually and a set ships every
 *                 few months, so a report from the previous format is not stale,
 *                 it is WRONG. It describes a game that no longer exists.
 *
 *   GENERAL     — artwork, collecting, prices, history, how the hobby works,
 *                 what a card is loved for. A post from 2023 explaining why an
 *                 illustration is beautiful is still true. Filtering it out
 *                 would destroy the answer to keep a rule.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * AND THE FIX IS NOT A DATE FILTER — MEASURED, TWICE
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * The obvious move is `search_recency_filter`. It reaches Perplexity through the
 * Gateway (snake_case only — `searchRecencyFilter` is silently dropped, which is
 * the same trap that killed the xAI live-search idea), and it makes the answer
 * WORSE at every window tried:
 *
 *   window   sources  authoritative  wrong game  answer
 *   none          20              2           1  fine
 *   week          20              0           2  starved
 *   month         20              1           2  starved
 *   year          20              0           0  vague
 *
 * "Wrong game" is the tell. `mtgo.com`, `mtg-standard.com`, `mtga.untapped.gg` —
 * a narrow window starves the query of Pokémon results and the engine takes
 * whatever it can get, and "Standard format" is a format name in Magic too. A
 * recency filter bought less recency and more drift.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * WHAT WORKS IS ASKING THE RIGHT SITES
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *   baseline           13 hosts   2 authoritative   1 wrong game
 *   domain allowlist    5 hosts   5 authoritative   0 wrong game
 *   allowlist + month   3 hosts   3 authoritative   0 — and the answer degraded
 *
 * With the allowlist the sources become `limitlesstcg.com`,
 * `play.limitlesstcg.com`, `pokemon.com`, `pokebeach.com` and
 * `pokedeckarchitect.com` — instead of `gamesradar`, `ultimateguard` and
 * `monstercardcorner`. Recency comes FREE, because those sites are live
 * tournament data: they are current by construction in a way a date filter over
 * the open web can never be. A 2024 SEO listicle is stale the day it is written.
 *
 * Adding recency ON TOP starved it again — "the strongest deck cannot be stated
 * with certainty" — so the allowlist ships alone.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * IT IS ALSO THE INJECTION CONTROL THIS PROJECT RECORDED AS LOST
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * `models.ts` on the old research model: *"`gatewayTools.exaSearch` exposes
 * `include_domains`, which is the real injection control for live research — an
 * allowlist of known TCG sources plus a recency window, enforced rather than
 * requested. `o3-deep-research` searches provider-side, so that control is not
 * available to us here."*
 *
 * It is available now, for the competitive half. Text reaching the model from a
 * competitive question can only come from these domains, so the "least
 * trustworthy input in the system" is no longer arbitrary. The general half is
 * deliberately open, because that is where the good answers live, and it keeps
 * the existing controls: the researcher holds no tools, its output is framed as
 * data, and only hosts are ever quoted back.
 */

/**
 * The competitive record for this game.
 *
 * Every one of these publishes LIVE tournament data or official rules news, so
 * "recent" is a property of the source rather than something to filter for.
 * Deliberately short: an allowlist that grows to include content farms is an
 * allowlist that has stopped meaning anything.
 *
 * `limitlesstcg.com` and its `play.` subdomain are the format's de-facto
 * results database; `rk9.gg` runs official event pairings; `pokemon.com` is the
 * publisher; `pokebeach` and `pokedeckarchitect` carry set news and archetype
 * analysis with dates on it.
 */
export const COMPETITIVE_SOURCES: readonly string[] = [
  'limitlesstcg.com',
  'play.limitlesstcg.com',
  'pokemon.com',
  'pokebeach.com',
  'rk9.gg',
  'trainerhill.com',
  'pokedeckarchitect.com',
  'pokestats.site',
];

/** Which kind of question this is, and therefore where it may be answered from. */
export type ResearchTopic = 'competitive' | 'general';

/**
 * The provider options for a topic.
 *
 * SNAKE_CASE, because that is what actually reaches Perplexity through the
 * Gateway — measured. `searchDomainFilter` and `searchRecencyFilter` are
 * accepted by the type system, dropped on the wire, and produce results
 * identical to sending nothing. That is the `cacheControl` failure shape and it
 * is why this is written the way it is rather than the way it reads best.
 *
 * NO RECENCY FILTER, at any window. See the header: it starved every query it
 * was tried on and pulled the search into a different game.
 */
export function researchProviderOptions(
  topic: ResearchTopic,
): { providerOptions?: { perplexity: { search_domain_filter: string[] } } } {
  if (topic !== 'competitive') return {};
  return { providerOptions: { perplexity: { search_domain_filter: [...COMPETITIVE_SOURCES] } } };
}

/**
 * The extra instructions a competitive question needs.
 *
 * Rotation is the thing a general-purpose researcher cannot be expected to know:
 * Standard drops a chunk of the card pool every year, so a deck report from the
 * previous format is not merely old, it describes a game that no longer exists.
 * Saying "as of" on every claim is what lets the reader — and Deck-E — tell the
 * difference.
 */
export function topicInstructions(topic: ResearchTopic): string {
  if (topic !== 'competitive') {
    return [
      '',
      'This is a question about the hobby rather than about competitive play —',
      'artwork, collecting, prices, history, how things work. Older sources are',
      'fine here and often better: why an illustration is admired does not expire.',
    ].join('\n');
  }
  return [
    '',
    'This is a COMPETITIVE question, so recency decides whether an answer is true.',
    'The Pokémon TCG Standard format ROTATES: part of the card pool leaves every',
    'year, and a new set arrives every few months. A deck report from before the',
    'current rotation is not merely old — it describes a format that no longer',
    'exists, and repeating it would be wrong rather than stale.',
    '',
    'So: date every claim explicitly, prefer live tournament data over opinion,',
    'and say plainly when the most recent thing you can find predates the current',
    'format. "I could only find results from the previous format" is a useful',
    'finding. A confident answer built on them is not.',
  ].join('\n');
}
