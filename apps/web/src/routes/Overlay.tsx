import { useEffect, useRef, useState } from 'react'
import { api, type CollectionEvent } from '../lib/api'
import { Icon } from '../components/Icon'

// Stream overlay (UI-SPEC §13.5 "Stream Tools"). A standalone, transparent-background
// route meant to be added to OBS as a Browser Source:
//
//     http://the.grid/deckscout/overlay          (LAN)
//     http://127.0.0.1/deckscout/overlay          (same box)
//
// It polls the named collection-events feed (GET /collection/events?since=<last>)
// and animates a "just added: <card name + art>" pop-up for each new event.
//
// DEDUP: the API flags a microsecond→millisecond `since` precision caveat, so an
// event we've already shown can be re-returned by a `since=`-filtered query. We
// therefore dedup on `eventId` (track every id we've popped) and never rely on
// `since` alone. `since` is still sent as a coarse server-side filter to keep
// payloads small; the id set is the source of truth.

const POLL_MS = 4000
const MAX_VISIBLE = 4

function PopCard({ ev, onDone }: { ev: CollectionEvent; onDone: (id: string) => void }) {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const enter = requestAnimationFrame(() => setShown(true))
    const hold = setTimeout(() => setShown(false), 6000)
    const remove = setTimeout(() => onDone(ev.eventId), 6500)
    return () => {
      cancelAnimationFrame(enter)
      clearTimeout(hold)
      clearTimeout(remove)
    }
  }, [ev.eventId, onDone])

  const art = ev.images?.high || ev.images?.low || null
  const isNew = ev.newQuantity === ev.quantityDelta && ev.quantityDelta > 0
  const qty = ev.quantityDelta
  const heading = isNew ? 'New card added!' : qty > 1 ? `+${qty} added!` : 'Card added!'

  return (
    <div
      style={{
        transform: shown ? 'translateX(0)' : 'translateX(120%)',
        opacity: shown ? 1 : 0,
        transition: 'transform 380ms cubic-bezier(0.4,0,0.2,1), opacity 380ms ease',
      }}
      className="pointer-events-auto flex w-[360px] items-center gap-[14px] rounded-2xl border border-action-primary-strong/60 bg-surface-primary/95 p-[14px] shadow-elevated"
    >
      {art ? (
        <img
          src={art}
          alt={ev.cardName}
          className="h-[92px] w-[66px] shrink-0 rounded-lg bg-surface-tertiary object-contain"
          style={{ boxShadow: '0 0 0 3px var(--color-overlay-ring)' }}
        />
      ) : (
        <span
          className="flex h-[92px] w-[66px] shrink-0 items-center justify-center rounded-lg bg-action-primary text-action-primary-text"
          style={{ boxShadow: '0 0 0 3px var(--color-overlay-ring)' }}
        >
          <Icon name="sparkle" size={28} />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-[6px] text-[11px] font-bold uppercase tracking-wide text-action-primary">
          <Icon name="sparkle" size={13} />
          {heading}
        </div>
        <div className="mt-[3px] truncate text-[18px] font-extrabold leading-[22px] text-text-primary">
          {ev.cardName}
        </div>
        <div className="mt-[1px] truncate text-[13px] leading-[18px] text-text-secondary">
          {ev.setName} · #{ev.number}
        </div>
        {ev.variantName && ev.variantName.toLowerCase() !== 'normal' && (
          <div className="mt-[3px] inline-block rounded-md bg-surface-tertiary px-[8px] py-[2px] text-[11px] font-bold text-text-primary">
            {ev.variantName}
          </div>
        )}
      </div>
      {ev.newQuantity > 0 && (
        <span className="flex shrink-0 flex-col items-center rounded-lg bg-surface-tertiary px-[10px] py-[6px]">
          <span className="text-[9px] font-bold leading-[12px] text-action-primary">OWNED</span>
          <span className="text-[18px] font-extrabold leading-[20px] text-text-primary">×{ev.newQuantity}</span>
        </span>
      )}
    </div>
  )
}

export function Overlay() {
  const [pops, setPops] = useState<CollectionEvent[]>([])
  // Every eventId we've already shown — the dedup source of truth.
  const seenRef = useRef<Set<string>>(new Set())
  // Newest occurredAt we've observed, sent as a coarse `since=` filter next poll.
  const sinceRef = useRef<string | null>(null)
  // First poll only primes state (no retroactive pop storm on OBS load).
  const primedRef = useRef(false)

  // Transparent background for OBS — the global stylesheet paints html/body an
  // opaque surface colour, so override it for this standalone route only.
  useEffect(() => {
    const html = document.documentElement
    const body = document.body
    const prev = { html: html.style.background, body: body.style.background }
    html.style.background = 'transparent'
    body.style.background = 'transparent'
    return () => {
      html.style.background = prev.html
      body.style.background = prev.body
    }
  }, [])

  // Demo mode: ?demo=1 fires a sample pop immediately (OBS setup + screenshots).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('demo') === '1') {
      const demo: CollectionEvent = {
        eventId: 'demo-1',
        occurredAt: new Date().toISOString(),
        kind: 'add',
        cardId: 'demo',
        cardName: 'Charizard ex',
        setId: 'demo',
        setName: 'Obsidian Flames',
        number: '125',
        variantId: 0,
        variantName: 'Holofoil',
        quantityDelta: 1,
        newQuantity: 1,
        images: { low: null, high: null },
      }
      seenRef.current.add(demo.eventId)
      setPops([demo])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Poll the named events feed; pop each genuinely-new event (deduped by eventId).
  useEffect(() => {
    let alive = true
    const tick = async () => {
      try {
        const since = sinceRef.current
        const { events } = await api.collectionEvents({
          ...(since ? { since } : {}),
          limit: 25,
        })
        if (!alive) return
        // API is newest-first; advance the coarse `since` cursor from the newest.
        if (events.length > 0) {
          const newest = events[0].occurredAt
          if (!sinceRef.current || newest > sinceRef.current) sinceRef.current = newest
        }
        // First poll primes seen-ids without popping (avoids a load-time storm).
        if (!primedRef.current) {
          primedRef.current = true
          for (const e of events) seenRef.current.add(e.eventId)
          return
        }
        // Oldest-first so stacked pops read chronologically; skip anything seen.
        const fresh = events
          .filter((e) => !seenRef.current.has(e.eventId))
          .reverse()
        if (fresh.length === 0) return
        for (const e of fresh) seenRef.current.add(e.eventId)
        setPops((cur) => [...cur, ...fresh].slice(-MAX_VISIBLE))
      } catch {
        /* transient — try again next tick */
      }
    }
    void tick()
    const iv = setInterval(tick, POLL_MS)
    return () => {
      alive = false
      clearInterval(iv)
    }
  }, [])

  const onDone = (id: string) => setPops((cur) => cur.filter((p) => p.eventId !== id))

  return (
    <div className="pointer-events-none fixed inset-0 flex flex-col items-end justify-end gap-[12px] p-[24px]">
      {pops.map((p) => (
        <PopCard key={p.eventId} ev={p} onDone={onDone} />
      ))}
    </div>
  )
}
