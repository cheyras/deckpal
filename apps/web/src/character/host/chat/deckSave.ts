import type { DeckFormat } from '../../../lib/api'

export type WidgetDeck = {
  name: string
  format: string
  total: number
  ptcgl?: string
  sections: Array<{ cards: Array<{ id: string; quantity: number }> }>
}

export type DeckSaveApi = {
  importDeck: (body: { text: string; name?: string; formatCode?: DeckFormat }) => Promise<{ deck: { id: string } }>
}

export type DeckSaveResult =
  | { ok: true; id: string; name: string; total: number }
  | { ok: false; message: string }

/**
 * Import is one server transaction. Creating a shell and adding cards one by
 * one can strand a partial deck, and retrying that failure creates duplicates.
 */
export async function saveDeckFromWidget(block: WidgetDeck, api: DeckSaveApi): Promise<DeckSaveResult> {
  try {
    if (!block.ptcgl?.trim()) throw new Error('Deck list is missing')
    const created = await api.importDeck({
      text: block.ptcgl,
      name: block.name,
      formatCode: asDeckFormat(block.format),
    })
    return { ok: true, id: created.deck.id, name: block.name, total: block.total }
  } catch {
    return { ok: false, message: "Couldn't save this deck. Please try again." }
  }
}

function asDeckFormat(format: string): DeckFormat | undefined {
  return ['standard', 'expanded', 'glc', 'unlimited'].includes(format) ? format as DeckFormat : undefined
}
