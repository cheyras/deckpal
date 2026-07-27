import { useEffect, useRef, useState } from 'react'
import { api, type InsightsOverview } from '../lib/api'
import { Icon } from '../components/Icon'

// Stream overlay (UI-SPEC §13.5 "Stream Tools"). A standalone, transparent-background
// route meant to be added to OBS as a Browser Source:
//
//     http://the.grid/pokedex/overlay          (LAN)
//     http://127.0.0.1/pokedex/overlay          (same box)
//
// It polls the insights overview every few seconds and animates a "just added"
// pop-up when the owned-card count grows.
//
// ACTIVITY-SOURCE LIMITATION: the API exposes no per-card recent-activity read
// endpoint (the collection_event table has a `(user_id, occurred_at DESC)` feed
// index but no GET route, and this task must not edit apps/api). So we detect a
// change by polling `insights/overview` and watching `trainer.totalCards` /
// `uniqueCards` for a positive delta. That tells us *that* cards were added and
// whether any were new-to-collection, but NOT *which* card. Naming the card would
// need a new `GET /collection/events` endpoint (recommended follow-up).

const POLL_MS = 4000

interface Pop {
  id: number
  delta: number
  isNew: boolean
  total: number
  unique: number
  level: number
}

function totalsOf(o: InsightsOverview): { total: number; unique: number; level: number } {
  return { total: o.trainer.totalCards, unique: o.trainer.uniqueCards, level: o.trainer.level }
}

function PopCard({ pop, onDone }: { pop: Pop; onDone: (id: number) => void }) {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const enter = requestAnimationFrame(() => setShown(true))
    const hold = setTimeout(() => setShown(false), 6000)
    const remove = setTimeout(() => onDone(pop.id), 6500)
    return () => {
      cancelAnimationFrame(enter)
      clearTimeout(hold)
      clearTimeout(remove)
    }
  }, [pop.id, onDone])

  return (
    <div
      style={{
        transform: shown ? 'translateX(0)' : 'translateX(120%)',
        opacity: shown ? 1 : 0,
        transition: 'transform 380ms cubic-bezier(0.4,0,0.2,1), opacity 380ms ease',
      }}
      className="pointer-events-auto flex w-[340px] items-center gap-[14px] rounded-2xl border border-action-primary-strong/60 bg-surface-primary/95 p-[16px] shadow-elevated"
    >
      <span
        className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full bg-action-primary text-action-primary-text"
        style={{ boxShadow: '0 0 0 6px var(--color-overlay-ring)' }}
      >
        <Icon name="sparkle" size={28} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[17px] font-extrabold leading-[22px] text-text-primary">
          {pop.isNew ? 'New card added!' : pop.delta > 1 ? `+${pop.delta} cards added!` : 'Card added!'}
        </div>
        <div className="mt-[2px] text-[13px] leading-[18px] text-text-secondary">
          Collection now <span className="font-bold text-change-positive">{pop.total.toLocaleString()}</span> cards ·{' '}
          <span className="font-bold text-text-primary">{pop.unique.toLocaleString()}</span> unique
        </div>
      </div>
      <span className="flex shrink-0 flex-col items-center rounded-lg bg-surface-tertiary px-[10px] py-[6px]">
        <span className="text-[9px] font-bold leading-[12px] text-action-primary">LVL</span>
        <span className="text-[18px] font-extrabold leading-[20px] text-text-primary">{pop.level}</span>
      </span>
    </div>
  )
}

export function Overlay() {
  const [pops, setPops] = useState<Pop[]>([])
  const prevRef = useRef<{ total: number; unique: number } | null>(null)
  const idRef = useRef(1)

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

  const push = (delta: number, isNew: boolean, total: number, unique: number, level: number) => {
    const id = idRef.current++
    setPops((cur) => [...cur, { id, delta, isNew, total, unique, level }])
  }

  // Demo mode: ?demo=1 fires a sample pop immediately (OBS setup + screenshots).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('demo') === '1') {
      push(1, true, 5, 4, 0)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Poll the overview; on a positive owned-count delta, pop.
  useEffect(() => {
    let alive = true
    const tick = async () => {
      try {
        const o = await api.overview()
        if (!alive) return
        const now = totalsOf(o)
        const prev = prevRef.current
        if (prev && now.total > prev.total) {
          push(now.total - prev.total, now.unique > prev.unique, now.total, now.unique, now.level)
        }
        prevRef.current = { total: now.total, unique: now.unique }
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

  const onDone = (id: number) => setPops((cur) => cur.filter((p) => p.id !== id))

  return (
    <div className="pointer-events-none fixed inset-0 flex flex-col items-end justify-end gap-[12px] p-[24px]">
      {pops.map((p) => (
        <PopCard key={p.id} pop={p} onDone={onDone} />
      ))}
    </div>
  )
}
