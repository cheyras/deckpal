import type { DeckFormat } from '../../../lib/api'

export type WidgetDeck = {
  name: string
  format: string
  total: number
  sections: Array<{ cards: Array<{ id: string; quantity: number }> }>
}

export type DeckSaveApi = {
  createDeck: (body: { name: string; formatCode?: DeckFormat }) => Promise<{ deck: { id: string } }>
  addDeckCard: (deckId: string, cardId: string, quantity?: number) => Promise<unknown>
}

export type DeckSaveResult =
  | { ok: true; id: string; name: string; total: number }
  | { ok: false; message: string }

/**
 * The deck builder has no bulk-create endpoint: it creates a deck, then adds
 * its resolved card ids. The widget deliberately follows that public client
 * contract instead of reparsing its PTCGL text in a second code path.
 */
export async function saveDeckFromWidget(block: WidgetDeck, api: DeckSaveApi): Promise<DeckSaveResult> {
  try {
    const created = await api.createDeck({ name: block.name, formatCode: asDeckFormat(block.format) })
    for (const card of block.sections.flatMap((section) => section.cards)) {
      await api.addDeckCard(created.deck.id, card.id, card.quantity)
    }
    return { ok: true, id: created.deck.id, name: block.name, total: block.total }
  } catch {
    return { ok: false, message: "Couldn't save this deck. Please try again." }
  }
}

function asDeckFormat(format: string): DeckFormat | undefined {
  return ['standard', 'expanded', 'glc', 'unlimited'].includes(format) ? format as DeckFormat : undefined
}
