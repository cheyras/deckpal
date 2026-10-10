import { Router } from 'express'
import type { DeckInput } from '@deckpal/sim'
import { dbHandle, q } from '../db.js'
import type { FormatCode } from '../deck/index.js'
import { deckNotes, parseSimulateBody, pickOpponents, pilotFactory, resolveDeckRef, runMatchups, type OwnedDeck } from '../deck/simulate.js'
import { asyncHandler, badRequest, oneOf, userCache } from '../http.js'
import { currentUserId } from '../identity.js'
import { cardFrames } from '../sim/frames.js'
import { deckCheckInputLines, resolveCheckLines } from './deckCheck.js'

/**
 * POST /decks/simulate — play the caller's deck (a saved deck, or an ad-hoc
 * list in check_deck's shape) against their other decks in the battle
 * simulator (@deckpal/sim) and return `{ text, report }`: the compact text an
 * assistant reads and the structured report it came from.
 *
 * Read-only. The simulated games are never stored: they are a computation over
 * decklists, not a battle record, and `battle_logs` stays the place for games
 * people actually played. Pure logic (parsing, resolution, the time budget) is
 * in deck/simulate.ts; this file only reads the database.
 */
export const deckSimulateRouter: Router = Router()
const FORMATS = ['standard', 'expanded', 'glc', 'unlimited'] as const

interface CardCount { card_id: string; quantity: number }

async function deckInput(name: string, counts: CardCount[]): Promise<{ deck: DeckInput; notes: string[] }> {
  // Ascending catalogue id: a fixed order, so the same deck and seed always deal the same games.
  const rows = counts.slice().sort((a, b) => Number(a.card_id) - Number(b.card_id))
  const frames = await cardFrames(dbHandle(), rows.map((r) => Number(r.card_id)))
  const missing: string[] = []
  const cards: DeckInput['cards'] = []
  for (const r of rows) {
    const frame = frames.get(Number(r.card_id))
    if (frame) cards.push({ frame, count: r.quantity })
    else missing.push(`card ${r.card_id}`)
  }
  const deck = { name, cards }
  return { deck, notes: deckNotes(deck, missing) }
}

deckSimulateRouter.post('/', asyncHandler(async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>
  const params = parseSimulateBody(body)
  const userId = currentUserId(req)
  const decks = await q<OwnedDeck>(
    `SELECT id::text AS id, name FROM deck WHERE user_id = $1 AND deleted_at IS NULL
      ORDER BY is_favorite DESC, updated_at DESC`,
    [userId],
  )

  let subjectId: string | null = null
  let subjectName = params.name
  let adHocCounts: CardCount[] | null = null
  if (params.deckRef) {
    const d = resolveDeckRef(params.deckRef, decks)
    subjectId = d.id
    subjectName = d.name
  } else {
    const format = oneOf<FormatCode>(body.format, FORMATS, 'standard')
    const lines = await resolveCheckLines(deckCheckInputLines(body), format, userId)
    const unresolved = lines.filter((l) => !l.card).map((l) => l.line.name ?? l.line.card_id ?? '?')
    if (unresolved.length) throw badRequest(`Could not resolve: ${unresolved.join(', ')}. Run check_deck to fix the list first.`)
    adHocCounts = lines.map((l) => ({ card_id: String(l.card!.id), quantity: l.line.quantity }))
  }

  const opponents = pickOpponents(params.opponents, decks, subjectId)
  if (!opponents.length) throw badRequest('No opponent decks to play against: save at least one other deck, or name opponents.')

  const ids = [...new Set([...(subjectId ? [subjectId] : []), ...opponents.map((o) => o.id)])]
  const rows = await q<{ deck_id: string; card_id: string; quantity: number }>(
    `SELECT deck_id::text AS deck_id, card_id::text AS card_id, sum(quantity)::int AS quantity
       FROM deck_card WHERE user_id = $1 AND deck_id = ANY($2::uuid[])
      GROUP BY deck_id, card_id`,
    [userId, ids],
  )
  const byDeck = new Map<string, CardCount[]>()
  for (const r of rows) {
    const list = byDeck.get(r.deck_id) ?? []
    list.push({ card_id: r.card_id, quantity: Number(r.quantity) })
    byDeck.set(r.deck_id, list)
  }

  const notes: string[] = []
  const subject = await deckInput(subjectName, adHocCounts ?? byDeck.get(subjectId!) ?? [])
  if (!subject.deck.cards.length) throw badRequest(`${subjectName} has no cards to simulate.`)
  notes.push(...subject.notes)
  const opponentDecks: DeckInput[] = []
  for (const o of opponents) {
    const built = await deckInput(o.name, byDeck.get(o.id) ?? [])
    if (!built.deck.cards.length) {
      notes.push(`${o.name} has no cards — skipped.`)
      continue
    }
    notes.push(...built.notes)
    opponentDecks.push(built.deck)
  }
  if (!opponentDecks.length) throw badRequest('Every opponent deck is empty — nothing to play against.')

  // The database work is done; everything from here is CPU, yielding between pairs.
  const out = await runMatchups(subject.deck, opponentDecks, { games: params.games, seed: params.seed, notes, pilot: pilotFactory(params.speed) })
  userCache(res)
  res.json(out)
}))
