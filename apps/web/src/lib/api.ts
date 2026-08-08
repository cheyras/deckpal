// API client — consumes deckscout-api (read-only contract, API.md).
// All routes under /deckscout/api. In dev, Vite proxies to :3700.

const BASE = '/deckscout/api'

// ── the SSO gate session-expiry handling ───────────────────────────
// On the public vhost every /deckscout/* location is the SSO gate-gated; when the
// session expires nginx answers the API fetch with a 302 to the login portal
// (the SSO gate-protect.conf: `error_page 401 =302 https://$host/the SSO gate/?rd=…`).
// fetch follows it and lands on the portal's HTML login page with status 200,
// so without this guard res.json() throws and every route dead-ends on
// "Something went wrong".
//
// ⚠️ Recovery MUST navigate to the portal, never reload the current URL: the
// service worker serves any /deckscout/* navigation from the precached shell
// (sw.ts NavigationRoute), so a same-URL reload never reaches nginx and the
// login flow never runs — the PWA dead-ends on the error screen forever (the
// 2026-07-30 recurrence of issue ylftyb). /the SSO gate/ is OUTSIDE the SW's
// /deckscout/ scope, so navigating there always hits the network; the SSO gate's
// rd= param brings the user straight back to the page they were on.
// On the LAN vhost there is no the SSO gate, so none of these signals ever fire.
function isAuthBounce(res: Response): boolean {
  if (res.redirected || res.type === 'opaqueredirect') {
    try {
      if (new URL(res.url).pathname.startsWith('/the SSO gate/')) return true
    } catch {
      /* ignore */
    }
    // Redirected off the API onto an HTML page — an auth portal by any name.
    const ct = res.headers.get('content-type') ?? ''
    if (ct.includes('text/html')) return true
  }
  // An OK-but-HTML body on an API path can only be a login page (the API is
  // JSON-only, its 404s are JSON, and the SW denylists /deckscout/api/ from the
  // shell fallback) — catch it even if the redirected flag was lost in transit.
  if (res.ok && (res.headers.get('content-type') ?? '').includes('text/html')) return true
  // A bare 401 also only ever comes from the auth layer (the API never 401s).
  return res.status === 401
}

const AUTH_PORTAL_KEY = 'deckscout:auth-portal-at'
let authRedirectInFlight = false

// Send the user through the the SSO gate portal and back. Guarded so a burst of
// failing fetches triggers one navigation, and a bounce that recurs within 15s
// of returning from the portal (login abandoned / still broken) falls through
// to the normal error UI instead of ping-ponging portal ↔ app.
function redirectToAuth(res?: Response): Error {
  const now = Date.now()
  const last = Number(sessionStorage.getItem(AUTH_PORTAL_KEY) ?? 0)
  if (!authRedirectInFlight && now - last > 15_000) {
    authRedirectInFlight = true
    sessionStorage.setItem(AUTH_PORTAL_KEY, String(now))
    // Prefer the portal origin we were actually bounced to; fall back to the
    // conventional same-host portal path.
    let portal: URL
    try {
      const bounced = res?.redirected ? new URL(res.url) : null
      portal =
        bounced && bounced.pathname.startsWith('/the SSO gate/')
          ? new URL(bounced.origin + '/the SSO gate/')
          : new URL('/the SSO gate/', window.location.origin)
    } catch {
      portal = new URL('/the SSO gate/', window.location.origin)
    }
    portal.searchParams.set('rd', window.location.href)
    window.location.assign(portal.toString())
  }
  return new Error('Session expired — signing you back in…')
}

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { signal })
  if (isAuthBounce(res)) throw redirectToAuth(res)
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try {
      const body = await res.json()
      if (body?.error?.message) msg = body.error.message
    } catch {
      /* ignore */
    }
    throw new Error(msg)
  }
  return res.json() as Promise<T>
}

async function send<T>(method: 'PATCH' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  if (isAuthBounce(res)) throw redirectToAuth(res)
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try {
      const b = await res.json()
      if (b?.error?.message) msg = b.error.message
    } catch {
      /* ignore */
    }
    throw new Error(msg)
  }
  return res.json() as Promise<T>
}

// ── Money ──────────────────────────────────────────────────────
// Prices are objects: null means "no price" → render "—", never $0.
export interface Price {
  market: number | null
  currency: string
}

export interface VariantPrice {
  source: string
  sourceLabel?: string
  marketplace?: string
  currency: string
  market: number | null
  low: number | null
  mid: number | null
  high: number | null
  pricedAt: string | null
  isFallback: boolean
}

// ── Scanner (Phase 8 — perceptual-hash image → card matcher) ───
// POST /scan takes the RAW image bytes with an image/* Content-Type (never
// multipart, never JSON), so it bypasses the shared json() helpers above.
export interface ScanMatch {
  cardId: string
  name: string
  number: string
  setId: string
  setName: string
  rarity: string | null
  images: { low: string; high: string }
  distance: number
  confidence: number
}
export interface ScanResponse {
  query: { algo: string; hash: string }
  matched: boolean
  threshold: number
  indexSize: number
  matches: ScanMatch[]
  note?: string
}

// Response of POST /collection/cards/:cardId/have (tile-level Have/Need toggle).
export interface HaveMutationResponse {
  cardId: string
  setId: string
  card: {
    cardId: string
    variants: { variantId: number; quantity: number }[]
    ownership: { totalQuantity: number; have: boolean; need: boolean; dupe: boolean }
  }
  progress: Progress
}

// ── Series ─────────────────────────────────────────────────────
export interface SeriesSummary {
  slug: string
  tcgdexId: string
  name: string
  firstReleaseOn: string | null
  sortOrder: number
  setCount: number
  cardCount: number
  repSetId: string | null
  repHasSymbol: boolean
  // Per-series completion rollup: owned cards / total cards across the series.
  progress: { owned: number; total: number; pct: number }
}
export interface SeriesIndexResponse {
  series: SeriesSummary[]
}

export interface GoalProgress {
  owned: number
  total: number
  pct: number
  totalQuantity?: number
  setLevel?: number
}
export interface Progress {
  complete: GoalProgress
  master: GoalProgress
  grandmaster: GoalProgress
}

export interface SetSummary {
  setId: string
  slug: string
  name: string
  releasedOn: string | null
  isPromo: boolean
  printedCount: number
  secretCount: number
  cardCountTotal: number
  logoUrl: string | null
  symbolUrl: string | null
  progress: Progress
}
export interface SeriesDetailResponse {
  series: { slug: string; tcgdexId: string; name: string; firstReleaseOn: string | null }
  sets: SetSummary[]
}

// ── Set detail ─────────────────────────────────────────────────
export interface CardOwnership {
  totalQuantity: number
  requiredCount: number
  ownedRequired: number
  have: boolean
  need: boolean
  dupe: boolean
}
export interface CardRow {
  cardId: string
  number: string
  numberSort: string
  name: string
  category: string
  rarity: string | null
  artist: string | null
  variantCount: number
  images: { low: string; high: string }
  price: Price | null
  ownership: CardOwnership
  // Optional per-card routing (present on list items, which span many sets).
  seriesSlug?: string | null
  setId?: string | null
}
export interface SetDetailResponse {
  set: {
    setId: string
    slug: string
    name: string
    series: { slug: string; name: string; tcgdexId: string }
    releasedOn: string | null
    isPromo: boolean
    printedCount: number
    secretCount: number
    cardCountTotal: number
    images: { logoUrl: string | null; symbolUrl: string | null; backgroundUrl: string | null }
    marketValueUsd: number | null
    mostExpensiveCard: { cardId: string; name: string; number: string; marketUsd: number | null } | null
  }
  progress: Progress
  query: Record<string, unknown>
  pagination: { page: number; pageSize: number; total: number; pageCount: number }
  cards: CardRow[]
}

// ── Card detail ────────────────────────────────────────────────
export interface Variant {
  variantId: number
  kind: string
  displayName: string
  provenance: string | null
  tier: 'standard' | 'special'
  tierSource?: string
  isPrimary: boolean
  isSynthesized?: boolean
  source: string
  quantity: number
  buyUrl: string | null
  prices: VariantPrice[]
}
export interface CardDetailResponse {
  card: {
    cardId: string
    number: string
    printedTotal: number | null
    name: string
    category: string
    rarity: string | null
    artist: string | null
    hp: number | null
    stage: string | null
    evolvesFrom: string | null
    retreat: number | null
    regulationMark: string | null
    releasedOn: string | null
    set: { setId: string; name: string; slug: string; logoUrl: string | null; symbolUrl: string | null }
    series: { slug: string; name: string; tcgdexId: string }
    images: { low: string; high: string }
    types: string[]
    subtypes: string[]
    tags: string[]
    attacks: { name: string; cost: string | null; damage: string | null; effect: string | null }[]
    abilities: { name: string; effect: string | null }[]
    weaknesses: { type: string; value: string }[]
    resistances: { type: string; value: string }[]
    species: { speciesId: number; slug: string; name: string; generation: number }[]
  }
  variants: Variant[]
}

// ── Collection mutations (write API) ───────────────────────────
// The set of quantities changes; the server recomputes the affected set's three
// progress goals in the same transaction and returns them authoritatively.
export interface CollectionMutationResponse {
  variantId: number
  quantity: number
  delta: number
  isFirstAcquisition: boolean
  card: {
    cardId: string
    variants: { variantId: number; quantity: number }[]
    ownership: { totalQuantity: number; have: boolean; need: boolean; dupe: boolean }
  }
  setId: string
  progress: Progress
}

// ── Lists ──────────────────────────────────────────────────────
export type ListKind = 'dynamic' | 'static' | 'pokedex_binder'
export type ListVisibility = 'private' | 'public'

export interface ListProgress {
  owned: number
  total: number
  pct: number
  copies: number
}
export interface ListSummary {
  id: string
  kind: ListKind
  name: string
  description: string | null
  visibility: ListVisibility
  isFavorite: boolean
  coverRender: string
  pocketSize: number | null
  itemCount: number
  progress: ListProgress | null
  marketValueUsd: number | null
  coverImage: { low: string; high: string } | null
  createdAt: string
  updatedAt: string
}
// A resolved list row. Extends CardRow so GridView/BinderView/TableView render it
// directly; the extra fields carry list identity + read-through/static quantities.
export interface ListItem extends CardRow {
  itemId: string
  position: number
  itemKind: 'card' | 'species'
  variantId?: number | null
  variant?: { kind: string | null; displayName: string | null; tier: string | null; isPrimary: boolean | null }
  setName?: string | null
  note?: string | null
  staticQuantity?: number | null
  ownedQuantity?: number
  dexId?: number
  generation?: number | null
}
export interface ListDetailResponse {
  list: ListSummary
  items: ListItem[]
}
export interface CreateListBody {
  name: string
  kind: ListKind
  description?: string | null
  visibility?: ListVisibility
}
export interface UpdateListBody {
  name?: string
  description?: string | null
  visibility?: ListVisibility
  isFavorite?: boolean
  itemOrder?: string[]
  coverCardVariantId?: number | null
}

// ── Search (used by the Add-to-List picker) ────────────────────
export interface SearchCard {
  cardId: string
  number: string
  name: string
  category: string
  rarity: string | null
  artist: string | null
  regulationMark?: string | null
  set: { setId: string; name: string }
  series: { slug: string; name: string }
  variantCount: number
  images: { low: string; high: string }
  price: Price | null
}
export interface SearchResponse {
  pagination: { page: number; pageSize: number; total: number; pageCount: number }
  cards: SearchCard[]
}

// ── Decks (Phase 5) ────────────────────────────────────────────
export type DeckFormat = 'standard' | 'expanded' | 'glc' | 'unlimited'

export interface BattleRecord {
  wins: number
  losses: number
  ties: number
}
export interface DeckSummary {
  id: string
  name: string
  description: string | null
  formatCode: DeckFormat
  formatName: string
  glcType: string | null
  isFavorite: boolean
  coverRender: string
  coverImage: { low: string; high: string } | null
  version: number
  totalCount: number
  valueUsd: number | null
  legal: boolean
  createdAt: string
  updatedAt: string
  // Aggregate battle record over ALL versions — present on GET /decks rows only.
  record?: BattleRecord
}
export interface DeckCard {
  cardId: string
  name: string
  number: string
  numberSort: string | null
  category: string
  section: 'pokemon' | 'trainer' | 'energy'
  stage: string | null
  rarity: string | null
  artist: string | null
  regulationMark: string | null
  setId: string
  setName: string
  seriesSlug: string
  quantity: number
  owned: number
  have: boolean
  images: { low: string; high: string }
  price: Price | null
}
export interface DeckCounts {
  total: number
  pokemon: number
  trainer: number
  energy: number
  distinctNames: number
}
export interface Violation {
  code: string
  severity: 'error' | 'warning'
  rule: string
  message: string
  scope: string
  subject?: string
  card_ids?: number[]
  observed?: number
  allowed?: number
  delta?: number
  detail?: Record<string, unknown>
}
export interface ValidationWarning {
  code: string
  message: string
}
export interface ValidationResult {
  format: DeckFormat
  format_data_checked_at: string
  legal: boolean
  counts: { total: number; pokemon: number; trainer: number; energy: number; distinct_names: number; unresolved: number }
  violations: Violation[]
  warnings: ValidationWarning[]
}
export interface CardRef {
  cardId: string
  name: string
  number: string
  setId: string
  seriesSlug: string
  image: string
}
export interface DeckDetail {
  deck: DeckSummary & { strategyMd: string | null }
  counts: DeckCounts
  cards: DeckCard[]
  validation: ValidationResult
  cardRefs: Record<string, CardRef>
  glcTypes: string[]
  import?: {
    source: string
    resolvedEntries: number
    distinctCards: number
    unresolved: string[]
    warnings: ValidationWarning[]
  }
}
export interface HandCard {
  cardId: string | null
  name: string
  number: string | null
  category: string | null
  isBasicPokemon: boolean
  image: string | null
}
export interface TestHand {
  seed: number
  deckSize: number
  basicPokemonCount: number
  mulligans: number
  opponentDraws: number
  mulliganChancePct: number
  hand: HandCard[]
  prizes: HandCard[]
  note: string
}
export interface MissingCard {
  cardId: string
  name: string
  number: string
  setId: string
  missingQty: number
  unitPrice: number | null
  lineTotal: number | null
  buyUrl: string | null
  massEntry: string
  image: string
}
export interface DeckPricing {
  currency: string
  totalUsd: number | null
  ownedValueUsd: number | null
  missingValueUsd: number | null
  cards: { cardId: string; name: string; number: string; setId: string; quantity: number; owned: number; unitPrice: number | null; lineTotal: number | null; currency: string }[]
  missing: MissingCard[]
  massEntryText: string
}
// GET /decks/:id/massentry — TCGplayer cart deep links for the missing cards
// (same shape family as GET /sets/:setId/massentry).
export interface DeckMassEntry {
  deck: { id: string; name: string }
  needed: { cards: number; items: number; unlinkable: number }
  lines: string[]
  text: string
  urls: string[]
  unlinkable: { name: string; number: string; setId: string; variant: string | null }[]
  warnings: string[]
  note: string
}
export interface CreateDeckBody {
  name: string
  formatCode?: DeckFormat
  glcType?: string | null
  description?: string | null
}

// ── Deck intelligence: versions, strategy, battle logs ─────────
// Per-version battle-log aggregate (`total` includes result-less logs).
export interface VersionBattleRecord extends BattleRecord {
  total: number
}
export interface DeckVersionSummary {
  version: number
  note: string | null
  source: string
  createdAt: string
  cardCount: number
  formatCode: DeckFormat
  battleLogs: VersionBattleRecord
  isCurrent: boolean
}
export interface DeckVersionsResponse {
  current: number
  versions: DeckVersionSummary[]
}
export interface SnapshotCard {
  cardId: number
  tcgdexId: string
  name: string
  quantity: number
}
export interface DeckVersionDiff {
  added: { name: string; tcgdexId: string; quantity: number }[]
  removed: { name: string; tcgdexId: string; quantity: number }[]
  changed: { name: string; tcgdexId: string; from: number; to: number }[]
}
export interface DeckVersionDetail {
  version: number
  isCurrent: boolean
  formatCode: DeckFormat
  note: string | null
  source: string
  createdAt: string
  strategyMd: string | null
  cardCount: number
  cards: SnapshotCard[]
  battleLogs: VersionBattleRecord
  diff: DeckVersionDiff | null // null for v1 (nothing to diff against)
}
export interface RevertResult {
  toVersion: number
  version: number
  bumped: boolean
  skippedCards: { cardId: number; tcgdexId: string; name: string }[]
}
export type BattleResult = 'win' | 'loss' | 'tie'
export interface BattleLogSummary {
  id: number
  deckVersion: number
  result: BattleResult | null
  opponent: string | null
  opponentDeck: string | null
  turns: number | null
  prizes: { me: number; opponent: number } | null
  notes: string | null
  playedAt: string
  source: string
}
export interface ParsedBattleLog {
  players: { me: string | null; opponent: string | null }
  confidence: 'high' | 'low'
  result: BattleResult | null
  wentFirst: 'me' | 'opponent' | null
  totalTurns: number
  prizesTaken: { me: number; opponent: number }
  knockouts: { byMe: string[]; byOpponent: string[] }
  opponentPokemon: string[]
  myPokemon: string[]
  opponentDeckGuess: string | null
}
export interface BattleLog extends BattleLogSummary {
  rawLog: string
  parsed: ParsedBattleLog | null
  createdAt: string
}
export interface BattleLogsResponse {
  version: number | null
  logs: BattleLogSummary[]
  totals: VersionBattleRecord
  pagination: { page: number; pageSize: number; total: number; pageCount: number }
}
export interface AddBattleLogBody {
  rawLog: string
  result?: BattleResult
  opponent?: string
  opponentDeck?: string
  notes?: string
  playedAt?: string
  playerName?: string
}
export interface UpdateDeckBody {
  name?: string
  description?: string | null
  formatCode?: DeckFormat
  glcType?: string | null
  isFavorite?: boolean
  coverRender?: string
}

// ── Insights / gamification (Phase 6) ──────────────────────────
// All read-only, over /insights/*. Shapes mirror apps/api/src/insights/*.
export interface TrainerLevel {
  level: number
  uniqueCards: number
  intoLevel: number
  toNext: number
  nextLevelAt: number
  fraction: number
  uniqueMode: 'cards' | 'pairs'
  totalCards: number
  uniquePairs: number
}
export interface CurrencyTotal {
  currency: string
  totalMinor: number
  total: number
  pricedVariants: number
  quantity: number
}
export interface InsightsOverview {
  trainer: TrainerLevel
  collectionValue: CurrencyTotal[]
  pokedex: { captured: number; total: number; pct: number }
}
export interface CollectionEvent {
  eventId: string
  occurredAt: string
  kind: string
  cardId: string
  cardName: string
  setId: string
  setName: string
  number: string
  variantId: number
  variantName: string
  quantityDelta: number
  newQuantity: number
  images: { low: string | null; high: string | null }
}
export interface CollectionEventsResponse {
  events: CollectionEvent[]
}
export type ValueRange = '30d' | '3m' | '6m' | '1y'
export interface ValuePoint {
  date: string
  value: number
  valueMinor: number
}
export interface ValueDelta {
  valueMinor: number
  value: number
  pct: number | null
}
export interface ValueSeriesData {
  currency: string
  range: ValueRange
  points: ValuePoint[]
  delta: ValueDelta | null
}
export interface Mover {
  cardId: string
  variantKind: string
  name: string
  currency: string
  quantity: number
  market: number
  change: number
  changePct: number | null
}
export interface ValueResponse {
  currency: string
  range: ValueRange
  current: CurrencyTotal
  series: ValueSeriesData
  movers: Mover[]
}
export interface SpeciesSprite {
  pixel: string
  pixelShiny: string
  art: string
  artShiny: string
}
export interface SpeciesGridRow {
  speciesId: number
  slug: string
  name: string
  genus: string | null
  generation: number
  types: string[]
  cardPool: number
  uniqueOwned: number
  captured: boolean
  level: number
  levelLabel: string
  shiny: boolean
  shinyBreadth: number
  sprite: SpeciesSprite
}
export interface SpeciesGridResponse {
  completion: { captured: number; total: number }
  pagination: { page: number; pageSize: number; total: number; pageCount: number }
  species: SpeciesGridRow[]
}
export interface SpeciesDetailCard {
  cardId: string
  number: string
  name: string
  category: string
  rarity: string | null
  artist: string | null
  set: { setId: string; name: string }
  variantCount: number
  owned: boolean
  ownedQuantity: number
  images: { low: string; high: string }
  price: Price | null
}
export interface SpeciesDetailResponse {
  species: {
    speciesId: number
    slug: string
    name: string
    genus: string | null
    generation: number
    types: string[]
    cardPool: number
    uniqueOwned: number
    captured: boolean
    level: number
    levelLabel: string
    shiny: boolean
    shinyBreadth: number
    sprite: SpeciesSprite
  }
  cards: SpeciesDetailCard[]
}

// The raw item shape the API returns before we normalise `kind` → `itemKind`.
interface RawListItem extends Omit<ListItem, 'itemKind'> {
  kind: 'card' | 'species'
}
function normaliseItems(r: { list: ListSummary; items: RawListItem[] }): ListDetailResponse {
  return { list: r.list, items: r.items.map(({ kind, ...rest }) => ({ ...rest, itemKind: kind })) }
}

// ── Endpoints ──────────────────────────────────────────────────
export const api = {
  series: (signal?: AbortSignal) => get<SeriesIndexResponse>('/series', signal),
  seriesDetail: (slug: string, signal?: AbortSignal) =>
    get<SeriesDetailResponse>(`/series/${encodeURIComponent(slug)}`, signal),
  set: (setId: string, params: URLSearchParams, signal?: AbortSignal) =>
    get<SetDetailResponse>(`/sets/${encodeURIComponent(setId)}?${params.toString()}`, signal),
  card: (cardId: string, signal?: AbortSignal) =>
    get<CardDetailResponse>(`/cards/${encodeURIComponent(cardId)}`, signal),
  // Set an absolute owned quantity for a variant.
  setVariantQuantity: (variantId: number, quantity: number) =>
    send<CollectionMutationResponse>('PATCH', `/collection/variants/${variantId}`, { quantity }),
  // Adjust a variant's owned quantity by a signed delta (floors at 0).
  incrementVariant: (variantId: number, delta: number) =>
    send<CollectionMutationResponse>('POST', `/collection/variants/${variantId}/increment`, { delta }),
  // Tile-level Have/Need toggle by card id (owns/zeroes the primary variant).
  setCardHave: (cardId: string, have: boolean) =>
    send<HaveMutationResponse>('POST', `/collection/cards/${encodeURIComponent(cardId)}/have`, { have }),

  // Scanner — POST raw image bytes, get ranked perceptual-hash matches.
  scan: async (bytes: ArrayBuffer, contentType: string, k = 5, quality: 'low' | 'high' = 'low', signal?: AbortSignal): Promise<ScanResponse> => {
    const params = new URLSearchParams({ k: String(k), quality })
    const res = await fetch(`${BASE}/scan?${params.toString()}`, {
      method: 'POST',
      headers: { 'Content-Type': contentType || 'application/octet-stream' },
      body: bytes,
      signal,
    })
    if (isAuthBounce(res)) throw redirectToAuth(res)
    if (!res.ok) {
      let msg = `HTTP ${res.status}`
      try {
        const b = await res.json()
        if (b?.error?.message) msg = b.error.message
      } catch {
        /* ignore */
      }
      throw new Error(msg)
    }
    return res.json() as Promise<ScanResponse>
  },
  // PDF export URLs (streamed by the API; open in a new tab).
  deckPdfUrl: (id: string) => `${BASE}/decks/${encodeURIComponent(id)}/pdf`,
  listPdfUrl: (id: string) => `${BASE}/lists/${encodeURIComponent(id)}/pdf`,
  setChecklistPdfUrl: (setId: string) => `${BASE}/sets/${encodeURIComponent(setId)}/checklist.pdf`,

  // Lists
  lists: (signal?: AbortSignal) => get<{ lists: ListSummary[] }>('/lists', signal),
  list: async (id: string, signal?: AbortSignal) =>
    normaliseItems(await get<{ list: ListSummary; items: RawListItem[] }>(`/lists/${encodeURIComponent(id)}`, signal)),
  createList: (body: CreateListBody) => send<{ list: ListSummary }>('POST', '/lists', body),
  updateList: (id: string, body: UpdateListBody) => send<{ list: ListSummary }>('PATCH', `/lists/${encodeURIComponent(id)}`, body),
  deleteList: (id: string) => send<{ deleted: string }>('DELETE', `/lists/${encodeURIComponent(id)}`),
  addListItem: (id: string, body: { cardVariantId?: number; dexId?: number; staticQuantity?: number; note?: string }) =>
    send<{ itemId: string | null; alreadyPresent: boolean; list: ListSummary }>('POST', `/lists/${encodeURIComponent(id)}/items`, body),
  removeListItem: (id: string, itemId: string) =>
    send<{ deleted: string; list: ListSummary | null }>('DELETE', `/lists/${encodeURIComponent(id)}/items/${encodeURIComponent(itemId)}`),
  searchCards: (params: URLSearchParams, signal?: AbortSignal) =>
    get<SearchResponse>(`/search?${params.toString()}`, signal),

  // Decks
  decks: (signal?: AbortSignal) => get<{ decks: DeckSummary[] }>('/decks', signal),
  deck: (id: string, signal?: AbortSignal) => get<DeckDetail>(`/decks/${encodeURIComponent(id)}`, signal),
  createDeck: (body: CreateDeckBody) => send<DeckDetail>('POST', '/decks', body),
  updateDeck: (id: string, body: UpdateDeckBody) => send<DeckDetail>('PATCH', `/decks/${encodeURIComponent(id)}`, body),
  deleteDeck: (id: string) => send<{ deleted: string }>('DELETE', `/decks/${encodeURIComponent(id)}`),
  importDeck: (body: { text: string; formatCode?: DeckFormat; glcType?: string | null; name?: string; source?: 'ptcgl' | 'massentry' }) =>
    send<DeckDetail>('POST', '/decks/import', body),
  addDeckCard: (id: string, cardId: string, quantity = 1) =>
    send<DeckDetail>('POST', `/decks/${encodeURIComponent(id)}/cards`, { cardId, quantity }),
  setDeckCardQuantity: (id: string, cardId: string, quantity: number) =>
    send<DeckDetail>('PATCH', `/decks/${encodeURIComponent(id)}/cards/${encodeURIComponent(cardId)}`, { quantity }),
  removeDeckCard: (id: string, cardId: string) =>
    send<DeckDetail>('DELETE', `/decks/${encodeURIComponent(id)}/cards/${encodeURIComponent(cardId)}`),
  validateDeck: (id: string, format?: DeckFormat, signal?: AbortSignal) =>
    get<{ validation: ValidationResult; cardRefs: Record<string, CardRef> }>(
      `/decks/${encodeURIComponent(id)}/validate${format ? `?format=${format}` : ''}`,
      signal,
    ),
  exportDeck: (id: string, format: 'ptcgl' | 'massentry' = 'ptcgl', signal?: AbortSignal) =>
    get<{ format: string; text: string; warnings: { code: string; message: string; cardId: string }[] }>(
      `/decks/${encodeURIComponent(id)}/export?format=${format}`,
      signal,
    ),
  testHand: (id: string, seed?: number, signal?: AbortSignal) =>
    get<TestHand>(`/decks/${encodeURIComponent(id)}/testhand${seed !== undefined ? `?seed=${seed}` : ''}`, signal),
  deckPricing: (id: string, signal?: AbortSignal) => get<DeckPricing>(`/decks/${encodeURIComponent(id)}/pricing`, signal),
  deckMassEntry: (id: string, signal?: AbortSignal) => get<DeckMassEntry>(`/decks/${encodeURIComponent(id)}/massentry`, signal),

  // Deck intelligence — strategy guide, version history, battle logs.
  // Strategy edits never bump the version; null / '' clears the guide.
  setDeckStrategy: (id: string, strategyMd: string | null) =>
    send<DeckDetail>('PUT', `/decks/${encodeURIComponent(id)}/strategy`, { strategyMd }),
  deckVersions: (id: string, signal?: AbortSignal) =>
    get<DeckVersionsResponse>(`/decks/${encodeURIComponent(id)}/versions`, signal),
  deckVersion: (id: string, version: number, signal?: AbortSignal) =>
    get<DeckVersionDetail>(`/decks/${encodeURIComponent(id)}/versions/${version}`, signal),
  // Non-destructive: applies the old snapshot as a NEW version (history is kept).
  revertDeck: (id: string, body: { toVersion: number; includeStrategy?: boolean; note?: string }) =>
    send<DeckDetail & { revert: RevertResult }>('POST', `/decks/${encodeURIComponent(id)}/revert`, body),
  battleLogs: (id: string, params?: { version?: number; page?: number; pageSize?: number }, signal?: AbortSignal) => {
    const q = new URLSearchParams()
    if (params?.version != null) q.set('version', String(params.version))
    if (params?.page != null) q.set('page', String(params.page))
    if (params?.pageSize != null) q.set('pageSize', String(params.pageSize))
    const qs = q.toString()
    return get<BattleLogsResponse>(`/decks/${encodeURIComponent(id)}/logs${qs ? `?${qs}` : ''}`, signal)
  },
  battleLog: (id: string, logId: number, signal?: AbortSignal) =>
    get<{ log: BattleLog }>(`/decks/${encodeURIComponent(id)}/logs/${logId}`, signal),
  addBattleLog: (id: string, body: AddBattleLogBody) =>
    send<{ log: BattleLog; attachedToVersion: number }>('POST', `/decks/${encodeURIComponent(id)}/logs`, body),
  patchBattleLog: (id: string, logId: number, body: { result?: BattleResult | null; opponent?: string | null; opponentDeck?: string | null; notes?: string | null; playedAt?: string }) =>
    send<{ log: BattleLog }>('PATCH', `/decks/${encodeURIComponent(id)}/logs/${logId}`, body),
  deleteBattleLog: (id: string, logId: number) =>
    send<{ deleted: number }>('DELETE', `/decks/${encodeURIComponent(id)}/logs/${logId}`),

  // Insights / gamification (Phase 6)
  overview: (signal?: AbortSignal) => get<InsightsOverview>('/insights/overview', signal),

  submitBug: (body: { text: string; page: string; screenshot?: string; viewport?: string; userAgent?: string }) =>
    send<{ id: string; saved: string }>('POST', '/bugs', body),
  // Newest-first named collection events (for the stream overlay). `since` is an
  // ISO timestamp filter; pair it with client-side eventId dedup (the API notes a
  // microsecond→millisecond `since` precision caveat, so `since` alone can re-return
  // a just-seen event).
  collectionEvents: (params?: { since?: string; limit?: number }, signal?: AbortSignal) => {
    const q = new URLSearchParams()
    if (params?.since) q.set('since', params.since)
    if (params?.limit != null) q.set('limit', String(params.limit))
    const qs = q.toString()
    return get<CollectionEventsResponse>(`/collection/events${qs ? `?${qs}` : ''}`, signal)
  },
  insightsValue: (range: ValueRange, currency = 'USD', signal?: AbortSignal) =>
    get<ValueResponse>(`/insights/value?range=${range}&currency=${encodeURIComponent(currency)}`, signal),
  dex: (params: URLSearchParams, signal?: AbortSignal) =>
    get<SpeciesGridResponse>(`/insights/pokedex?${params.toString()}`, signal),
  species: (id: string, signal?: AbortSignal) =>
    get<SpeciesDetailResponse>(`/insights/deckscout/${encodeURIComponent(id)}`, signal),
}
