import { Router } from 'express'
import {
  deckOdds, OddsError, ODDS_KINDS, ODDS_MAX_GROUP_ITEMS, ODDS_MAX_GROUPS, ODDS_MAX_QUERIES, ODDS_MAX_TRIALS,
  ODDS_MAX_TURN, ODDS_MIN_TRIALS, ODDS_DEFAULT_SEED, ODDS_DEFAULT_TRIALS,
  type OddsEntry, type OddsGroup, type OddsKind, type OddsQuery,
} from '../deck/odds.js'
import { asyncHandler, badRequest, notFound, userCache, UUID_RE } from '../http.js'
import { currentUserId } from '../identity.js'
import { deckCheckInputLines, resolveInputLines, type InputLine } from './deckCheck.js'
import { loadDeckEntries } from './decks.js'

/**
 * POST /decks/odds — opening-hand, Prize and draw odds for a saved deck or an
 * unsaved list (`deck/odds.ts` is the model; `deck_odds` in
 * `@deckpal/agent-tools` is the caller). Writes nothing, so a read-only
 * connection may call it (auth.ts READ_ONLY_POSTS).
 *
 * Takes exactly one of `deck_id` (a UUID — the agent tool resolves names
 * first), `cards` or `ptcgl_text`; the last two are validated and resolved
 * exactly as `POST /decks/check` does it, so an agent can test a hypothetical
 * change to a list without saving it and get the same cards check_deck saw.
 */
export const deckOddsRouter: Router = Router()

export interface DeckOddsInput {
  deckId: string | null
  lines: InputLine[] | null
  queries: OddsQuery[]
  trials: number
  seed: number
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

function intIn(v: unknown, field: string, min: number, max: number, fallback: number): number {
  if (v === undefined || v === null) return fallback
  if (!Number.isSafeInteger(v) || (v as number) < min || (v as number) > max) {
    throw badRequest(`${field} must be an integer ${min}..${max}`)
  }
  return v as number
}

function parseGroup(raw: unknown, at: string): OddsGroup {
  if (!isObject(raw)) throw badRequest(`${at} must be an object`)
  const group: OddsGroup = {}
  if (raw.cards !== undefined) {
    if (!Array.isArray(raw.cards) || raw.cards.length > ODDS_MAX_GROUP_ITEMS) {
      throw badRequest(`${at}.cards must be a list of at most ${ODDS_MAX_GROUP_ITEMS} card names`)
    }
    group.cards = raw.cards.map((name, i) => {
      if (typeof name !== 'string' || !name.trim() || name.length > 80) throw badRequest(`${at}.cards[${i}] must be a card name of 1..80 characters`)
      return name.trim()
    })
  }
  if (raw.kinds !== undefined) {
    if (!Array.isArray(raw.kinds) || raw.kinds.length > ODDS_KINDS.length) throw badRequest(`${at}.kinds must be a list of kinds`)
    group.kinds = raw.kinds.map((kind, i) => {
      if (typeof kind !== 'string' || !(ODDS_KINDS as readonly string[]).includes(kind)) {
        throw badRequest(`${at}.kinds[${i}] must be one of ${ODDS_KINDS.join(', ')}`)
      }
      return kind as OddsKind
    })
  }
  if (!group.cards?.length && !group.kinds?.length) throw badRequest(`${at} needs at least one card name or kind`)
  group.count = intIn(raw.count, `${at}.count`, 1, 60, 1)
  return group
}

function parseQuery(raw: unknown, at: string): OddsQuery {
  if (!isObject(raw)) throw badRequest(`${at} must be an object`)
  const query: OddsQuery = { all_of: [] }
  if (raw.label !== undefined && raw.label !== null) {
    if (typeof raw.label !== 'string' || raw.label.length > 80) throw badRequest(`${at}.label must be a string of at most 80 characters`)
    if (raw.label.trim()) query.label = raw.label.trim()
  }
  if (!Array.isArray(raw.all_of) || raw.all_of.length < 1 || raw.all_of.length > ODDS_MAX_GROUPS) {
    throw badRequest(`${at}.all_of must hold 1..${ODDS_MAX_GROUPS} groups`)
  }
  query.all_of = raw.all_of.map((g, i) => parseGroup(g, `${at}.all_of[${i}]`))
  query.by_turn = intIn(raw.by_turn, `${at}.by_turn`, 0, ODDS_MAX_TURN, 0)
  if (raw.prized !== undefined && raw.prized !== null && typeof raw.prized !== 'boolean') throw badRequest(`${at}.prized must be true or false`)
  query.prized = raw.prized === true
  if (query.prized && query.by_turn > 0) {
    throw badRequest(`${at}: by_turn does not apply to a prized query (the Prizes are set aside before the first turn)`)
  }
  return query
}

/** Validate the body. Exported for the pure tests; throws ApiError 400/404. */
export function deckOddsInput(body: Record<string, unknown>): DeckOddsInput {
  const forms = ['deck_id', 'cards', 'ptcgl_text'].filter((k) => body[k] !== undefined)
  if (forms.length !== 1) throw badRequest('Provide exactly one of deck_id, cards or ptcgl_text')
  let deckId: string | null = null
  let lines: InputLine[] | null = null
  if (body.deck_id !== undefined) {
    if (typeof body.deck_id !== 'string' || !UUID_RE.test(body.deck_id)) throw notFound(`No deck '${String(body.deck_id).slice(0, 80)}'`)
    deckId = body.deck_id
  } else {
    lines = deckCheckInputLines(body)
  }
  let queries: OddsQuery[] = []
  if (body.queries !== undefined && body.queries !== null) {
    if (!Array.isArray(body.queries) || body.queries.length > ODDS_MAX_QUERIES) {
      throw badRequest(`queries must be a list of at most ${ODDS_MAX_QUERIES}`)
    }
    queries = body.queries.map((q, i) => parseQuery(q, `queries[${i}]`))
  }
  return {
    deckId,
    lines,
    queries,
    trials: intIn(body.trials, 'trials', ODDS_MIN_TRIALS, ODDS_MAX_TRIALS, ODDS_DEFAULT_TRIALS),
    seed: intIn(body.seed, 'seed', 0, 0xffffffff, ODDS_DEFAULT_SEED),
  }
}

deckOddsRouter.post('/', asyncHandler(async (req, res) => {
  const input = deckOddsInput((req.body ?? {}) as Record<string, unknown>)
  const userId = currentUserId(req)
  let deckName: string | null = null
  let entries: OddsEntry[]
  if (input.deckId) {
    const deck = await loadDeckEntries(input.deckId, userId)
    if (!deck) throw notFound(`No deck '${input.deckId}'`)
    deckName = deck.name
    entries = deck.entries
  } else {
    const rows = await resolveInputLines(input.lines!, 'standard', userId)
    const missing = rows.filter((row) => !row.card).map((row) => `'${row.line.name ?? row.line.card_id}'`)
    if (missing.length) {
      // Guessing what an unknown card is would put a guess into every number
      // (is it a Basic? that alone moves the mulligan rate), so say which.
      throw badRequest(
        `Could not find ${missing.join(', ')} in the card catalog, so the odds were not run. ` +
          'Fix the name or use a card_id (search_cards finds the exact card), then ask again.',
      )
    }
    entries = rows.map((row) => ({ card: row.card!, quantity: row.line.quantity }))
  }
  let result
  try {
    result = deckOdds(entries, { deckName, queries: input.queries, trials: input.trials, seed: input.seed })
  } catch (err) {
    if (err instanceof OddsError) throw badRequest(err.message)
    throw err
  }
  userCache(res)
  res.json(result)
}))
