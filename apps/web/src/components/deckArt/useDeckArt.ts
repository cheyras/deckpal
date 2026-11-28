// Getting a deck's art onto its tile without slowing /decks down.
//
//   1. A cached spec for this exact deck state renders synchronously — no
//      request, no placeholder (store.ts).
//   2. Otherwise the tile shows the provisional box (derive.ts) and waits to be
//      NEAR the viewport (one shared IntersectionObserver, 400px margin). Decks
//      below the fold cost nothing until they are about to be seen.
//   3. Then it queues for a slot (two decks at a time, page-wide), fetches the
//      deck detail and catalog facts for its top candidates through the app's
//      own query cache — the same ['deck', id] and ['card', id] keys the deck
//      page and card sheet use, so opening the deck afterwards is instant — and
//      samples one colour from the main attacker's art.
//   4. The spec is cached and the tile re-renders once.

import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { api, type CardDetailResponse, type DeckDetail, type DeckSummary } from '../../lib/api'
import {
  FACTS_FOR_TOP,
  deriveDeckArt,
  provisionalDeckArt,
  rankCandidates,
  type ArtCardFacts,
  type DeckArtSpec,
} from './derive'
import { sampleArtSwatch } from './swatch'
import { artKey, clearSpecs, readSpec, writeSpec } from './store'
import { isCloudMode, supabase } from '../../lib/supabase'

// Signing out forgets this device's deck art (see clearSpecs). Same hook and
// same reasoning as the skin/topbar caches in lib/settingsSync.ts.
if (isCloudMode && typeof window !== 'undefined') {
  supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') clearSpecs()
  })
}

// ── A page-wide concurrency limit ────────────────────────────────────────────

const MAX_CONCURRENT = 2
let running = 0
const waiting: Array<() => void> = []

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= MAX_CONCURRENT) await new Promise<void>((r) => waiting.push(r))
  running++
  try {
    return await fn()
  } finally {
    running--
    waiting.shift()?.()
  }
}

function toFacts(r: CardDetailResponse): ArtCardFacts {
  const c = r.card
  return {
    types: c.types ?? [],
    evolvesFrom: c.evolvesFrom ?? null,
    attacks: (c.attacks ?? []).map((a) => ({ cost: a.cost as string | string[] | null, damage: a.damage })),
    abilities: c.abilities ?? [],
  }
}

const DETAIL_STALE_MS = 5 * 60_000
const CARD_STALE_MS = 60 * 60_000

export async function buildDeckArt(qc: QueryClient, deck: DeckSummary): Promise<DeckArtSpec> {
  return withSlot(async () => {
    const detail = await qc.fetchQuery<DeckDetail>({
      queryKey: ['deck', deck.id],
      queryFn: ({ signal }) => api.deck(deck.id, signal),
      staleTime: DETAIL_STALE_MS,
    })
    const rows = detail.cards
    const strategyMd = detail.deck.strategyMd
    const top = rankCandidates(rows, strategyMd).slice(0, FACTS_FOR_TOP)
    const facts = new Map<string, ArtCardFacts>()
    await Promise.all(
      top.map(async (c) => {
        try {
          const r = await qc.fetchQuery<CardDetailResponse>({
            queryKey: ['card', c.cardId],
            queryFn: ({ signal }) => api.card(c.cardId, signal),
            staleTime: CARD_STALE_MS,
          })
          facts.set(c.cardId, toFacts(r))
        } catch {
          // a missing lookup degrades that candidate to its row-only score
        }
      }),
    )
    const base = { deckId: deck.id, glcType: deck.glcType, rows, strategyMd, facts }
    const first = deriveDeckArt(base).featured[0]
    const artSwatch = first ? await sampleArtSwatch(first.low) : null
    return deriveDeckArt({ ...base, artSwatch })
  })
}

// ── Near-viewport latch, one observer for every tile ─────────────────────────

const callbacks = new WeakMap<Element, () => void>()
let observer: IntersectionObserver | null = null

function observe(el: Element, cb: () => void): () => void {
  if (typeof IntersectionObserver === 'undefined') {
    cb()
    return () => {}
  }
  if (!observer) {
    observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue
          const fn = callbacks.get(e.target)
          if (fn) {
            callbacks.delete(e.target)
            observer?.unobserve(e.target)
            fn()
          }
        }
      },
      { rootMargin: '400px 0px' },
    )
  }
  callbacks.set(el, cb)
  observer.observe(el)
  return () => {
    callbacks.delete(el)
    observer?.unobserve(el)
  }
}

/** True once `ref` has come within 400px of the viewport; never goes back to false. */
export function useNearViewport(ref: RefObject<Element | null>): boolean {
  const [near, setNear] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || near) return
    return observe(el, () => setNear(true))
  }, [ref, near])
  return near
}

// ── The hook ─────────────────────────────────────────────────────────────────

export interface DeckArtState {
  spec: DeckArtSpec
  /** the deck has cards but its art is not derived yet (the tile shows placeholder cards) */
  pending: boolean
  /** the spec was derived while this tile was on screen (so its arrival may animate) */
  arrived: boolean
}

export function useDeckArt(deck: DeckSummary, ref: RefObject<Element | null>): DeckArtState {
  const qc = useQueryClient()
  const key = artKey(deck)
  const cached = useMemo(() => readSpec(deck.id, key), [deck.id, key])
  const empty = deck.totalCount === 0
  const near = useNearViewport(ref)
  const provisional = useMemo(() => provisionalDeckArt(deck.id, deck.glcType), [deck.id, deck.glcType])
  // Was this tile's art already known when it mounted? Then nothing "arrives".
  const knownAtMount = useRef(!!cached || empty)

  const q = useQuery({
    queryKey: ['deck-art', deck.id, key],
    queryFn: async () => {
      const spec = await buildDeckArt(qc, deck)
      writeSpec(deck.id, key, spec)
      return spec
    },
    enabled: near && !cached && !empty,
    staleTime: Infinity,
    retry: 1,
  })

  const spec = cached ?? q.data ?? provisional
  // A failed derivation (detail 404, network) settles on the provisional box
  // rather than leaving placeholder cards up forever.
  const pending = !cached && !empty && !q.data && !q.isError
  return { spec, pending, arrived: !knownAtMount.current && !!q.data }
}
