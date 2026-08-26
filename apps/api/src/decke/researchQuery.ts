/**
 * What may leave this process in a research query.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * WHY THIS IS CODE AND NOT A SENTENCE
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * `models.ts` records the owner's data-processor ruling — US frontier labs only
 * — with its reason: this is "the defensible answer for a paid product
 * streaming a user's camera and collection to a third party".
 *
 * That ruling has now been relaxed for exactly one call, because no in-list lab
 * can search and the alternative was no research at all. The relaxation rests
 * entirely on one claim: **a research query carries card and archetype names
 * and never anything about this user.**
 *
 * Until this file, that claim was a `.describe()` string — a request to a
 * model, in the same schema the model is free to fill however it likes. This
 * codebase has already written down, twice, what such a request is worth:
 * `focus.ts` ("a prompt begging the model to call it produced no call") and
 * `tools.ts` ("the prompt forbids it and the prompt is not an enforcement
 * mechanism; this is").
 *
 * A ruling relaxed on the strength of a promise should be relaxed on the
 * strength of a control instead. So the query is checked here, on the way out,
 * and a query that carries identity is refused rather than sent.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * WHAT THIS HONESTLY DOES NOT CATCH
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Collection facts shaped like card names. "Is a Base Set Charizard worth
 * holding" is a legitimate research question and also, if the reader owns one,
 * a fact about their collection. Nothing textual can separate those, because
 * they are the same words.
 *
 * The structural half of the control is elsewhere and matters more: the
 * research sub-agent holds NO TOOLS, so it cannot go and read the collection
 * itself, and the caller composes the query from the reader's own question
 * rather than from anything a collection tool returned. This file is the
 * tripwire on top of that, and it should not be described as more.
 */

/** Longest query accepted. The schema caps at 300; this is the backstop. */
export const MAX_QUERY = 300;

/**
 * Things that are never part of a question about the Pokémon TCG, and are
 * commonly part of a question about a person.
 */
const FORBIDDEN: readonly { name: string; re: RegExp }[] = [
  // A uuid is an account, a deck, a list or a collection row. Never a card.
  {
    name: 'an id from this app',
    re: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i,
  },
  { name: 'an email address', re: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/ },
  // A bearer token, a JWT, or an api key that has wandered into a prompt.
  { name: 'something that looks like a credential', re: /\b(?:ey[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9_-]{16,}|Bearer\s+\S+)/ },
  // First-person collection talk. The researcher is never asked about a person.
  { name: 'this user’s own collection', re: /\b(?:my|our|their|his|her)\s+(?:collection|binder|cards|deck\s*list|account|profile)\b/i },
  { name: 'what the reader owns', re: /\b(?:i|they|he|she|we)\s+(?:own|owns|have|has|hold|holds)\b/i },
];

export type QueryVerdict =
  | { ok: true; query: string }
  | { ok: false; reason: string };

/**
 * May this query be sent to the research provider?
 *
 * `displayName` is the reader's own name when the caller knows it, so a query
 * carrying it is refused. Matched on a WORD BOUNDARY and only when it is long
 * enough to be distinctive: plenty of people are called Mew, Ash or Red, and
 * refusing every question containing those would break research to protect
 * nothing — "Ash" is also a substring of "Marshadow", which is why a bare
 * `includes` would have been worse than useless.
 */
export function checkResearchQuery(raw: unknown, displayName?: string | null): QueryVerdict {
  if (typeof raw !== 'string') return { ok: false, reason: 'the query was not text' };
  const query = raw.trim();
  if (!query) return { ok: false, reason: 'the query was empty' };
  if (query.length > MAX_QUERY) {
    return { ok: false, reason: `the query was ${query.length} characters and the limit is ${MAX_QUERY}` };
  }
  for (const f of FORBIDDEN) {
    if (f.re.test(query)) {
      return { ok: false, reason: `the query contained ${f.name}, which never leaves DeckPal` };
    }
  }
  if (displayName) {
    const n = displayName.trim();
    if (n.length >= 4) {
      const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`\\b${escaped}\\b`, 'i').test(query)) {
        return { ok: false, reason: "the query contained this reader's name, which never leaves DeckPal" };
      }
    }
  }
  return { ok: true, query };
}
