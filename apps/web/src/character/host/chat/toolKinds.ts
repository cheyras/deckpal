import type { IconName } from '../../../components/Icon'

export type ToolKind = 'research' | 'catalog' | 'collection' | 'decks' | 'check' | 'lists' | 'logs' | 'prices' | 'write' | 'show' | 'move' | 'other'
type Chip = { name: string; phase: string; label?: string; args?: unknown; title?: string }

const KIND: Record<string, ToolKind> = {
  web_research: 'research', research_meta: 'research',
  search_cards: 'catalog', get_card: 'catalog', set_progress: 'catalog', health: 'catalog',
  collection_summary: 'collection', collection_value: 'collection', collection_log: 'collection', analyze_collection: 'collection',
  decks: 'decks', deck_history: 'decks',
  check_deck: 'check', plan_deck: 'check',
  lists: 'lists', mutation_history: 'logs', battle_logs: 'logs', card_price_history: 'prices',
  log_cards: 'write', save_deck: 'write', delete_deck: 'write', edit_list: 'write', delete_list: 'write', add_battle_log: 'write', edit_battle_log: 'write', delete_battle_log: 'write', revert: 'write', deck_strategy: 'write', write_strategy_guide: 'write', set_cart: 'write',
  showScreen: 'show', showDeck: 'show',
  flyTo: 'move', goTo: 'move', click: 'move', highlight: 'move', journey: 'move', escort: 'move', scrollToMe: 'move',
}

export function kindOf(name: string): ToolKind { return KIND[name] ?? 'other' }
export function iconFor(kind: ToolKind): IconName {
  return ({ research: 'globe', catalog: 'search', collection: 'cards', decks: 'deck', check: 'clipboard-check', lists: 'lists', logs: 'scroll', prices: 'tag', write: 'pencil', show: 'panel', move: 'arrow-right', other: 'sparkle' } as const)[kind]
}
export function motionFor(kind: ToolKind): 'da-rock' | 'da-pulse' | 'da-sweep' | 'da-bob' | 'da-spin-slow' {
  return ({ research: 'da-sweep', catalog: 'da-pulse', collection: 'da-rock', decks: 'da-bob', check: 'da-pulse', lists: 'da-bob', logs: 'da-sweep', prices: 'da-rock', write: 'da-rock', show: 'da-pulse', move: 'da-sweep', other: 'da-pulse' } as const)[kind]
}
const running = (phase: string) => phase === 'start' || phase === 'progress'
const arg = (args: unknown, key: string) => typeof args === 'object' && args !== null && typeof (args as Record<string, unknown>)[key] === 'string' ? (args as Record<string, string>)[key] : ''
const cut = (text: string) => text.length > 60 ? `${text.slice(0, 59)}…` : text
export function labelFor(chip: Chip): string {
  if (chip.label?.trim()) return chip.label.trim()
  const done = !running(chip.phase)
  const name = arg(chip.args, 'name') || arg(chip.args, 'deck_id')
  const pair = (present: string, past: string) => cut(done ? past : present)
  switch (chip.name) {
    case 'search_cards': case 'get_card': return pair(`Looking up ${name || 'cards'}`, `Looked up ${name || 'cards'}`)
    case 'collection_summary': case 'collection_value': case 'collection_log': return pair('Reading your collection', 'Read your collection')
    case 'decks': return pair(`Opening ${name ? `your deck ${name}` : 'your decks'}`, `Opened ${name ? `your deck ${name}` : 'your decks'}`)
    case 'check_deck': case 'plan_deck': return pair('Checking the list', 'Checked the list')
    case 'web_research': case 'research_meta': return pair('Searching the web', 'Searched the web')
    case 'showDeck': return pair('Laying out the deck', 'Laid out the deck')
    case 'showScreen': return pair('Showing the results', 'Showed the results')
    case 'lists': return pair('Reading your lists', 'Read your lists')
    case 'battle_logs': case 'mutation_history': return pair('Reading your history', 'Read your history')
    case 'card_price_history': return pair('Checking prices', 'Checked prices')
    default: return pair('Working on it', 'Finished the step')
  }
}
