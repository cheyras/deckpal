/**
 * PTCG Live battle-log parser (Deck Intelligence plan §2). Pure — no DB, no I/O —
 * so it is unit-testable against real pasted logs.
 *
 * A Live log is line-oriented: a `Setup` section (coin flip, opening hands,
 * mulligans), then turn blocks headed `<name>'s Turn`, then a final
 * `All Prize cards taken. <name> wins.` (or `<name> conceded…`). Action lines the
 * parser understands: played X to the Bench/Active Spot, evolved A to B,
 * attached X to Y, used <attack> on <player>'s <mon> for N damage,
 * `X was Knocked Out!`, `took a Prize card` / `took N Prize cards`.
 *
 * Player identification: the deck owner ("me") is found by scoring both player
 * names on the overlap between the cards they play/attach/evolve and the deck's
 * own card names. A clear margin (≥2 distinct names) → confidence 'high'. An
 * explicit `playerName` always wins. Ambiguous → confidence 'low', me = null —
 * the API layer then requires playerName or an explicit result.
 *
 * Tolerance is the prime directive: unknown lines are skipped, sub-bullets
 * (`- …`, `   • …`) are folded in or ignored, curly apostrophes (PlayerA’s) are
 * normalized, and the parser NEVER throws on arbitrary text — worst case it
 * returns the empty low-confidence shape.
 */

export interface ParsedBattleLog {
  players: { me: string | null; opponent: string | null };
  confidence: 'high' | 'low';
  result: 'win' | 'loss' | 'tie' | null;
  wentFirst: 'me' | 'opponent' | null;
  totalTurns: number;
  prizesTaken: { me: number; opponent: number };
  knockouts: { byMe: string[]; byOpponent: string[] };
  opponentPokemon: string[];
  myPokemon: string[];
  opponentDeckGuess: string | null;
  /**
   * Per-player extraction independent of owner identification: each player's
   * distinct card NAME keys (lowercased, codes stripped) and the raw Live card
   * codes they played. Populated for both players even when "me" is unresolved,
   * so scoreDeckMatch can rank decks against a deck-agnostic parse.
   */
  playerCards: PlayerCardSummary[];
  /**
   * Set when the parse looks populated but owner identification failed in a way
   * that smells like a PTCG Live format change the stripper does not yet know
   * (cards were played but neither player overlaps the deck). Null otherwise.
   */
  warning: string | null;
}

/** One player's extracted cards, kept separate from the "me/opponent" split. */
export interface PlayerCardSummary {
  name: string;
  cardNameKeys: string[]; // distinct lowercased card names they played/attached/evolved
  cardCodes: string[]; // raw Live code tokens they played, e.g. "sv6-5_38"
}

function emptyParse(): ParsedBattleLog {
  return {
    players: { me: null, opponent: null },
    confidence: 'low',
    result: null,
    wentFirst: null,
    totalTurns: 0,
    prizesTaken: { me: 0, opponent: 0 },
    knockouts: { byMe: [], byOpponent: [] },
    opponentPokemon: [],
    myPokemon: [],
    opponentDeckGuess: null,
    playerCards: [],
    warning: null,
  };
}

/**
 * A PTCG Live card code, as the client now prints it before every card name.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * THE FORMAT CHANGED UNDER THIS PARSER AND IT FAILED QUIETLY
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Live began prefixing every card with its set code:
 *
 *     JazzyWazzy11222 played (sv10_102) Cynthia's Gible to the Active Spot.
 *
 * Every action line still matched, so the parser still counted turns and still
 * returned a populated-looking result. What broke is that the card NAME it
 * extracts became `(sv10_102) Cynthia's Gible` — and player identification
 * scores the overlap between the names a player uses and the names in the deck,
 * which is now zero for BOTH players, because no deck contains a card called
 * "(sv10_102) Cynthia's Gible".
 *
 * Measured across the owner's own history, re-parsed with and without this:
 *
 *   #47 #46 #40 #38 #35   confidence LOW, no owner, 0-0 prizes, no knockouts
 *   #36 #34               confidence HIGH and the owner identified as THE
 *                         OPPONENT — prizes, knockouts and the win/loss all
 *                         attributed to the wrong player
 *   #41 #39 #37           high, but the deck guess read
 *                         "(me1_1) Bulbasaur / (me1_8…)"
 *
 * ── HOW MUCH OF THAT REACHED THE DATABASE, CHECKED RATHER THAN ASSUMED ──────
 *
 * Less than the list implies, and the difference is worth stating plainly so
 * nobody re-derives it in a panic. Every `battle_log.result` and `opponent`
 * column on file is CORRECT: `add_battle_log` takes both explicitly, and the
 * caller supplied them whenever the parser came back unsure. The deck's
 * win/loss record was never wrong.
 *
 * The damage is confined to the `parsed` JSONB detail: **#34** is stored with
 * `players` and `prizesTaken` inverted, #46 is stored empty, and the code-era
 * rows carry codes inside their names. #36 re-parses inverted from raw but is
 * stored correctly, because that write named the player.
 *
 * An earlier draft of this comment said all of it was "stored that way". It was
 * not, and a note that overstates its own blast radius is the same failure as a
 * message that misstates its evidence. The owner reported it from the far end —
 * *"seems like he
 * interpreted MY deck as being my opponent's deck"* — and it was never the
 * model. `add_battle_log` refused the two most recent games outright, which is
 * why a battle they asked to record simply was not recorded.
 *
 * ── WHAT IT MATCHES, AND WHAT IT DELIBERATELY DOES NOT ──────────────────────
 *
 * A code is `(<set>_<number>[_variant])`: `(sv10_102)`, `(me2-5_98)`,
 * `(rsv10-5_171)`, `(mee_6)`, `(me5_29_ph)`. Underscore-then-digits is the
 * whole discriminator, and it is what keeps the damage-breakdown labels this
 * parser also reads — `(Ability) Cheer On to Glory`, `(Item) Premium Power
 * Pro` — untouched: neither has one.
 *
 * Stripped rather than captured, on purpose. The set code is genuinely useful
 * — it names the exact printing — but every consumer here matches on NAMES,
 * and half-adopting it would leave two identifiers to keep in step. If a caller
 * ever wants the printing, that is a new field, not a new meaning for this one.
 */
const LIVE_CARD_CODE = /\([A-Za-z0-9][A-Za-z0-9.-]*_\d+[A-Za-z_]*\)\s?/g;

/**
 * Curly apostrophes → straight, Live card codes removed, trailing whitespace
 * collapsed. Applied to every line before anything else reads it.
 */
function normalizeLine(line: string): string {
  return line
    .replace(/[’‘]/g, "'")
    .replace(LIVE_CARD_CODE, '')
    .replace(/\s+$/, '');
}

/**
 * Find the raw Live card code that immediately precedes `cardName` on a RAW
 * (un-stripped) line, if any. Used to capture codes for cards a player played
 * without re-introducing codes into the name strings the parser extracts —
 * `normalizeLine` strips them for names; this records them in parallel.
 *
 * Attribution is by NAME, so a damage line like
 * `PlayerB's (sv10_103) Gabite used … on PlayerA's (me5_29) Slowpoke` only
 * yields the attacker's code: we only ask for the code in front of the name we
 * are adding to that player, never the opponent's mon.
 */
function codePrecedingName(rawLine: string, cardName: string): string | null {
  const line = rawLine.replace(/[’‘]/g, "'");
  const name = cardName.replace(/[’‘]/g, "'");
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = line.match(new RegExp(`\\(([A-Za-z0-9][A-Za-z0-9.-]*_\\d+[A-Za-z_]*)\\)\\s?${esc}`));
  return m ? m[1]! : null;
}

/** Case-insensitive name key for overlap scoring ("Boss's Orders" ≡ "boss's orders"). */
function nameKey(s: string): string {
  return s.replace(/[’‘]/g, "'").trim().toLowerCase();
}

/** Per-player accumulator while walking the log. */
interface PlayerState {
  name: string;
  cardsMentioned: Set<string>; // every card they played/attached/evolved (name keys)
  codesMentioned: Set<string>; // raw Live card codes they played (e.g. "sv6-5_38")
  pokemon: string[]; // distinct mons put into play / evolved into, in order
  pokemonSeen: Set<string>;
  evolvedFrom: Set<string>; // mons that later evolved into something else
  evolvedTo: Set<string>; // mons that arrived via evolution
  prizes: number;
  knockedOut: string[]; // their own mons that were Knocked Out
}

function newPlayer(name: string): PlayerState {
  return {
    name,
    cardsMentioned: new Set(),
    codesMentioned: new Set(),
    pokemon: [],
    pokemonSeen: new Set(),
    evolvedFrom: new Set(),
    evolvedTo: new Set(),
    prizes: 0,
    knockedOut: [],
  };
}

function addCard(p: PlayerState, card: string, code?: string | null): void {
  const c = card.trim();
  if (c) p.cardsMentioned.add(nameKey(c));
  if (code) p.codesMentioned.add(code);
}

function addPokemon(p: PlayerState, mon: string, code?: string | null): void {
  const m = mon.trim();
  if (!m) return;
  addCard(p, m, code);
  const key = nameKey(m);
  if (!p.pokemonSeen.has(key)) {
    p.pokemonSeen.add(key);
    p.pokemon.push(m);
  }
}

/** Rule-box heuristic for the deck guess: 'Dragapult ex', 'Lumineon V', 'Pikachu VMAX', … */
function isRuleBoxName(name: string): boolean {
  return /\s(ex|EX|GX|V|VMAX|VSTAR|V-UNION)$/.test(name) || /\bRadiant\s/.test(name);
}

/**
 * Guess the opponent's archetype from their board: rule-box mons first, then
 * terminal evolutions (evolved into, never evolved out of), joined ' / '.
 */
function deckGuess(p: PlayerState): string | null {
  const terminal = p.pokemon.filter((m) => p.evolvedTo.has(nameKey(m)) && !p.evolvedFrom.has(nameKey(m)));
  const ruleBox = p.pokemon.filter((m) => isRuleBoxName(m) && !p.evolvedFrom.has(nameKey(m)));
  const ranked: string[] = [];
  const push = (m: string) => {
    if (!ranked.some((r) => nameKey(r) === nameKey(m))) ranked.push(m);
  };
  for (const m of ruleBox) push(m);
  for (const m of terminal) push(m);
  if (ranked.length === 0) for (const m of p.pokemon) push(m);
  return ranked.length ? ranked.slice(0, 2).join(' / ') : null;
}

/**
 * Normalize a PTCG Live card code (as printed in parens before a card name,
 * e.g. `sv6-5_38` or `me5_29_ph`) to a DeckPal catalogue card id
 * (`sv06.5-038`, `me05-029`). Returns null for anything that is not a Live
 * card code.
 *
 * Rules, derived from observed real-log pairs and verified against the repo's
 * own set-id conventions (normaliseSetId in packages/agent-tools/src/entities.ts
 * is the canonical internal format; real card ids in fixtures/tests use the
 * same padding):
 *   • The underscore separates the set token from the collector number.
 *   • The set token's leading numeric run zero-pads to 2 digits (me5 → me05,
 *     sv6 → sv06; sv10 is already two digits and stays sv10; a letters-only
 *     token like `mee` or `ec` has no run to pad).
 *   • A trailing `-N` on the set token becomes `.N` (sv6-5 → sv6.5,
 *     rsv10-5 → rsv10.5) — the catalogue writes subset sets with a dot, Live
 *     prints a dash.
 *   • The collector number zero-pads to 3 digits (38 → 038, 7 → 007).
 *   • A trailing `_xx` printing-variant suffix (only `_ph` has been observed in
 *     real logs; it marks a foil printing) is stripped and returned as `foil`.
 *
 * Observed pairs this reproduces exactly:
 *   me1_104 → me01-104,  sv7_58 → sv07-058,  sv6-5_38 → sv06.5-038,
 *   me5_29_ph → me05-029 (foil).
 * No observed pair has broken these rules; if one ever does, record it in
 * notes.md rather than bending the rules to fit it.
 */
export interface NormalizedCardCode {
  cardId: string; // catalogue card id, e.g. "sv06.5-038"
  foil: boolean; // a printing-variant suffix (e.g. _ph) was stripped
}

const CARD_CODE_RE = /^([A-Za-z0-9][A-Za-z0-9.-]*)_(\d+)(?:_([A-Za-z][A-Za-z0-9]*))?$/;

export function normalizeCardCode(raw: string): NormalizedCardCode | null {
  if (typeof raw !== 'string') return null;
  const token = raw.replace(/^\(/, '').replace(/\)$/, '').trim();
  const m = token.match(CARD_CODE_RE);
  if (!m) return null;
  return {
    cardId: `${normaliseSetToken(m[1]!)}-${m[2]!.padStart(3, '0')}`,
    foil: m[3] !== undefined,
  };
}

/** Set-token half of normalizeCardCode: lowercase, `-N` → `.N`, pad one digit. */
function normaliseSetToken(raw: string): string {
  let s = raw.toLowerCase().replace(/-(\d+)$/, '.$1');
  const m = s.match(/^([a-z]+)(\d)(\D.*)?$/);
  if (m) s = `${m[1]}0${m[2]}${m[3] ?? ''}`;
  return s;
}

/**
 * Count distinct deck cards mentioned by a player — the name-key overlap used
 * for owner identification. Shared by the parser's own owner scoring and by
 * scoreDeckMatch so the two cannot drift apart.
 */
export function overlapScore(playerCardNameKeys: Iterable<string>, deckNameKeys: Set<string>): number {
  let n = 0;
  for (const c of playerCardNameKeys) if (deckNameKeys.has(c)) n++;
  return n;
}

export interface DeckCardForMatch {
  name: string;
  /** Catalogue card id (card.tcgdex_id), e.g. "sv06.5-038". When present,
   * normalized Live codes that resolve to it strengthen the score. */
  cardId?: string | null;
}

export interface DeckMatchScore {
  score: number; // ranking score: matchedNames + matchedCodes
  matchedNames: number; // distinct deck card names the log's best player touched
  matchedCodes: number; // distinct Live codes that normalized to a deck card id
  total: number; // number of deck card entries considered
}

/**
 * Score how well a parsed log matches one deck's card list. Names overlap the
 * way the parser's owner identification does (via the shared overlapScore); when
 * the log carries Live card codes, each code that normalizes to one of the
 * deck's card ids adds an extra point, so a deck whose exact printings match
 * ranks above one that matches only by (possibly ambiguous) names. The deck is
 * one player's, so the best-scoring player is taken as its owner.
 */
export function scoreDeckMatch(parsed: ParsedBattleLog, deckCards: DeckCardForMatch[]): DeckMatchScore {
  const deckNameKeys = new Set(deckCards.map((c) => nameKey(c.name)));
  const deckCardIds = new Set(
    deckCards
      .map((c) => c.cardId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0),
  );
  const total = deckCards.length;
  let bestNames = 0;
  let bestCodes = 0;
  for (const pl of parsed.playerCards) {
    const names = overlapScore(pl.cardNameKeys, deckNameKeys);
    let codes = 0;
    for (const raw of pl.cardCodes) {
      const n = normalizeCardCode(raw);
      if (n && deckCardIds.has(n.cardId)) codes++;
    }
    const score = names + codes;
    if (score > bestNames + bestCodes || (score === bestNames + bestCodes && names > bestNames)) {
      bestNames = names;
      bestCodes = codes;
    }
  }
  return { score: bestNames + bestCodes, matchedNames: bestNames, matchedCodes: bestCodes, total };
}

export interface MergedLogFields {
  result: 'win' | 'loss' | 'tie' | null;
  opponent: string | null;
  opponentDeck: string | null;
}

/**
 * Merge caller-supplied battle-log fields with parser output. Explicit values
 * ALWAYS win; the parser fills whatever the caller omitted. Create semantics:
 * a null/undefined explicit value means "omit" (the route turns an explicit null
 * result into undefined before calling, since clearing on create is meaningless),
 * so the parser fills it.
 *
 * Extracted to a pure function so the override contract is unit-testable without
 * a DB — the POST /:id/logs handler is thin and calls this.
 */
export function mergeLogFields(
  parsed: ParsedBattleLog,
  explicit: { result?: 'win' | 'loss' | 'tie' | null; opponent?: string | null; opponentDeck?: string | null },
): MergedLogFields {
  return {
    result: explicit.result ?? parsed.result,
    opponent: explicit.opponent ?? parsed.players.opponent,
    opponentDeck: explicit.opponentDeck ?? parsed.opponentDeckGuess,
  };
}


/**
 * Parse a raw PTCG Live log. `deckCardNames` are the owning deck's card names
 * (used to identify which player is "me"); `playerName`, when given, overrides
 * the overlap scoring entirely.
 */
export function parseBattleLog(rawLog: string, deckCardNames: string[], playerName?: string): ParsedBattleLog {
  try {
    return parseInner(rawLog, deckCardNames, playerName);
  } catch {
    // The contract is "never throws on arbitrary text" — degrade to the empty shape.
    return emptyParse();
  }
}

function parseInner(rawLog: string, deckCardNames: string[], playerName?: string): ParsedBattleLog {
  const out = emptyParse();
  if (typeof rawLog !== 'string' || !rawLog.trim()) return out;

  const lines = rawLog.split(/\r?\n/).map(normalizeLine);

  // ── Pass 1: discover the two player names ──────────────────────────────────
  // Turn headers are authoritative; setup lines fill in a player who never got a
  // turn (e.g. a turn-1 concession).
  const players = new Map<string, PlayerState>();
  const player = (name: string): PlayerState => {
    let p = players.get(name);
    if (!p) {
      p = newPlayer(name);
      players.set(name, p);
    }
    return p;
  };
  const SETUP_RE = /^(.+?) (?:chose (?:heads|tails)|won the coin toss|decided to go (?:first|second)|drew \d+ cards for the opening hand|took a mulligan)/;
  for (const line of lines) {
    const turn = line.match(/^(.+)'s Turn$/);
    if (turn) {
      player(turn[1]!);
      continue;
    }
    if (players.size < 2) {
      const setup = line.match(SETUP_RE);
      if (setup) player(setup[1]!);
    }
  }
  const names = [...players.keys()];
  if (names.length === 0) return out;

  // ── Pass 2: walk every line, attributing actions to their player ───────────
  // Sub-actions ('- PlayerB evolved …' under Rare Candy) are real actions with a
  // dash prefix; bullet card lists ('   • …') are ignored. We iterate the RAW
  // lines (pre-stripped) so codePrecedingName can capture Live card codes for
  // the cards a player played, while normalizeLine still feeds the action
  // regexes a code-stripped line so names stay clean.
  let goesFirst: string | null = null;
  let winner: string | null = null;
  let conceder: string | null = null;
  let totalTurns = 0;

  const rawLines = rawLog.split(/\r?\n/);
  for (const orig of rawLines) {
    if (/^\s*•/.test(orig)) continue;
    const line = normalizeLine(orig).replace(/^-\s+/, '').trim();
    if (!line) continue;

    if (/^.+'s Turn$/.test(line)) {
      totalTurns += 1;
      continue;
    }

    // `<name> wins.` closes the game regardless of what sentence precedes it on
    // the line: 'All Prize cards taken.', 'Opponent was inactive for too long.'
    // (timeout — the battle-#8 miss), a concede notice, or nothing at all. The
    // greedy prefix must end at sentence punctuation so the captured name stays
    // exactly a player name.
    const win = line.match(/^(?:.*[.!?]\s+)?(.+?) wins\.?$/);
    if (win && players.has(win[1]!)) {
      winner = win[1]!;
      continue;
    }
    const conc = line.match(/^(.+?) conceded/);
    if (conc && players.has(conc[1]!)) {
      conceder = conc[1]!;
      continue;
    }

    // Match the acting/owning player by exact prefix — names may contain spaces
    // or apostrophes, so try each known name rather than a generic capture.
    for (const p of players.values()) {
      const n = p.name;
      if (line.startsWith(`${n} `)) {
        const rest = line.slice(n.length + 1);
        let m: RegExpMatchArray | null;
        if ((m = rest.match(/^decided to go (first|second)\.?$/))) {
          goesFirst = m[1] === 'first' ? n : (names.find((x) => x !== n) ?? null);
        } else if ((m = rest.match(/^played (.+?) to the (?:Bench|Active Spot)\.?$/))) {
          addPokemon(p, m[1]!, codePrecedingName(orig, m[1]!));
        } else if ((m = rest.match(/^played (.+?) to the Stadium spot\.?$/))) {
          addCard(p, m[1]!, codePrecedingName(orig, m[1]!));
        } else if ((m = rest.match(/^played (.+?)\.$/))) {
          addCard(p, m[1]!, codePrecedingName(orig, m[1]!)); // trainer / stadium replay
        } else if ((m = rest.match(/^evolved (.+?) to (.+?)(?: (?:in the Active Spot|on the Bench))?\.?$/))) {
          addPokemon(p, m[2]!, codePrecedingName(orig, m[2]!));
          addCard(p, m[1]!, codePrecedingName(orig, m[1]!));
          p.evolvedFrom.add(nameKey(m[1]!));
          p.evolvedTo.add(nameKey(m[2]!));
        } else if ((m = rest.match(/^attached (.+?) to .+$/))) {
          addCard(p, m[1]!, codePrecedingName(orig, m[1]!));
        } else if ((m = rest.match(/^took (\d+) Prize cards?\.?$/))) {
          p.prizes += Number(m[1]);
        } else if (rest.match(/^took a Prize card\.?$/)) {
          p.prizes += 1;
        }
        break;
      }
      if (line.startsWith(`${n}'s `)) {
        const rest = line.slice(n.length + 3);
        let m: RegExpMatchArray | null;
        if ((m = rest.match(/^(.+?) was Knocked Out!/))) {
          p.knockedOut.push(m[1]!.trim());
          addPokemon(p, m[1]!, codePrecedingName(orig, m[1]!));
        } else if ((m = rest.match(/^(.+?) used .+$/))) {
          addPokemon(p, m[1]!, codePrecedingName(orig, m[1]!)); // attacker/ability user is that player's mon
        } else if ((m = rest.match(/^(.+?) is now in the Active Spot\.?$/))) {
          addPokemon(p, m[1]!, codePrecedingName(orig, m[1]!));
        }
        break;
      }
    }
  }

  out.totalTurns = totalTurns;

  // Per-player extraction (both players), independent of who "me" is — the
  // log-preview route parses deck-agnostic and ranks decks off this.
  out.playerCards = names.map((n) => {
    const p = players.get(n)!;
    return { name: n, cardNameKeys: [...p.cardsMentioned], cardCodes: [...p.codesMentioned] };
  });

  // ── Identify "me" ──────────────────────────────────────────────────────────
  let me: PlayerState | null = null;
  let confidence: 'high' | 'low' = 'low';
  const deckKeys = new Set(deckCardNames.map(nameKey));
  const override = playerName ? names.find((n) => nameKey(n) === nameKey(playerName)) : undefined;
  if (override) {
    me = players.get(override)!;
    confidence = 'high';
  } else if (names.length >= 2) {
    const scored = names
      .map((n) => ({ p: players.get(n)!, score: overlapScore(players.get(n)!.cardsMentioned, deckKeys) }))
      .sort((a, b) => b.score - a.score);
    // "Clear margin": the runner-up matched nothing at all, or trails by ≥2
    // distinct names. (Both players share generic trainers/energy, so a bare
    // 1-name lead over a non-zero score is not decisive.)
    if (scored[0]!.score > scored[1]!.score && (scored[1]!.score === 0 || scored[0]!.score - scored[1]!.score >= 2)) {
      me = scored[0]!.p;
      confidence = 'high';
    }
  } else if (names.length === 1) {
    // Only one name ever appeared — cannot tell who owns the deck.
    me = null;
  }

  if (!me) {
    out.confidence = 'low';
    // ── Drift tripwire (commit 9237a77 incident) ───────────────────────────────
    // The format-change that broke this parser failed QUIETLY: the log still
    // parsed out real played cards, but the card NAMES the stripper did not know
    // how to clean left both players' deck-overlap scores at zero — a populated-
    // looking result that was silently wrong. When the same signature reappears
    // (cards were played, a real deck was supplied, neither player overlaps it),
    // say so explicitly instead of returning a confident-looking wrong answer.
    // Only fires when a deck was actually supplied: a deck-agnostic parse (the
    // log-preview route passes []) has no deck to overlap and must not warn.
    if (
      deckCardNames.length > 0 &&
      names.length >= 2 &&
      names.every((n) => players.get(n)!.cardsMentioned.size > 0) &&
      names.every((n) => overlapScore(players.get(n)!.cardsMentioned, deckKeys) === 0)
    ) {
      out.warning =
        "Played cards were found but neither player overlaps the deck's card names (both owner-overlap scores are 0) — this is the signature of a PTCG Live log format DRIFT the parser does not yet handle. Verify the log format, or pass playerName and an explicit result.";
    }
    return out;
  }

  const opp = players.get(names.find((n) => n !== me!.name) ?? '') ?? null;
  out.players = { me: me.name, opponent: opp?.name ?? null };
  out.confidence = confidence;
  out.wentFirst = goesFirst === null ? null : goesFirst === me.name ? 'me' : 'opponent';
  out.prizesTaken = { me: me.prizes, opponent: opp?.prizes ?? 0 };
  // byMe = opponent mons I Knocked Out; byOpponent = my mons they Knocked Out.
  out.knockouts = { byMe: opp?.knockedOut ?? [], byOpponent: me.knockedOut };
  out.myPokemon = me.pokemon;
  out.opponentPokemon = opp?.pokemon ?? [];
  out.opponentDeckGuess = opp ? deckGuess(opp) : null;

  if (winner) {
    out.result = winner === me.name ? 'win' : 'loss';
  } else if (conceder) {
    out.result = conceder === me.name ? 'loss' : 'win';
  } else {
    out.result = null; // no win/concede line — a tie or a truncated log; caller decides
  }
  return out;
}
