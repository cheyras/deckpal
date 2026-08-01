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
  };
}

/** Curly apostrophes → straight, collapse trailing whitespace. Applied to every line. */
function normalizeLine(line: string): string {
  return line.replace(/[’‘]/g, "'").replace(/\s+$/, '');
}

/**
 * Case-insensitive name key for overlap scoring ("Boss's Orders" ≡ "boss's
 * orders"). Newer Live logs prefix card mentions with a printing id —
 * "(me5_39) Dhelmise" — which must not defeat the match against plain deck
 * names (it did: battle #11's owner was mis-identified at 'high' confidence
 * before this strip; see DECISIONS.md 2026-08-01).
 */
function nameKey(s: string): string {
  return s
    .replace(/^\([A-Za-z0-9.-]+_[A-Za-z0-9_-]+\)\s*/, '')
    .replace(/[’‘]/g, "'")
    .trim()
    .toLowerCase();
}

/** Per-player accumulator while walking the log. */
interface PlayerState {
  name: string;
  cardsMentioned: Set<string>; // every card they played/attached/evolved (name keys)
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
    pokemon: [],
    pokemonSeen: new Set(),
    evolvedFrom: new Set(),
    evolvedTo: new Set(),
    prizes: 0,
    knockedOut: [],
  };
}

function addCard(p: PlayerState, card: string): void {
  const c = card.trim();
  if (c) p.cardsMentioned.add(nameKey(c));
}

function addPokemon(p: PlayerState, mon: string): void {
  const m = mon.trim();
  if (!m) return;
  addCard(p, m);
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

  // LF, CRLF and lone CR all occur in pasted/clipboard text.
  const lines = rawLog.split(/\r\n|\n|\r/).map(normalizeLine);

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
  // dash prefix; bullet card lists ('   • …') are ignored.
  let goesFirst: string | null = null;
  let winner: string | null = null;
  let conceder: string | null = null;
  let totalTurns = 0;

  for (const raw of lines) {
    if (/^\s*•/.test(raw)) continue;
    const line = raw.replace(/^-\s+/, '').trim();
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
    // Word-boundary required: 'X concededness …' must not read as a concession.
    const conc = line.match(/^(.+?) conceded(?:[ .!]|$)/);
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
          addPokemon(p, m[1]!);
        } else if ((m = rest.match(/^played (.+?) to the Stadium spot\.?$/))) {
          addCard(p, m[1]!);
        } else if ((m = rest.match(/^played (.+?)\.$/))) {
          addCard(p, m[1]!); // trainer / stadium replay
        } else if ((m = rest.match(/^evolved (.+?) to (.+?)(?: (?:in the Active Spot|on the Bench))?\.?$/))) {
          addPokemon(p, m[2]!);
          addCard(p, m[1]!);
          p.evolvedFrom.add(nameKey(m[1]!));
          p.evolvedTo.add(nameKey(m[2]!));
        } else if ((m = rest.match(/^attached (.+?) to .+$/))) {
          addCard(p, m[1]!);
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
          addPokemon(p, m[1]!);
        } else if ((m = rest.match(/^(.+?) used .+$/))) {
          addPokemon(p, m[1]!); // attacker/ability user is that player's mon
        } else if ((m = rest.match(/^(.+?) is now in the Active Spot\.?$/))) {
          addPokemon(p, m[1]!);
        }
        break;
      }
    }
  }

  out.totalTurns = totalTurns;

  // ── Identify "me" ──────────────────────────────────────────────────────────
  let me: PlayerState | null = null;
  let confidence: 'high' | 'low' = 'low';
  const override = playerName ? names.find((n) => nameKey(n) === nameKey(playerName)) : undefined;
  if (override) {
    me = players.get(override)!;
    confidence = 'high';
  } else if (names.length >= 2) {
    const deckKeys = new Set(deckCardNames.map(nameKey));
    const scored = names
      .map((n) => ({
        p: players.get(n)!,
        score: [...players.get(n)!.cardsMentioned].filter((c) => deckKeys.has(c)).length,
      }))
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
