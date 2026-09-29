import { serializePtcgl, type SerializableLine } from './ptcgl.js'
import { ptcglCodeForSet } from './export.js'
import { normalizeName } from './names.js'
import { validateDeck, type ValidateContext } from './formats.js'
import type { CardFacts, DeckEntry, FormatCode } from './types.js'

export interface DeckCheckLine {
  card_id: string | null
  name: string
  supertype: 'Pokémon' | 'Trainer' | 'Energy' | 'Unknown'
  quantity: number
  owned: number
  unit_price_usd: number | null
  resolved: boolean
  note?: string
}

export interface DeckCheckResult {
  format: string
  total: number
  legal: boolean | null
  issues: string[]
  evolution_gaps: string[]
  lines: DeckCheckLine[]
  owned: number
  missing_cost_usd: number | null
  ptcgl: string
}

export interface ResolvedCheckLine {
  card: CardFacts | null
  requestedName: string
  quantity: number
  owned: number
  unitPriceUsd: number | null
  note?: string
}

const sectionOf = (card: CardFacts): DeckEntry['section'] =>
  card.category === 'Pokemon' ? 'pokemon' : card.category === 'Trainer' ? 'trainer' : 'energy'

const supertypeOf = (card: CardFacts | null): DeckCheckLine['supertype'] =>
  !card ? 'Unknown' : card.category === 'Pokemon' ? 'Pokémon' : card.category

/**
 * Shape already-resolved catalogue rows into the public check result. Database
 * selection and ownership allocation stay in the route adapter; all deck-rule,
 * evolution and arithmetic decisions live here and are fixture-testable.
 */
export function buildDeckCheckResult(
  format: FormatCode,
  rows: ResolvedCheckLine[],
  validationContext: ValidateContext = {},
): DeckCheckResult {
  // The route builds this from every resolved card so Classic reprints receive
  // the same legality verdict as saved decks and exports.
  const { isInFormatByReprint } = validationContext
  const rareCandy = rows.some((row) => row.card && normalizeName(row.card.name) === normalizeName('Rare Candy'))
  const presentNames = new Set(rows.filter((row) => row.card).map((row) => row.card!.normalizedName))
  const evolutionGaps: string[] = []

  const lines: DeckCheckLine[] = rows.map((row) => {
    let note = row.note
    const card = row.card
    if (card?.category === 'Pokemon' && (card.stage === 'Stage1' || card.stage === 'Stage2') && card.evolveFrom) {
      const prior = normalizeName(card.evolveFrom)
      if (!presentNames.has(prior)) {
        if (card.stage === 'Stage2' && rareCandy) {
          note = [note, `Rare Candy covers the missing ${card.evolveFrom} stage.`].filter(Boolean).join(' ')
        } else {
          evolutionGaps.push(
            `${card.name} (${card.stage === 'Stage2' ? 'Stage 2' : 'Stage 1'}) has no ${card.evolveFrom}` +
              (card.stage === 'Stage2' ? ' and no Rare Candy' : ''),
          )
        }
      }
    }
    return {
      card_id: card?.tcgdexId ?? null,
      name: card?.name ?? row.requestedName,
      supertype: supertypeOf(card),
      quantity: row.quantity,
      owned: Math.max(0, row.owned),
      unit_price_usd: row.unitPriceUsd,
      resolved: card !== null,
      ...(note ? { note } : {}),
    }
  })

  const entries: DeckEntry[] = rows.flatMap((row) => row.card ? [{
    card: row.card,
    quantity: row.quantity,
    section: sectionOf(row.card),
  }] : [])
  const total = rows.reduce((sum, row) => sum + row.quantity, 0)
  const unresolvedIssues = lines
    .filter((line) => !line.resolved)
    .map((line) => `Could not resolve "${line.name}" to a catalogue card.`)
  const validation = validateDeck({ formatCode: format, entries }, { isInFormatByReprint })
  const sizeIssues = total === 60 ? [] : [`${total} / 60 cards. ${total < 60 ? `Add ${60 - total}.` : `Remove ${total - 60}.`}`]
  const issues = [
    ...sizeIssues,
    ...validation.violations.filter((violation) => violation.code !== 'DECK_SIZE').map((violation) => violation.message),
    ...unresolvedIssues,
  ]
  const owned = lines.reduce((sum, line) => sum + Math.min(line.owned, line.quantity), 0)
  let missingCost = 0
  let missingPrice = false
  for (const line of lines) {
    const missing = Math.max(0, line.quantity - line.owned)
    if (!missing) continue
    if (line.unit_price_usd === null) missingPrice = true
    else missingCost += missing * line.unit_price_usd
  }
  const serializable: SerializableLine[] = rows.flatMap((row) => row.card ? [{
    quantity: row.quantity,
    name: row.card.name,
    setCode: ptcglCodeForSet(row.card.setTcgdexId)?.code ?? null,
    number: row.card.localId,
    print: null,
    section: sectionOf(row.card),
  }] : [])

  return {
    format,
    total,
    legal: unresolvedIssues.length ? null : issues.length === 0,
    issues,
    evolution_gaps: evolutionGaps,
    lines,
    owned,
    missing_cost_usd: missingPrice ? null : Math.round(missingCost * 100) / 100,
    ptcgl: serializable.length ? serializePtcgl(serializable) : '',
  }
}
