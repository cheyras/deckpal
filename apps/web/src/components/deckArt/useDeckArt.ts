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
import { artUrl, preloadArt, screenDensity } from './artAssets'
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

/**
 * `complete` is false when a card lookup or the art sample failed. Such a spec
 * is still shown, but it is not written to the device cache: it is a
 * degraded answer, and caching it would pin this device to colours another
 * device (or a later visit here) would not derive. It is retried next visit.
 */
export async function buildDeckArt(qc: QueryClient, deck: DeckSummary): Promise<{ spec: DeckArtSpec; complete: boolean }> {
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
    // A grey artwork legitimately has no colour; only a failed READ is incomplete.
    const sample = first ? await sampleArtSwatch(first.low) : { read: true, color: null }
    const spec = deriveDeckArt({ ...base, artSwatch: sample.color })
    // Fetch and decode the generated panel and studio before the spec lands,
    // so the tile is dressed in one paint rather than piece by piece.
    const d = screenDensity()
    await preloadArt([artUrl(spec.art.box, d), artUrl(spec.art.backdrop, d)])
    return { spec, complete: facts.size === top.length && sample.read }
  })
}

// ── Never paint new art mid-scroll ───────────────────────────────────────────
// A tile whose art arrives re-renders and re-rasterises its whole scene. Doing
// that while a finger is moving the page is the one thing in this feature that
// could cost a frame, so a finished spec waits for the scroll to rest (160 ms
// of quiet; a capture listener hears the app's inner scroll containers too).
// The wait is capped so a long continuous scroll still fills in.

let lastScroll = 0
if (typeof window !== 'undefined') {
  window.addEventListener('scroll', () => { lastScroll = performance.now() }, { passive: true, capture: true })
}

function scrollRest(quietMs = 160, maxWaitMs = 8000): Promise<void> {
  const start = performance.now()
  return new Promise((resolve) => {
    const check = () => {
      const now = performance.now()
      const quietFor = now - lastScroll
      if (quietFor >= quietMs || now - start >= maxWaitMs) resolve()
      else setTimeout(check, Math.max(16, quietMs - quietFor))
    }
    check()
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

// ── Dressing tiles a few at a time, in quiet idle time ───────────────────────
// A dressed tile — typeset title, gradient-mapped artwork — costs real layout
// and paint the first time it is drawn: measured on a 4×-throttled phone
// profile, all twenty at once was a 260 ms task at load. So only the first
// screen is dressed in the first render; the rest are queued and dressed two
// at a time in idle callbacks, nearest-to-the-viewport first, and never while
// the page is scrolling (a tile dressed mid-scroll would spend its layout in
// the frame the finger is moving). Until then a tile shows its colours, box
// and cards — everything but the title and the artwork.

const DRESS_PER_SLICE = 2
interface Undressed {
  near: boolean
  dress: () => void
}
const undressed = new Set<Undressed>()
let dressScheduled = false

const idle: (cb: () => void) => void =
  typeof window !== 'undefined' && 'requestIdleCallback' in window
    ? (cb) => window.requestIdleCallback(cb, { timeout: 600 })
    : (cb) => setTimeout(cb, 60)

function scheduleDressing() {
  if (dressScheduled || undressed.size === 0) return
  dressScheduled = true
  idle(() => {
    dressScheduled = false
    if (performance.now() - lastScroll < 160) {
      setTimeout(scheduleDressing, 160)
      return
    }
    // Near tiles first, then the rest in the order they mounted (list order).
    const batch = [...undressed].sort((a, b) => Number(b.near) - Number(a.near)).slice(0, DRESS_PER_SLICE)
    for (const t of batch) {
      undressed.delete(t)
      t.dress()
    }
    scheduleDressing()
  })
}

/** Whether the tile may draw its title and artwork yet (see above). `eager` = first screen. */
function useDressed(eager: boolean, near: boolean): boolean {
  const [dressed, setDressed] = useState(eager)
  const entry = useRef<Undressed | null>(null)
  useEffect(() => {
    if (dressed) return
    const t: Undressed = { near: false, dress: () => setDressed(true) }
    entry.current = t
    undressed.add(t)
    scheduleDressing()
    return () => {
      undressed.delete(t)
    }
  }, [dressed])
  useEffect(() => {
    if (entry.current) entry.current.near = near
  }, [near])
  return dressed
}

// ── The hook ─────────────────────────────────────────────────────────────────

export interface DeckArtState {
  spec: DeckArtSpec
  /** the deck has cards but its art is not derived yet (the tile shows placeholder cards) */
  pending: boolean
  /** the spec was derived while this tile was on screen (so its arrival may animate) */
  arrived: boolean
  /** the tile has come near the viewport (its art images may load) */
  near: boolean
  /** the tile may draw its title and artwork (first screen at once, the rest in idle slices) */
  dressed: boolean
}

export function useDeckArt(deck: DeckSummary, ref: RefObject<Element | null>, eager = false): DeckArtState {
  const qc = useQueryClient()
  const key = artKey(deck)
  const cached = useMemo(() => readSpec(deck.id, key), [deck.id, key])
  const empty = deck.totalCount === 0
  const near = useNearViewport(ref)
  const dressed = useDressed(eager, near)
  const provisional = useMemo(() => provisionalDeckArt(deck.id, deck.glcType, empty), [deck.id, deck.glcType, empty])
  // Was this tile's art already known when it mounted? Then nothing "arrives".
  const knownAtMount = useRef(!!cached || empty)

  const q = useQuery({
    queryKey: ['deck-art', deck.id, key],
    queryFn: async () => {
      const { spec, complete } = await buildDeckArt(qc, deck)
      if (complete) writeSpec(deck.id, key, spec)
      await scrollRest()
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
  return { spec, pending, arrived: !knownAtMount.current && !!q.data, near, dressed }
}
