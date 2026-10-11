/**
 * The pure half of the meta-pool refresh (scripts/meta-refresh.ts): mapping a
 * Limitless decklist line to a DeckPal card id, checking a list is a legal
 * 60-card Standard deck, and choosing the archetypes and one representative
 * list for each. No I/O and no node: imports (the engine stays runtime-agnostic):
 * the script feeds it the fetched events and standings, the PTCGL set-alias
 * table and the ACE SPEC names, and the test feeds it a small recorded fixture.
 *
 * SELECTION RULE (also in decisions/ and in the script's header):
 *  - Events: Standard, dated within the last WINDOW_DAYS days, with at least
 *    MIN_PLAYERS players.
 *  - Share: an archetype's players / all players with an archetype, over those
 *    events (every standings row counts once, decklist or not).
 *  - Archetypes: the top TOP_N by share that yield a usable list; one that
 *    cannot (an unmappable card, an illegal list) is skipped with the printed
 *    reason, never silently.
 *  - Representative list: among the archetype's decklists from its LARGEST
 *    events (the biggest LARGEST_EVENTS of them), the best match win rate
 *    (ties count half; at least MIN_ROUNDS played), then the better placing,
 *    then the larger event, then the later date. If that list does not map or
 *    is not legal the next candidate is tried, and each failure is reported.
 *  - FALLBACK: the candidates are ordered with the largest events' lists first and
 *    then ALL the archetype's other eligible lists (same ordering). So when the
 *    largest events' lists fail, a list from a smaller event can be chosen. The
 *    attempt allowance (maxTries, 5) counts failures and the success together
 *    across both groups, not per group.
 */
import type { CardFrame } from '../types.js';
import type { MetaDeck, MetaPool } from './types.js';

export const WINDOW_DAYS = 21;
export const MIN_PLAYERS = 32;
export const TOP_N = 12;
export const LARGEST_EVENTS = 3;
export const MIN_ROUNDS = 6;
export const STANDARD_MARKS = ['H', 'I', 'J'];

export interface LimitlessEvent {
  id: string;
  name: string;
  date: string;
  players: number;
}
export interface LimitlessCard {
  count: number;
  set: string;
  number: string;
  name: string;
}
export interface LimitlessList {
  pokemon: LimitlessCard[];
  trainer: LimitlessCard[];
  energy: LimitlessCard[];
}
export interface LimitlessStanding {
  deck?: { id?: string | null; name?: string | null } | null;
  record?: { wins: number; losses: number; ties: number } | null;
  placing?: number | null;
  decklist?: LimitlessList | null;
}
export interface SetAliasEntry {
  set: string | null;
  kind?: string;
  number_offset?: number;
}

/** An event with its standings, as the script fetched them. */
export interface EventStandings {
  event: LimitlessEvent;
  standings: LimitlessStanding[];
}

export const fold = (s: string) =>
  s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();

const BASIC_ENERGY_IDS: Record<string, string> = {
  grass: 'mee-001', fire: 'mee-002', water: 'mee-003', lightning: 'mee-004',
  psychic: 'mee-005', fighting: 'mee-006', darkness: 'mee-007', metal: 'mee-008',
};

/** The type of a basic Energy by name ("Fire Energy", "Basic Fire Energy"), else null. */
export function basicEnergyType(name: string): string | null {
  const m = /^(?:basic )?(grass|fire|water|lightning|psychic|fighting|darkness|metal) energy$/.exec(fold(name));
  return m ? m[1]! : null;
}

export type Mapped = { ok: true; id: string; verified: boolean } | { ok: false; reason: string };

/**
 * One Limitless line → a catalogue card id ('sv06-130'), via the same PTCGL set
 * alias table the deck importer uses (apps/api/src/deck/data/ptcgl-set-alias.json:
 * set code → TCGdex set id, plus a number offset). When the id is in `frames`
 * (the sim's card snapshot, which does not hold every Standard card) it must
 * carry the printed name; if the number does not land on that name, the one
 * card of that name in the aliased set is used (the importer's name_in_set
 * step). An id the snapshot lacks is still used, flagged `verified: false`:
 * the API checks its name against the live catalogue before playing it.
 */
export function mapCard(card: LimitlessCard, aliases: Record<string, SetAliasEntry>, frames: Record<string, CardFrame>): Mapped {
  const code = card.set.trim().toUpperCase();
  const alias = aliases[code];
  const want = fold(card.name);
  const bt = basicEnergyType(card.name);
  if (alias?.set && alias.kind !== 'unmapped') {
    const num = card.number.trim();
    const numeric = /^\d+$/.test(num) ? String(parseInt(num, 10) + (alias.number_offset ?? 0)).padStart(3, '0') : num.toLowerCase();
    const id = `${alias.set}-${numeric}`;
    const f = frames[id];
    if (f && (fold(f.name) === want || (bt && basicEnergyType(f.name) === bt))) return { ok: true, id, verified: true };
    const inSet = Object.values(frames).filter((x) => x.cardId.startsWith(`${alias.set}-`) && fold(x.name) === want);
    if (inSet.length === 1) return { ok: true, id: inSet[0]!.cardId, verified: true };
    // Basic Energy plays the same whatever its print: fall back to the standard set's.
    if (bt && frames[BASIC_ENERGY_IDS[bt]!]) return { ok: true, id: BASIC_ENERGY_IDS[bt]!, verified: true };
    // Not in the snapshot at all (no frame by that id, and none of that name in the set): trust the alias, flag it.
    if (!f && !Object.values(frames).some((x) => fold(x.name) === want && x.cardId.startsWith(`${alias.set}-`))) return { ok: true, id, verified: false };
    return { ok: false, reason: `${card.count} ${card.name} ${card.set} ${card.number}: ${id} is "${f?.name ?? '?'}" in the snapshot, not that card` };
  }
  if (bt && frames[BASIC_ENERGY_IDS[bt]!]) return { ok: true, id: BASIC_ENERGY_IDS[bt]!, verified: true };
  return { ok: false, reason: `set code ${card.set} has no mapping (${card.count} ${card.name} ${card.set} ${card.number})` };
}

export type BuiltList = { ok: true; list: [string, number][]; names: Record<string, string>; unverified: string[] } | { ok: false; reason: string };

/** Map a whole decklist: ids merged by print, sorted by id; the first unmappable line fails the list. */
export function mapList(list: LimitlessList, aliases: Record<string, SetAliasEntry>, frames: Record<string, CardFrame>): BuiltList {
  const counts = new Map<string, number>();
  const names: Record<string, string> = {};
  const unverified = new Set<string>();
  for (const c of [...list.pokemon, ...list.trainer, ...list.energy]) {
    const m = mapCard(c, aliases, frames);
    if (!m.ok) return m;
    counts.set(m.id, (counts.get(m.id) ?? 0) + c.count);
    names[m.id] = frames[m.id]?.name ?? c.name;
    if (!m.verified) unverified.add(m.id);
  }
  const ids = [...counts.keys()].sort();
  return {
    ok: true,
    list: ids.map((id) => [id, counts.get(id)!]),
    names: Object.fromEntries(ids.map((id) => [id, names[id]!])),
    unverified: ids.filter((id) => unverified.has(id)),
  };
}

/**
 * Why a list is not a legal 60-card Standard deck, or null: the size, at least
 * one Basic Pokémon, at most four of a name (basic Energy exempt), at most one
 * ACE SPEC, and every other card legal. A card is legal by NAME, as in play: if
 * any print of it is in a Standard mark (H, I, J) it is, so an older print of a
 * reprinted card passes. A card the snapshot lacks is judged by its set's mark.
 */
export function legalityProblem(
  list: [string, number][], names: Record<string, string>, frames: Record<string, CardFrame>, aceSpecNames: ReadonlySet<string>,
): string | null {
  const total = list.reduce((n, [, c]) => n + c, 0);
  if (total !== 60) return `${total} cards, not 60`;
  const legalNames = new Set<string>();
  const setMarks = new Map<string, Map<string, number>>();
  for (const f of Object.values(frames)) {
    const mark = (f.regulationMark ?? '').toUpperCase();
    if (STANDARD_MARKS.includes(mark)) legalNames.add(fold(f.name));
    const set = f.cardId.replace(/-[^-]*$/, '');
    const m = setMarks.get(set) ?? new Map<string, number>();
    m.set(mark, (m.get(mark) ?? 0) + 1);
    setMarks.set(set, m);
  }
  const setIsStandard = (id: string): boolean => {
    const m = setMarks.get(id.replace(/-[^-]*$/, ''));
    if (!m) return false;
    const top = [...m.entries()].sort((a, b) => b[1] - a[1])[0]![0];
    return STANDARD_MARKS.includes(top);
  };
  const byName = new Map<string, number>();
  let basics = 0;
  let aces = 0;
  for (const [id, count] of list) {
    const f = frames[id];
    const name = f?.name ?? names[id] ?? id;
    const key = fold(name);
    const basicEnergy = basicEnergyType(name) !== null;
    if (!basicEnergy) {
      if (!legalNames.has(key) && !(!f && setIsStandard(id))) return `${name} (${id}) is not Standard-legal (mark ${f?.regulationMark ?? 'unknown'})`;
      byName.set(key, (byName.get(key) ?? 0) + count);
    }
    if (f && f.category === 'Pokemon' && f.stage === 'Basic') basics += count;
    if (aceSpecNames.has(key)) aces += count;
  }
  for (const [name, n] of byName) if (n > 4) return `${n} copies of ${name}`;
  if (basics < 1) return 'no Basic Pokémon';
  if (aces > 1) return `${aces} ACE SPEC cards`;
  return null;
}

/** Wins plus half the ties over rounds played. */
export const winRate = (r: { wins: number; losses: number; ties: number }): number => {
  const n = r.wins + r.losses + r.ties;
  return n ? (r.wins + r.ties / 2) / n : 0;
};
export const recordText = (r: { wins: number; losses: number; ties: number }): string => `${r.wins}-${r.losses}${r.ties ? `-${r.ties}` : ''}`;
export const isoDay = (d: string): string => d.slice(0, 10);

/** Events inside the window (the `days` before `now`) with enough players. */
export function windowEvents(events: LimitlessEvent[], now: Date, days = WINDOW_DAYS, minPlayers = MIN_PLAYERS): LimitlessEvent[] {
  const from = now.getTime() - days * 86_400_000;
  return events.filter((e) => {
    const t = Date.parse(e.date);
    return Number.isFinite(t) && t >= from && t <= now.getTime() && e.players >= minPlayers;
  });
}

interface Candidate {
  event: LimitlessEvent;
  record: { wins: number; losses: number; ties: number };
  placing: number;
  decklist: LimitlessList;
}
export interface ArchetypeStat {
  id: string;
  name: string;
  players: number;
  share: number;
  candidates: Candidate[];
}

/** Archetypes by player count (share of all players with an archetype), each with its decklist candidates. */
export function rankArchetypes(all: EventStandings[]): { archetypes: ArchetypeStat[]; totalPlayers: number } {
  const byId = new Map<string, { names: Map<string, number>; players: number; candidates: Candidate[] }>();
  let totalPlayers = 0;
  for (const { event, standings } of all) {
    for (const s of standings) {
      const id = s.deck?.id?.trim();
      if (!id) continue;
      totalPlayers++;
      const a = byId.get(id) ?? { names: new Map<string, number>(), players: 0, candidates: [] as Candidate[] };
      byId.set(id, a);
      a.players++;
      const nm = s.deck?.name?.trim() || id;
      a.names.set(nm, (a.names.get(nm) ?? 0) + 1);
      const d = s.decklist;
      if (d && s.record && Number.isFinite(s.placing ?? NaN)) {
        a.candidates.push({ event, record: s.record, placing: s.placing as number, decklist: d });
      }
    }
  }
  const archetypes = [...byId.entries()]
    .filter(([id]) => id !== 'other')
    .map(([id, a]) => ({
      id,
      name: [...a.names.entries()].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))[0]![0],
      players: a.players,
      share: totalPlayers ? a.players / totalPlayers : 0,
      candidates: a.candidates,
    }))
    .sort((x, y) => y.players - x.players || (x.id < y.id ? -1 : 1));
  return { archetypes, totalPlayers };
}

/** An archetype's decklists in the order to try them (the selection rule in this file's header). */
export function orderCandidates(cands: Candidate[], largest = LARGEST_EVENTS, minRounds = MIN_ROUNDS): Candidate[] {
  const rounds = (c: Candidate) => c.record.wins + c.record.losses + c.record.ties;
  const eligible = cands.filter((c) => rounds(c) >= minRounds);
  const sizes = [...new Set(eligible.map((c) => c.event.id))]
    .map((id) => eligible.find((c) => c.event.id === id)!.event)
    .sort((a, b) => b.players - a.players || (a.id < b.id ? -1 : 1))
    .slice(0, largest)
    .map((e) => e.id);
  const cmp = (a: Candidate, b: Candidate) =>
    winRate(b.record) - winRate(a.record) || a.placing - b.placing || b.event.players - a.event.players || (a.event.date < b.event.date ? 1 : a.event.date > b.event.date ? -1 : 0) || (a.event.id < b.event.id ? -1 : 1);
  const top = eligible.filter((c) => sizes.includes(c.event.id)).sort(cmp);
  const rest = eligible.filter((c) => !sizes.includes(c.event.id)).sort(cmp);
  return [...top, ...rest];
}

export interface BuildInput {
  all: EventStandings[];
  aliases: Record<string, SetAliasEntry>;
  frames: Record<string, CardFrame>;
  aceSpecNames: ReadonlySet<string>;
  now: Date;
  /** The events listed before the window/size filter, for the pool's provenance. */
  topN?: number;
  /** Candidate lists to try per archetype before giving up on it. */
  maxTries?: number;
  windowDays?: number;
  minPlayers?: number;
}
export interface BuildResult {
  pool: MetaPool;
  /** One printed line per skipped list or archetype. */
  skipped: string[];
}

/** The pool from fetched standings: the top archetypes in share order, each with its first usable list. */
export function buildPool(input: BuildInput): BuildResult {
  const topN = input.topN ?? TOP_N;
  const maxTries = input.maxTries ?? 5;
  const { archetypes, totalPlayers } = rankArchetypes(input.all);
  const skipped: string[] = [];
  const decks: MetaDeck[] = [];
  for (const a of archetypes) {
    if (decks.length >= topN) break;
    let picked: MetaDeck | null = null;
    const ordered = orderCandidates(a.candidates);
    if (!ordered.length) skipped.push(`${a.name}: skipped — no decklist with ${MIN_ROUNDS}+ rounds played`);
    for (const c of ordered.slice(0, maxTries)) {
      const label = `${a.name} (${c.event.name}, ${isoDay(c.event.date)}, ${recordText(c.record)})`;
      const built = mapList(c.decklist, input.aliases, input.frames);
      if (!built.ok) {
        skipped.push(`${label}: list skipped — ${built.reason}`);
        continue;
      }
      const problem = legalityProblem(built.list, built.names, input.frames, input.aceSpecNames);
      if (problem) {
        skipped.push(`${label}: list skipped — not a legal Standard deck: ${problem}`);
        continue;
      }
      picked = {
        id: a.id,
        name: a.name,
        share: Math.round(a.share * 10_000) / 10_000,
        players: a.players,
        list: built.list,
        names: built.names,
        ...(built.unverified.length ? { unverified: built.unverified } : {}),
        from: { event: c.event.name, date: isoDay(c.event.date), record: recordText(c.record), placing: c.placing },
      };
      break;
    }
    if (picked) decks.push(picked);
    else if (ordered.length) skipped.push(`${a.name}: ARCHETYPE SKIPPED — none of its ${Math.min(maxTries, ordered.length)} best lists could be used`);
  }
  const events = input.all.map((e) => e.event);
  const pool: MetaPool = {
    asOf: isoDay(input.now.toISOString()),
    source: {
      name: 'Limitless online',
      url: 'https://play.limitlesstcg.com',
      note: 'Public tournament API (play.limitlesstcg.com/api). Archetype, event name/date and record only — no player names.',
    },
    window: {
      days: input.windowDays ?? WINDOW_DAYS,
      minPlayers: input.minPlayers ?? MIN_PLAYERS,
      events: events.length,
      players: totalPlayers,
      from: isoDay(new Date(input.now.getTime() - (input.windowDays ?? WINDOW_DAYS) * 86_400_000).toISOString()),
      to: isoDay(input.now.toISOString()),
    },
    format: 'standard',
    decks,
  };
  return { pool, skipped };
}
