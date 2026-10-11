// Pure view logic for the Battles tab's v2 fields (migration 084): where a game
// came from, how an opponent archetype key reads, the most-faced summary, and
// the turning points read off a digest's prize timeline. No React, no fetch and
// only TYPE imports from lib/api, so node:test can load it without a browser
// (lib/api pulls lib/supabase, which reads import.meta.env at import time).

import type {
  BattleArchetypeRecord,
  BattleDigest,
  BattleDigestSide,
  BattleLogOrigin,
  BattleLogSummary,
  BattleResult,
} from '../../lib/api'

// ── Origin ────────────────────────────────────────────────────────────────────

/** A row from before migration 084 has no `origin`; every one of those was a pasted PTCG Live log. */
export function logOrigin(log: { origin?: BattleLogOrigin | null }): BattleLogOrigin {
  return log.origin ?? 'ptcgl'
}

/** The quiet text marker on each row. */
export const ORIGIN_LABEL: Record<BattleLogOrigin, string> = {
  ptcgl: 'TCG Live',
  in_person: 'In person',
  other: 'Other source',
}

/**
 * Whether a game log can exist, so whether the detail may ask for the digest at
 * all. An in-person game never has one (the digest route 404s it by design).
 * `other` MAY carry one — the digest's own 404 settles that case.
 */
export function mayHaveGameLog(origin: BattleLogOrigin): boolean {
  return origin !== 'in_person'
}

/** `ptcgl` rows are guaranteed a raw log by a CHECK constraint (migration 084). */
export function hasGuaranteedGameLog(origin: BattleLogOrigin): boolean {
  return origin === 'ptcgl'
}

/**
 * What the detail says in place of a game log that does not exist — `rawLog`
 * is NULL for every in-person game and may be for `other`. Never an empty box.
 */
export function noGameLogText(origin: BattleLogOrigin): string {
  return origin === 'in_person' ? 'Reported in person — no game log' : 'Logged without a game log'
}

// ── Review ────────────────────────────────────────────────────────────────────

/** Whitespace-only is no review: render nothing rather than an empty section. */
export function hasReview(reviewMd: string | null | undefined): reviewMd is string {
  return typeof reviewMd === 'string' && reviewMd.trim().length > 0
}

// ── Archetypes ────────────────────────────────────────────────────────────────

/**
 * The same key rule as `normalizeOpponentArchetype` in
 * apps/api/src/deck/battlelog.ts — kept byte-for-byte so a free-text opponent
 * deck can be recognised as the human spelling of a stored key.
 */
export function archetypeKey(value: string | null | undefined): string | null {
  if (value == null) return null
  const normalized = value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’'‘]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return normalized.length > 0 && normalized.length <= 64 ? normalized : null
}

// Mechanic suffixes keep their printed case; a key has lowercased them all.
const MECHANIC: Record<string, string> = { ex: 'ex', gx: 'GX', v: 'V', vmax: 'VMAX', vstar: 'VSTAR' }
// The key drops apostrophes (`N's` → `ns`). These trainer-owned prefixes are the
// common ones; anything else falls back to plain title case, which is still legible.
const POSSESSIVE: Record<string, string> = {
  ns: "N's", ionos: "Iono's", hops: "Hop's", lillies: "Lillie's", marnies: "Marnie's", ethans: "Ethan's",
  cynthias: "Cynthia's", arvens: "Arven's", stevens: "Steven's", mistys: "Misty's", erikas: "Erika's",
  brocks: "Brock's", rockets: "Rocket's",
}

/**
 * A readable label for an archetype key. Prefers a human spelling the reader
 * (or the parser) already wrote — any `opponentDeck` whose key IS this key —
 * and otherwise rebuilds one: `dragapult-ex` → "Dragapult ex".
 */
export function archetypeLabel(key: string, spellings: Iterable<string | null | undefined> = []): string {
  for (const s of spellings) {
    if (s && archetypeKey(s) === key) return s.trim()
  }
  return key
    .split('-')
    .filter(Boolean)
    .map((w) => MECHANIC[w] ?? POSSESSIVE[w] ?? w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

/** What a row shows for the opponent's deck: the archetype when classified, else the free text. */
export function rowArchetypeText(log: Pick<BattleLogSummary, 'opponentArchetype' | 'opponentDeck'>): string | null {
  if (log.opponentArchetype) return archetypeLabel(log.opponentArchetype, [log.opponentDeck])
  return log.opponentDeck?.trim() || null
}

/**
 * The free-text opponent deck, only when it says more than the archetype label
 * already on the row ("Dragapult ex / Dusknoir" beside "Dragapult ex").
 */
export function extraOpponentDeck(log: Pick<BattleLogSummary, 'opponentArchetype' | 'opponentDeck'>): string | null {
  const deck = log.opponentDeck?.trim()
  if (!deck) return null
  if (!log.opponentArchetype) return null // it is already the row's label
  return archetypeKey(deck) === log.opponentArchetype ? null : deck
}

export interface ArchetypeTally {
  key: string
  label: string
  games: number
  wins: number
  losses: number
  ties: number
  lastPlayedAt: string
}

export interface MostFaced {
  rows: ArchetypeTally[]
  /** `deck`: the server's all-versions, all-pages record. `loaded`: counted from the logs on screen. */
  scope: 'deck' | 'loaded'
}

/**
 * The "most faced" summary, from data the tab has ALREADY loaded — no extra
 * request. Unfiltered, the list response's own `archetypes` is the honest
 * source: it spans every page. Under a version filter that record would answer
 * a different question (it ignores the filter), so the loaded logs — which the
 * filter did scope — are tallied instead. Sorted by games, then most recently
 * faced, then key; unclassified logs are not an archetype and are left out.
 */
export function mostFacedArchetypes(input: {
  logs: BattleLogSummary[]
  archetypes?: BattleArchetypeRecord[] | null
  version: number | null
  limit?: number
}): MostFaced {
  const { logs, archetypes, version, limit = 5 } = input
  const spellings = logs.map((l) => l.opponentDeck)
  let rows: ArchetypeTally[]
  let scope: MostFaced['scope']
  if (version === null && archetypes) {
    scope = 'deck'
    rows = archetypes.map((a) => ({
      key: a.opponentArchetype,
      label: archetypeLabel(a.opponentArchetype, spellings),
      games: a.games,
      wins: a.wins,
      losses: a.losses,
      ties: a.ties,
      lastPlayedAt: a.lastPlayedAt,
    }))
  } else {
    scope = 'loaded'
    const byKey = new Map<string, ArchetypeTally>()
    for (const log of logs) {
      const key = log.opponentArchetype
      if (!key) continue
      let t = byKey.get(key)
      if (!t) {
        t = { key, label: archetypeLabel(key, spellings), games: 0, wins: 0, losses: 0, ties: 0, lastPlayedAt: log.playedAt }
        byKey.set(key, t)
      }
      t.games += 1
      if (log.result === 'win') t.wins += 1
      else if (log.result === 'loss') t.losses += 1
      else if (log.result === 'tie') t.ties += 1
      if (Date.parse(log.playedAt) > Date.parse(t.lastPlayedAt)) t.lastPlayedAt = log.playedAt
    }
    rows = [...byKey.values()]
  }
  rows.sort(
    (a, b) =>
      b.games - a.games ||
      (Date.parse(b.lastPlayedAt) || 0) - (Date.parse(a.lastPlayedAt) || 0) ||
      a.key.localeCompare(b.key),
  )
  return { rows: rows.slice(0, limit), scope }
}

// ── Digest: turning points ────────────────────────────────────────────────────

export interface TurningPoint {
  turn: number
  kind: 'first' | 'lead' | 'finish'
  side: BattleDigestSide
  text: string
}

const score = (s: { me: number; opponent: number }) => `${s.me}–${s.opponent}`

/**
 * The few moments a prize race turned on, read off the digest's timeline (the
 * route has no turning-point field of its own): who took the first prize, every
 * time the lead changed hands, and how it ended. "Lead" follows the API's own
 * `leadChanged` rule — a tie keeps the previous leader — so this list and the
 * digest's flag can never disagree. Scores read yours–theirs.
 *
 * `result` is the STORED result (explicit corrections win over the log), used
 * only to say who conceded or decked out. Empty when the owner could not be
 * identified: every one of these sentences would otherwise risk inverting.
 */
export function turningPoints(digest: BattleDigest, result: BattleResult | null): TurningPoint[] {
  const events = digest.prizeTimeline
  if (!events.length) return []
  const out: TurningPoint[] = []

  const first = events[0]!
  const ko = first.knockedOut
  out.push({
    turn: first.turn,
    kind: 'first',
    side: first.side,
    text:
      first.side === 'me'
        ? `You took the first prize${ko ? ` (their ${ko})` : ''}`
        : `They took the first prize${ko ? ` (your ${ko})` : ''}`,
  })

  const last = events[events.length - 1]!
  const taker: BattleDigestSide | null =
    digest.endReason !== 'prizes' ? null : last.score.me >= 6 ? 'me' : last.score.opponent >= 6 ? 'opponent' : null

  let leader: BattleDigestSide | null = null
  events.forEach((e, i) => {
    const ahead: BattleDigestSide | null =
      e.score.me > e.score.opponent ? 'me' : e.score.opponent > e.score.me ? 'opponent' : null
    // A last prize that also flips the lead is said once, as the finish.
    const isFinish = taker !== null && i === events.length - 1
    if (ahead && leader && ahead !== leader && !isFinish) {
      out.push({
        turn: e.turn,
        kind: 'lead',
        side: ahead,
        text: `${ahead === 'me' ? 'You' : 'They'} took the lead, ${score(e.score)}`,
      })
    }
    if (ahead) leader = ahead
  })

  const won = result ?? digest.result
  if (digest.endReason === 'prizes') {
    if (taker) {
      out.push({
        turn: last.turn,
        kind: 'finish',
        side: taker,
        text: `${taker === 'me' ? 'You took your' : 'They took their'} last prize, ${score(last.score)}`,
      })
    }
  } else if ((digest.endReason === 'concede' || digest.endReason === 'deck-out') && (won === 'win' || won === 'loss')) {
    // The side that STOPPED is the one that lost.
    const loser: BattleDigestSide = won === 'win' ? 'opponent' : 'me'
    const verb = digest.endReason === 'concede' ? 'conceded' : 'decked out'
    out.push({
      turn: digest.totalTurns,
      kind: 'finish',
      side: loser === 'me' ? 'opponent' : 'me',
      text: `${loser === 'me' ? 'You' : 'They'} ${verb} at ${score(last.score)}`,
    })
  }
  return out
}
