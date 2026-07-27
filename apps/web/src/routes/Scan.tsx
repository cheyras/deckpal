import { useCallback, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { api, type ScanMatch, type ScanResponse } from '../lib/api'
import { Content } from '../components/ui'
import { CardImage } from '../components/CardImage'
import { Icon } from '../components/Icon'
import { fmtNumber } from '../lib/format'

// The scanner (Phase 8 flagship). Upload OR camera-capture a card photo, POST the
// raw bytes to /scan, and rank the perceptual-hash matches. A confident match
// (Hamming distance ≤ threshold) offers a one-tap "Add to collection".

// The scan match carries a tcgdex cardId + set id but no series slug; the image
// URL encodes it as /pokedex/images/<lang>/<series>/<set>/<number>/<q>.webp.
function routeFromImage(low: string): { series: string; set: string; number: string } | null {
  const parts = low.split('/').filter(Boolean) // [pokedex, images, en, series, set, number, low.webp]
  const i = parts.indexOf('images')
  if (i < 0 || parts.length < i + 5) return null
  return { series: parts[i + 2], set: parts[i + 3], number: parts[i + 4] }
}

function confidencePct(c: number): number {
  return Math.round(c * 100)
}

function MatchTile({ match, best }: { match: ScanMatch; best: boolean }) {
  const [state, setState] = useState<'idle' | 'adding' | 'added' | 'error'>('idle')
  const route = routeFromImage(match.images.low)
  const pct = confidencePct(match.confidence)

  const add = async () => {
    setState('adding')
    try {
      await api.setCardHave(match.cardId, true)
      setState('added')
    } catch {
      setState('error')
    }
  }

  const tile = (
    <div className="relative">
      <CardImage low={match.images.low} high={match.images.high} alt={`${match.name} — ${fmtNumber(match.number)}`} radius={8} />
      {best && (
        <span className="absolute left-[8px] top-[8px] rounded-md bg-action-primary-strong px-[8px] py-[3px] text-[11px] font-bold leading-[16px] text-action-primary-strong-text shadow-panel">
          Best match
        </span>
      )}
    </div>
  )

  return (
    <div className="flex flex-col gap-[8px] rounded-xl border border-border-default bg-surface-secondary p-[10px]">
      {route ? (
        <Link to="/series/$series/$set/$number" params={route} className="group block">
          {tile}
        </Link>
      ) : (
        tile
      )}

      <div className="min-w-0">
        <div className="truncate text-[15px] font-semibold leading-[20px] text-text-primary">{match.name}</div>
        <div className="flex items-center justify-between text-[12px] text-text-muted">
          <span className="truncate">{match.setName} · {fmtNumber(match.number)}</span>
          {match.rarity && <span className="shrink-0">{match.rarity}</span>}
        </div>
      </div>

      {/* confidence meter — honest bit-similarity, distance shown raw */}
      <div>
        <div className="mb-[3px] flex items-center justify-between text-[11px]">
          <span className="text-text-muted">Match</span>
          <span className="font-bold text-text-primary">
            {pct}% <span className="font-normal text-text-muted">· dist {match.distance}</span>
          </span>
        </div>
        <div className="h-[5px] w-full overflow-hidden rounded-full bg-[#1a1d24]">
          <div
            className="h-full rounded-full"
            style={{
              width: `${pct}%`,
              background: best ? 'var(--color-change-positive)' : 'var(--color-action-brand)',
            }}
          />
        </div>
      </div>

      <button
        onClick={add}
        disabled={state === 'adding' || state === 'added'}
        className={`flex h-[38px] items-center justify-center gap-[7px] rounded-full text-[13px] font-bold transition-colors disabled:opacity-70 ${
          state === 'added'
            ? 'bg-change-positive text-surface-primary'
            : 'bg-action-primary text-action-primary-text hover:bg-action-primary-hover'
        }`}
      >
        {state === 'added' ? (
          <><Icon name="check" size={16} /> Added</>
        ) : state === 'adding' ? (
          'Adding…'
        ) : state === 'error' ? (
          <><Icon name="alert" size={15} /> Retry</>
        ) : (
          <><Icon name="plus" size={16} /> Add to collection</>
        )}
      </button>
    </div>
  )
}

export function Scan() {
  const [preview, setPreview] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const [result, setResult] = useState<ScanResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)

  const runScan = useCallback(async (file: File) => {
    setError(null)
    setResult(null)
    setScanning(true)
    // Preview as a data: URL — the API's CSP allows `img-src 'self' data:` but not
    // blob:, so an object URL would be blocked and render as a broken image.
    const reader = new FileReader()
    reader.onload = () => setPreview(reader.result as string)
    reader.readAsDataURL(file)
    try {
      const bytes = await file.arrayBuffer()
      const res = await api.scan(bytes, file.type || 'image/jpeg', 5, 'low')
      setResult(res)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setScanning(false)
    }
  }, [])

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) void runScan(file)
    e.target.value = '' // allow re-picking the same file
  }

  return (
    <Content cap={1000}>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPick} />
      {/* capture="environment" opens the rear camera on mobile */}
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onPick} />

      <div className="mb-[8px] flex items-center gap-[10px]">
        <span className="flex h-[40px] w-[40px] items-center justify-center rounded-lg bg-action-primary text-action-primary-text">
          <Icon name="camera" size={22} />
        </span>
        <h1 className="text-[28px] font-bold leading-[34px] text-text-primary">Scan a card</h1>
      </div>
      <p className="mb-[20px] max-w-[560px] text-[14px] leading-[21px] text-text-muted">
        Take a straight-on photo or upload an image of a card and we’ll match it against the{' '}
        {result ? result.indexSize.toLocaleString() : '21,828'}-card catalog by perceptual hash. Then add it to your
        collection in one tap.
      </p>

      {/* upload + camera controls */}
      <div className="flex flex-wrap gap-[12px]">
        <button
          onClick={() => cameraRef.current?.click()}
          className="flex h-[46px] items-center gap-[8px] rounded-full bg-action-primary px-[20px] text-[14px] font-bold text-action-primary-text hover:bg-action-primary-hover"
        >
          <Icon name="camera" size={18} /> Take photo
        </button>
        <button
          onClick={() => fileRef.current?.click()}
          className="flex h-[46px] items-center gap-[8px] rounded-full bg-surface-tertiary px-[20px] text-[14px] font-bold text-text-primary hover:bg-action-default-hover"
        >
          <Icon name="download" size={18} className="rotate-180" /> Upload image
        </button>
      </div>

      {/* drop zone / preview */}
      <div
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          const file = e.dataTransfer.files?.[0]
          if (file) void runScan(file)
        }}
        className="mt-[16px] flex min-h-[220px] cursor-pointer flex-col items-center justify-center gap-[10px] rounded-2xl border-2 border-dashed border-action-ghost-border bg-surface-secondary/50 p-[20px] text-center hover:border-border-focus"
      >
        {preview ? (
          <img src={preview} alt="Card to scan" className="max-h-[300px] rounded-lg object-contain" />
        ) : (
          <>
            <Icon name="camera" size={40} className="text-icon-muted" />
            <div className="text-[15px] font-semibold text-text-primary">Drop an image here, or click to browse</div>
            <div className="text-[12px] text-text-muted">JPEG, PNG or WebP · a clear, straight-on shot works best</div>
          </>
        )}
      </div>

      {/* status */}
      {scanning && (
        <div className="mt-[24px] flex items-center justify-center gap-[12px] py-[24px] text-text-muted">
          <div className="h-[28px] w-[28px] animate-spin rounded-full border-2 border-surface-tertiary border-t-action-primary" />
          <span className="text-[14px]">Scanning…</span>
        </div>
      )}

      {error && !scanning && (
        <div className="mt-[24px] flex items-center gap-[10px] rounded-xl border border-border-default bg-surface-secondary p-[16px] text-[14px] text-error">
          <Icon name="alert" size={18} /> Couldn’t scan that image: {error}
        </div>
      )}

      {/* no confident match */}
      {result && !scanning && !result.matched && (
        <div className="mt-[24px] flex flex-col items-center gap-[8px] rounded-2xl border border-border-default bg-surface-secondary p-[28px] text-center">
          <Icon name="search" size={32} className="text-icon-muted" />
          <div className="text-[17px] font-bold text-text-primary">No confident match</div>
          <div className="max-w-[420px] text-[14px] text-text-muted">
            We couldn’t confidently identify this card. Try a clearer, straight-on photo with the whole card in frame and
            no glare. {result.matches.length > 0 && 'The closest guesses are below, but treat them with caution.'}
          </div>
        </div>
      )}

      {/* matches */}
      {result && !scanning && result.matches.length > 0 && (
        <div className="mt-[24px]">
          <div className="mb-[12px] flex items-center gap-[8px] text-[13px] font-bold text-text-secondary">
            <span className="uppercase tracking-wide">{result.matched ? 'Matches' : 'Closest guesses'}</span>
            <span className="text-text-muted">({result.matches.length})</span>
          </div>
          <div className="grid gap-[16px]" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
            {result.matches.map((m, i) => (
              <MatchTile key={m.cardId} match={m} best={result.matched && i === 0} />
            ))}
          </div>
        </div>
      )}
    </Content>
  )
}
