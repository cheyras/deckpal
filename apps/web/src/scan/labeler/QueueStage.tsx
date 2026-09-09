// The pending-photo queue, as a screen.
//
// The reader shoots or uploads a batch, and then works it — one photo at a
// time, in the order it was taken, at whatever pace they like and across as
// many sittings as it takes. This is the list they come back to.
//
// ── OBJECT URLS ARE OWNED HERE, AND REVOKED ────────────────────────────────
//
// Every thumbnail is a `blob:` URL over a stored `Blob`, and each one pins that
// blob in memory until it is revoked. A hundred queued phone photos is easily
// several hundred megabytes, so a screen that mints URLs per render and never
// revokes them is a leak large enough to be fatal on the device this runs on.
// One effect owns the whole map, keyed by the id list, and revokes the previous
// generation on every change.
import { useEffect, useMemo, useState } from 'react'
import { Icon } from '../../components/Icon'
import type { QueuedPhoto } from './queueDb'

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export function QueueStage({
  items,
  usage,
  busy,
  error,
  onOpen,
  onRemove,
  onClear,
  onAddFiles,
}: {
  items: QueuedPhoto[]
  usage: { bytes: number; quota: number | null } | null
  /** The id currently being loaded into the editor — disables the row so a
   *  double tap cannot start two. */
  busy: number | null
  error: string | null
  onOpen: (item: QueuedPhoto) => void
  onRemove: (id: number) => void
  onClear: () => void
  onAddFiles: (files: File[]) => void
}) {
  const [confirmClear, setConfirmClear] = useState(false)

  // One URL per item, revoked when the item leaves. Keyed on the id list so a
  // re-render that changes nothing does not churn a hundred blob URLs.
  const key = items.map((i) => i.id).join(',')
  const urls = useMemo(() => {
    const map = new Map<number, string>()
    for (const it of items) map.set(it.id, URL.createObjectURL(it.blob))
    return map
    // `items` is intentionally not a dependency: `key` IS its identity here,
    // and depending on the array would mint a new generation on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls])

  const next = items[0]

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-neutral-950">
      <div className="flex shrink-0 flex-wrap items-center gap-[8px] border-b border-white/10 px-[12px] py-[7px] text-[11px]">
        <span className="font-bold text-white/80">
          {items.length} photo{items.length === 1 ? '' : 's'} waiting
        </span>
        {usage && (
          <span className="font-mono text-white/35" title="Bytes this queue is holding on this device">
            {fmtBytes(usage.bytes)}
            {usage.quota ? ` / ${fmtBytes(usage.quota)}` : ''}
          </span>
        )}
        <div className="flex-1" />
        {items.length > 0 &&
          (confirmClear ? (
            <>
              <button
                type="button"
                onClick={() => setConfirmClear(false)}
                className="h-[32px] rounded-full px-[10px] text-[11px] font-bold text-white/60 hover:text-white"
              >
                cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmClear(false)
                  onClear()
                }}
                className="h-[32px] rounded-full bg-red-500 px-[12px] text-[11px] font-bold text-white"
              >
                discard all {items.length}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmClear(true)}
              className="h-[32px] rounded-full bg-white/10 px-[12px] text-[11px] font-bold text-white/60 hover:bg-white/15"
            >
              Clear
            </button>
          ))}
      </div>

      {error && (
        <div className="shrink-0 bg-red-500/15 px-[12px] py-[6px] text-[11px] leading-[15px] text-red-200">{error}</div>
      )}

      {!items.length ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-[14px] p-[20px] text-center">
          <Icon name="camera" size={26} className="text-white/25" />
          <span className="max-w-[280px] text-[12px] leading-[17px] text-white/50">
            Nothing queued. Shoot a batch in <b className="text-white/75">Capture</b> with{' '}
            <b className="text-white/75">Rapid</b> on, or add photos below — they stay here until you label them,
            even if you close the tab.
          </span>
          <AddFilesButton onAddFiles={onAddFiles} />
        </div>
      ) : (
        <>
          <div className="flex shrink-0 items-center gap-[8px] border-b border-white/10 px-[12px] py-[8px]">
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => next && onOpen(next)}
              className="h-[44px] flex-1 rounded-full bg-cyan-400 px-[16px] text-[12px] font-bold text-cyan-950 hover:bg-cyan-300 disabled:opacity-40"
            >
              Label next →
            </button>
            <AddFilesButton onAddFiles={onAddFiles} compact />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-[10px]">
            <div className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-[8px]">
              {items.map((it, i) => (
                <div
                  key={it.id}
                  className={`flex flex-col overflow-hidden rounded-[8px] bg-white/5 ring-1 ${
                    i === 0 ? 'ring-cyan-300/60' : 'ring-white/10'
                  }`}
                >
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => onOpen(it)}
                    className="relative aspect-square bg-black disabled:opacity-50"
                    aria-label={`Label ${it.name}`}
                  >
                    <img
                      src={urls.get(it.id)}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-contain"
                    />
                    <span className="pointer-events-none absolute left-[4px] top-[4px] rounded bg-black/70 px-[5px] py-[1px] font-mono text-[9px] font-bold text-white/70">
                      {i + 1}
                    </span>
                    {busy === it.id && (
                      <span className="absolute inset-0 flex items-center justify-center bg-black/60">
                        <span className="h-[20px] w-[20px] animate-spin rounded-full border-2 border-white/20 border-t-cyan-300" />
                      </span>
                    )}
                  </button>
                  <div className="flex items-center gap-[4px] px-[6px] py-[4px]">
                    <span className="min-w-0 flex-1 truncate text-[10px] text-white/40" title={it.name}>
                      {it.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => onRemove(it.id)}
                      aria-label={`Discard ${it.name}`}
                      title="Discard this photo without labelling it"
                      className="rounded px-[5px] text-[10px] font-bold text-white/35 hover:bg-red-500/20 hover:text-red-300"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

/** The picker. Multi-select, and the files go STRAIGHT to the queue — the
 *  reader is adding to a batch here, not opening one photo. */
function AddFilesButton({ onAddFiles, compact = false }: { onAddFiles: (files: File[]) => void; compact?: boolean }) {
  return (
    <label
      className={`flex h-[44px] cursor-pointer items-center justify-center rounded-full bg-white/10 font-bold text-white/75 hover:bg-white/15 ${
        compact ? 'px-[14px] text-[12px]' : 'px-[18px] text-[12px]'
      }`}
    >
      {compact ? '+ Add' : '+ Add photos'}
      <input
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])]
          // Name order, not the OS's arbitrary selection order — a session shot
          // on a phone is named in time order, and labelling it in that order is
          // how the reader keeps their place. (Same rule as UploadStage.)
          files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
          if (files.length) onAddFiles(files)
          // Reset so picking the SAME files again still fires a change event.
          e.target.value = ''
        }}
      />
    </label>
  )
}
