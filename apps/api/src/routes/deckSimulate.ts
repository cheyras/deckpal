import { Router, type Response } from 'express'
import { metaLabel, type DeckInput, type MetaDeck } from '@deckpal/sim'
import { dbHandle, q, rlsStore } from '../db.js'
import type { FormatCode } from '../deck/index.js'
import {
  SIM_RUN_GATE, assertDeckSize, buildDeckInput, busyMessage, cardTotal, deckSizeOk, metaCounts, metaNote, parseSimulateBody, pickOpponentsWithMeta,
  pilotFactory, resolveDeckRef, runComparison, runMatchups, SIM_DECK_MAX, SIM_DECK_MIN, type CardCount, type OwnedDeck,
} from '../deck/simulate.js'
import { asyncHandler, badRequest, oneOf, userCache } from '../http.js'
import { currentUserId } from '../identity.js'
import { cardFrames, cardsByTcgdexId } from '../sim/frames.js'
import { deckCheckInputLines, resolveCheckLines } from './deckCheck.js'

/**
 * POST /decks/simulate — play the caller's deck (a saved deck, or an ad-hoc
 * list in check_deck's shape) against their other decks and/or the built-in
 * meta pool of current Standard archetypes (`meta`, `meta:<name>`; the pool is
 * also the default when they have no other deck), in the battle simulator
 * (@deckpal/sim), and return `{ text, report }`: the compact text an assistant
 * reads and the structured report it came from.
 *
 * Read-only. The simulated games are never stored: they are a computation over
 * decklists, not a battle record, and `battle_logs` stays the place for games
 * people actually played. Pure logic (parsing, resolution, bounds, the run
 * gate, the time budget) is in deck/simulate.ts; this file only reads the
 * database, and gives its connection back before the CPU work starts.
 *
 * With `compare_with` / `compare_cards` / `compare_ptcgl_text` it is a PAIRED
 * COMPARISON instead: both versions play every opponent on the same seeds and
 * seats, and the text leads with the paired difference and a verdict. The same
 * bounds, gate, deadline and connection release apply.
 */
export const deckSimulateRouter: Router = Router()
const FORMATS = ['standard', 'expanded', 'glc', 'unlimited'] as const

/**
 * Commit and return the request's pooled connection now, in SUPABASE_MODE (the
 * RLS middleware in index.ts puts the hook on res.locals; self-host has no
 * request connection to give back). False when the request is already gone.
 * After this the handler must not query: rlsStore would still hand out the
 * released client, so the simulation runs outside the store entirely.
 */
async function releaseRequestDb(res: Response): Promise<boolean> {
  const release = res.locals.commitAndReleaseRls as (() => Promise<void>) | undefined
  if (typeof release !== 'function') return true
  try {
    await release()
    return true
  } catch {
    return false
  }
}

deckSimulateRouter.post('/', asyncHandler(async (req, res) => {
  // The budget counts from here, so the reads below come out of it.
  const startedAt = Date.now()
  const body = (req.body ?? {}) as Record<string, unknown>
  const params = parseSimulateBody(body)
  const userId = currentUserId(req)

  // One run per account and two per instance, before any work (deck/simulate.ts, THE BOUNDS).
  const slot = SIM_RUN_GATE.tryAcquire(userId)
  if (!slot.ok) {
    res.setHeader('Retry-After', String(slot.retryAfterSec))
    res.status(429).json({ error: { code: 'simulator_busy', message: busyMessage(slot.scope, slot.retryAfterSec) } })
    return
  }
  try {
    const decks = await q<OwnedDeck>(
      `SELECT id::text AS id, name FROM deck WHERE user_id = $1 AND deleted_at IS NULL
        ORDER BY is_favorite DESC, updated_at DESC`,
      [userId],
    )
    // Read only when an unsaved list needs its names resolved (the subject's or the second version's).
    const format = () => oneOf<FormatCode>(body.format, FORMATS, 'standard')

    let subjectId: string | null = null
    let subjectName = params.name
    let adHocCounts: CardCount[] | null = null
    if (params.deckRef) {
      const d = resolveDeckRef(params.deckRef, decks)
      subjectId = d.id
      subjectName = d.name
    } else {
      const input = deckCheckInputLines(body)
      // Bounded before resolving: an oversized list costs no lookups.
      assertDeckSize(subjectName, cardTotal(input))
      const lines = await resolveCheckLines(input, format(), userId)
      const unresolved = lines.filter((l) => !l.card).map((l) => l.line.name ?? l.line.card_id ?? '?')
      if (unresolved.length) throw badRequest(`Could not resolve: ${unresolved.join(', ')}. Run check_deck to fix the list first.`)
      adHocCounts = lines.map((l) => ({ card_id: String(l.card!.id), quantity: l.line.quantity }))
    }

    // The second version of a paired comparison, if any.
    let compareId: string | null = null
    let compareName = params.compare?.name ?? ''
    let compareCounts: CardCount[] | null = null
    if (params.compare?.deckRef) {
      const d = resolveDeckRef(params.compare.deckRef, decks)
      if (d.id === subjectId) throw badRequest(`compare_with is the same deck as the one being tested (${d.name}) — pass the other version.`)
      compareId = d.id
      compareName = d.name
    } else if (params.compare?.adHoc) {
      const input = deckCheckInputLines({ ...params.compare.adHoc, format: body.format })
      assertDeckSize(compareName, cardTotal(input))
      const lines = await resolveCheckLines(input, format(), userId)
      const unresolved = lines.filter((l) => !l.card).map((l) => l.line.name ?? l.line.card_id ?? '?')
      if (unresolved.length) throw badRequest(`Could not resolve in the compare list: ${unresolved.join(', ')}. Run check_deck to fix it first.`)
      compareCounts = lines.map((l) => ({ card_id: String(l.card!.id), quantity: l.line.quantity }))
    }

    const opponents = pickOpponentsWithMeta(params.opponents, decks, [subjectId, compareId])
    if (!opponents.length) throw badRequest('No opponent decks to play against: save at least one other deck, or name opponents (`meta` for the built-in Standard meta decks).')

    const ids = [...new Set([...(subjectId ? [subjectId] : []), ...(compareId ? [compareId] : []), ...opponents.flatMap((o) => (o.kind === 'saved' ? [o.deck.id] : []))])]
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

    // Sizes first, frames after: nothing out of bounds is ever loaded or played.
    const notes: string[] = []
    const subjectCounts = adHocCounts ?? byDeck.get(subjectId!) ?? []
    assertDeckSize(subjectName, cardTotal(subjectCounts))
    const secondCounts = params.compare ? (compareCounts ?? byDeck.get(compareId!) ?? []) : null
    if (secondCounts) assertDeckSize(compareName, cardTotal(secondCounts))
    const played: Array<{ name: string; counts: CardCount[] }> = []
    const metaSlots: Array<{ slot: { name: string; counts: CardCount[] }; deck: MetaDeck }> = []
    for (const o of opponents) {
      if (o.kind === 'meta') {
        // Pool lists are always 60 cards; their catalogue ids are looked up below, in one read.
        const slot = { name: metaLabel(o.deck), counts: [] as CardCount[] }
        played.push(slot)
        metaSlots.push({ slot, deck: o.deck })
        continue
      }
      const counts = byDeck.get(o.deck.id) ?? []
      const total = cardTotal(counts)
      if (deckSizeOk(total)) played.push({ name: o.deck.name, counts })
      // A named opponent is the caller's choice: tell them. A default one is skipped with a note.
      else if (params.opponents) assertDeckSize(o.deck.name, total)
      else notes.push(`${o.deck.name} has ${total} cards, outside the simulator's ${SIM_DECK_MIN}–${SIM_DECK_MAX} — skipped.`)
    }
    if (metaSlots.length) {
      const catalog = await cardsByTcgdexId(dbHandle(), metaSlots.flatMap((m) => m.deck.list.map(([id]) => id)))
      for (const { slot, deck } of metaSlots) {
        const found = metaCounts(deck, catalog)
        if (found.mismatched.length) {
          // A pool id that is a different card in the catalogue: skip the deck rather than play the wrong list.
          played.splice(played.indexOf(slot), 1)
          notes.push(`${slot.name} skipped — the catalogue disagrees with the pool on ${found.mismatched.slice(0, 3).join('; ')}.`)
          continue
        }
        slot.counts = found.counts
        if (found.missing.length) notes.push(`${slot.name}: not in the catalogue yet: ${found.missing.join(', ')} — left out of the simulated deck.`)
      }
      notes.push(metaNote())
    }
    if (!played.length) throw badRequest(`None of the opponent decks can be played (${SIM_DECK_MIN}–${SIM_DECK_MAX} cards, known to the catalogue) — nothing to play against. Name opponents, use 'meta', or finish a deck first.`)

    // Every deck's frames in one batched read (each cardFrames call is a handful of queries).
    const allCounts = [subjectCounts, ...(secondCounts ? [secondCounts] : []), ...played.map((p) => p.counts)]
    const frames = await cardFrames(dbHandle(), allCounts.flat().map((c) => Number(c.card_id)))
    const subject = buildDeckInput(subjectName, subjectCounts, frames)
    if (!subject.deck.cards.length) throw badRequest(`${subjectName} has no cards to simulate.`)
    const second = secondCounts ? buildDeckInput(compareName, secondCounts, frames) : null
    if (second && !second.deck.cards.length) throw badRequest(`${compareName} has no cards to simulate.`)
    notes.unshift(...subject.notes, ...(second?.notes ?? []))
    const opponentDecks: DeckInput[] = []
    for (const p of played) {
      const built = buildDeckInput(p.name, p.counts, frames)
      if (!built.deck.cards.length) {
        notes.push(`${p.name} has no cards the simulator knows — skipped.`)
        continue
      }
      notes.push(...built.notes)
      opponentDecks.push(built.deck)
    }
    if (!opponentDecks.length) throw badRequest('No opponent deck has cards the simulator knows — nothing to play against.')

    // The database work is done. Give the connection back before the CPU work, so
    // a 25 s run holds none of the pool; if the request is already gone, stop here.
    if (!await releaseRequestDb(res)) return
    const run = { games: params.games, seed: params.seed, notes, pilot: pilotFactory(params.speed), startedAt }
    const out = await rlsStore.exit(() =>
      second ? runComparison(subject.deck, second.deck, opponentDecks, run) : runMatchups(subject.deck, opponentDecks, run),
    )
    if (res.destroyed) return
    userCache(res)
    res.json(out)
  } finally {
    slot.release()
  }
}))
