import type { DeckFormat } from '../../../lib/api'

/**
 * The reader's own deck a shown list revises.
 *
 * Put on the block by the SERVER (`showDeck`), only after it resolved the id
 * against the reader's own decks — the model cannot author it, and
 * `showScreen` cannot carry it. The save route checks ownership again, so
 * nothing here is trusted either way.
 */
export type WidgetBase = { id: string; name: string }

export type WidgetDeck = {
  name: string
  format: string
  total: number
  ptcgl?: string
  sections: Array<{ cards: Array<{ id: string; quantity: number }> }>
  base?: WidgetBase
  /** Deck-E's suggested note for the version, which the reader can edit. */
  versionNote?: string
}

export type DeckSaveApi = {
  importDeck: (body: { text: string; name?: string; formatCode?: DeckFormat }) => Promise<{
    deck: { id: string }
    import?: { unresolved?: string[]; unresolvedLines?: string[] }
  }>
}

export type DeckVersionApi = {
  saveDeck: (body: {
    deckId: string
    cards: Array<{ cardId: string; quantity: number }>
    versionNote?: string
    newVersion: true
  }) => Promise<{ deck: { id: string; name: string; version: number }; bumped?: boolean }>
}

/** `version` is present only for a save onto an existing deck. */
export type DeckSaved = {
  id: string
  name: string
  total: number
  version?: { number: number; changed: boolean }
}

export type DeckSaveResult =
  | ({ ok: true } & DeckSaved)
  | { ok: false; message: string }

/** Caps the note where the API does (`VERSION_NOTE_MAX`), so a long one is never a 400. */
export const VERSION_NOTE_MAX = 500

/**
 * Which saves the widget offers.
 *
 * A brand-new deck keeps the one button it always had. A revision of a deck
 * the reader owns offers the version first, because that is what "make a v2
 * of my deck" means — the battle logs and version history live on that deck —
 * and a separate copy second, for the reader who wants both side by side.
 */
export type DeckSaveChoice =
  | { kind: 'new' }
  | { kind: 'version'; base: WidgetBase; note: string }

export function deckSaveChoice(block: { readonly [field: string]: unknown }): DeckSaveChoice {
  const base = block.base as Partial<WidgetBase> | null | undefined
  const id = typeof base?.id === 'string' ? base.id.trim() : ''
  const name = typeof base?.name === 'string' ? base.name.trim() : ''
  if (!id || !name) return { kind: 'new' }
  const note = typeof block.versionNote === 'string' ? block.versionNote.trim().slice(0, VERSION_NOTE_MAX) : ''
  return { kind: 'version', base: { id, name }, note }
}

/** The shown list as `/decks/save` wants it: one line per card, copies summed. */
export function widgetCards(block: Pick<WidgetDeck, 'sections'>): Array<{ cardId: string; quantity: number }> {
  const byId = new Map<string, number>()
  for (const section of block.sections ?? []) {
    for (const card of section.cards) {
      const id = card.id.trim()
      if (id && card.quantity > 0) byId.set(id, (byId.get(id) ?? 0) + card.quantity)
    }
  }
  return [...byId].map(([cardId, quantity]) => ({ cardId, quantity }))
}

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
    const unresolved = created.import?.unresolvedLines?.length
      ? created.import.unresolvedLines
      : created.import?.unresolved
    if (unresolved?.length) {
      return { ok: false, message: `Couldn't save this deck. Unresolved lines: ${unresolved.join('; ')}` }
    }
    return { ok: true, id: created.deck.id, name: block.name, total: block.total }
  } catch (error) {
    const reason = error instanceof Error && /unresolved/i.test(error.message) ? ` ${error.message}` : ''
    return { ok: false, message: `Couldn't save this deck.${reason || ' Please try again.'}` }
  }
}

/**
 * The list as the next version of the deck it revises.
 *
 * Through `POST /decks/save`, the write `save_deck` already uses: every card is
 * resolved before anything is written, it is one transaction, and an edit
 * changes only the cards that changed — so the printings and pins the reader
 * chose survive. `newVersion` makes a changed list a NEW version even when the
 * current one was never played; amending would erase the only copy of the
 * list it replaces. The deck's format and name are left as they are.
 */
export async function saveDeckVersionFromWidget(
  block: WidgetDeck,
  note: string,
  api: DeckVersionApi,
): Promise<DeckSaveResult> {
  const choice = deckSaveChoice(block)
  if (choice.kind !== 'version') return { ok: false, message: "Couldn't save this version. Please try again." }
  const cards = widgetCards(block)
  if (!cards.length) return { ok: false, message: "Couldn't save this version — the list is empty." }
  const versionNote = note.trim().slice(0, VERSION_NOTE_MAX)
  try {
    const saved = await api.saveDeck({
      deckId: choice.base.id,
      cards,
      ...(versionNote ? { versionNote } : {}),
      newVersion: true,
    })
    return {
      ok: true,
      id: saved.deck.id,
      name: saved.deck.name,
      total: block.total,
      version: { number: saved.deck.version, changed: saved.bumped === true },
    }
  } catch (error) {
    return { ok: false, message: versionSaveError(error, choice.base.name) }
  }
}

/**
 * What a refused version save tells the reader.
 *
 * The API's 400s are sentences written for a person ("… is in this deck as 2
 * printings …", "Unresolved card ids: …"), so they are shown as they are. A
 * 404 means the deck is gone or was never theirs; anything else is a retry.
 */
export function versionSaveError(error: unknown, deckName: string): string {
  const status = (error as { status?: unknown } | null)?.status
  const message = error instanceof Error ? error.message.trim() : ''
  if (status === 404) return `Couldn't save this version — “${deckName}” isn't in your decks any more.`
  if (status === 400 && message) return `Couldn't save this version. ${message}`
  return "Couldn't save this version. Please try again."
}

/** The line the widget and the chat both say once a save lands. */
export function savedLine(saved: DeckSaved): string {
  if (!saved.version) return `Saved “${saved.name}” to your decks · ${saved.total} cards`
  return saved.version.changed
    ? `Saved v${saved.version.number} of “${saved.name}” · ${saved.total} cards`
    : `“${saved.name}” already matches this list · v${saved.version.number}`
}

function asDeckFormat(format: string): DeckFormat | undefined {
  return ['standard', 'expanded', 'glc', 'unlimited'].includes(format) ? format as DeckFormat : undefined
}
