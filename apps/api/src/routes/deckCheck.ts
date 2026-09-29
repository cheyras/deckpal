import { Router } from 'express'
import { cardIsBasicEnergy, cardLegality, formatConfig, loadByName, loadByTcgdexId, resolveLine, buildReprintOracle, type CardFacts, type FormatCode, type ParsedLine } from '../deck/index.js'
import { buildDeckCheckResult, type ResolvedCheckLine } from '../deck/check.js'
import { basicEnergyType, loadOwnedPrints } from '../deck/ownedPrints.js'
import { parsePtcgl } from '../deck/ptcgl.js'
import { dbHandle, toMajor } from '../db.js'
import { asyncHandler, badRequest, oneOf, userCache } from '../http.js'
import { currentUserId } from '../identity.js'

export const deckCheckRouter: Router = Router()
const FORMATS = ['standard', 'expanded', 'glc', 'unlimited'] as const

interface InputLine { name?: string; card_id?: string; quantity: number; parsed?: ParsedLine }
interface PrintRow {
  card_id: string
  variant_id: string
  variant_kind_code: string
  identical_print_group: string | null
  is_promo: boolean
  is_stamped: boolean
  market_minor: number | null
}

function inputLines(body: Record<string, unknown>): InputLine[] {
  const hasCards = body.cards !== undefined
  const hasText = body.ptcgl_text !== undefined
  if (hasCards === hasText) throw badRequest('Provide exactly one of cards or ptcgl_text')
  if (hasText) {
    if (typeof body.ptcgl_text !== 'string' || !body.ptcgl_text.trim()) throw badRequest('ptcgl_text must be non-empty')
    if (body.ptcgl_text.length > 20_000) throw badRequest('ptcgl_text too large')
    return parsePtcgl(body.ptcgl_text).lines.map((line) => ({ name: line.name, quantity: line.quantity, parsed: line }))
  }
  if (!Array.isArray(body.cards) || body.cards.length < 1 || body.cards.length > 60) {
    throw badRequest('cards must contain 1..60 distinct lines')
  }
  return body.cards.map((raw, index) => {
    if (!raw || typeof raw !== 'object') throw badRequest(`cards[${index}] must be an object`)
    const line = raw as Record<string, unknown>
    const name = typeof line.name === 'string' ? line.name.trim() : ''
    const cardId = typeof line.card_id === 'string' ? line.card_id.trim() : ''
    if ((!name && !cardId) || (name && cardId)) throw badRequest(`cards[${index}] needs exactly one of name or card_id`)
    const quantity = Number(line.quantity)
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 60) throw badRequest(`cards[${index}].quantity must be an integer 1..60`)
    return { ...(name ? { name } : { card_id: cardId }), quantity }
  })
}

async function chooseName(name: string, format: FormatCode, userId: string): Promise<{ card: CardFacts; note: string } | null> {
  const candidates = await loadByName(dbHandle(), name)
  if (!candidates.length) return null
  const ids = candidates.map((card) => card.id)
  const ownedRows = await dbHandle().query<{ card_id: string; owned: string }>(
    `SELECT cv.card_id, sum(ci.quantity)::text AS owned
       FROM collection_item ci JOIN card_variant cv ON cv.id=ci.card_variant_id
      WHERE ci.user_id=$1 AND cv.card_id=ANY($2::bigint[]) GROUP BY cv.card_id`,
    [userId, ids],
  )
  const owned = new Map(ownedRows.rows.map((row) => [Number(row.card_id), Number(row.owned)]))
  const cfg = formatConfig(format)
  const oracle = cfg.pool_strategy === 'all' ? () => false : await buildReprintOracle(dbHandle(), candidates, cfg.legal_marks)
  const legal = (card: CardFacts) => cardLegality(card, { isInFormatByReprint: oracle })
    .formats.find((entry) => entry.format === format)?.legal === true
  const released = (card: CardFacts) => card.releasedOn ? Date.parse(card.releasedOn) || 0 : 0
  const card = candidates.slice().sort((a, b) =>
    Number((owned.get(b.id) ?? 0) > 0) - Number((owned.get(a.id) ?? 0) > 0) ||
    Number(legal(b)) - Number(legal(a)) || released(b) - released(a) || a.tcgdexId.localeCompare(b.tcgdexId),
  )[0]!
  return { card, note: `resolved '${name}' to ${card.tcgdexId}${(owned.get(card.id) ?? 0) > 0 ? ' (you own this printing)' : ''}` }
}

deckCheckRouter.post('/', asyncHandler(async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>
  const format = oneOf<FormatCode>(body.format, FORMATS, 'standard')
  const userId = currentUserId(req)
  const requested = inputLines(body)
  const resolved = await Promise.all(requested.map(async (line) => {
    if (line.card_id) return { line, card: await loadByTcgdexId(dbHandle(), line.card_id), note: undefined }
    if (line.parsed?.setCode) {
      const entry = await resolveLine(dbHandle(), line.parsed, format)
      return { line, card: entry?.card ?? null, note: entry ? `resolved '${line.name}' to ${entry.card.tcgdexId}` : undefined }
    }
    const found = await chooseName(line.name!, format, userId)
    return { line, card: found?.card ?? null, note: found?.note }
  }))
  // Import already folds repeated prints into one deck row. Do the same before
  // ownership allocation so one physical copy cannot be counted twice merely
  // because the pasted list repeated a line.
  const grouped = new Map<string, (typeof resolved)[number]>()
  for (const item of resolved) {
    const key = item.card ? `card:${item.card.id}` : `unresolved:${item.line.name ?? item.line.card_id}`
    const prior = grouped.get(key)
    if (prior) prior.line.quantity += item.line.quantity
    else grouped.set(key, { ...item, line: { ...item.line } })
  }
  const selected = [...grouped.values()]
  const cards = selected.flatMap((row) => row.card ? [row.card] : [])
  const printRows = cards.length ? await dbHandle().query<PrintRow>(
    `SELECT DISTINCT ON (c.id) c.id AS card_id, cv.id AS variant_id, cv.variant_kind_code,
            c.identical_print_group, s.is_promo,
            EXISTS (SELECT 1 FROM variant_kind_stamp vks WHERE vks.variant_kind_code=cv.variant_kind_code) AS is_stamped,
            price.market_minor
       FROM card c JOIN card_set s ON s.id=c.set_id JOIN card_variant cv ON cv.card_id=c.id
       LEFT JOIN LATERAL (SELECT pc.market_minor FROM price_current pc
         WHERE pc.card_variant_id=cv.id AND pc.source_code='tcgcsv' AND pc.currency_code='USD'
           AND pc.market_minor IS NOT NULL LIMIT 1) price ON true
      WHERE c.id=ANY($1::bigint[]) ORDER BY c.id, cv.is_primary DESC, cv.sort_order`,
    [cards.map((card) => card.id)],
  ) : { rows: [] as PrintRow[] }
  const printByCard = new Map(printRows.rows.map((row) => [Number(row.card_id), row]))
  const slots = selected.flatMap(({ line, card }) => {
    const print = card ? printByCard.get(card.id) : undefined
    return card && print ? [{
      cardId: card.id, variantId: Number(print.variant_id), variantKind: print.variant_kind_code,
      quantity: line.quantity, group: print.identical_print_group,
      basicEnergyType: cardIsBasicEnergy(card) ? basicEnergyType(card.name, card.types[0] ?? null) : null,
      isPromo: print.is_promo, isStamped: print.is_stamped, pinExact: false,
    }] : []
  })
  // This is the deck-detail allocator: exact copies first, then legal equivalent
  // printings. Thus `owned` may include an interchangeable printing, just as the
  // saved-deck page does; one physical copy is allocated to only one line.
  const allocations = await loadOwnedPrints(dbHandle(), userId, format, slots)
  const rows: ResolvedCheckLine[] = selected.map(({ line, card, note }) => {
    const print = card ? printByCard.get(card.id) : undefined
    return {
      card,
      requestedName: line.name ?? line.card_id ?? 'Unknown card',
      quantity: line.quantity,
      owned: print ? allocations.get(Number(print.variant_id))?.owned ?? 0 : 0,
      unitPriceUsd: print?.market_minor != null ? toMajor(print.market_minor, 'USD') : null,
      ...(note ? { note } : {}),
    }
  })
  const cfg = formatConfig(format)
  const oracle = cfg.pool_strategy === 'all' || cards.length === 0
    ? undefined : await buildReprintOracle(dbHandle(), cards, cfg.legal_marks)
  userCache(res)
  res.json(buildDeckCheckResult(format, rows, oracle ? { isInFormatByReprint: oracle } : {}))
}))
