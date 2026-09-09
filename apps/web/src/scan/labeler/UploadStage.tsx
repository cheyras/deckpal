// Upload mode — a picked photo is treated AS IF it were a camera stream of
// its own aspect: the same `decodeForCanvas` the product scanner's upload
// fallback uses (scan/ui/uploadNormalize.ts, reused, EXIF-orientation
// aware), then the SAME `buildWorkingFrame` draw path capture mode uses. By
// the time the editor opens, nothing downstream can tell a camera frame from
// an upload.
//
// MULTI-SELECT, AND THE QUEUE LIVES ELSEWHERE. A labelling session is a HUNDRED
// photos, and a picker that takes one at a time makes the reader tap through the
// OS file dialog a hundred times. So this hands the whole selection up at once.
//
// SINCE 2026-09-08 the picked files go STRAIGHT TO THE PERSISTENT QUEUE
// (`queueDb.ts`) rather than opening the first one's editor. The queue used to
// be an in-memory ref in `QuadLabeler`, which is why this file's job was once
// "hand up one batch and let the parent hold the rest"; now the batch is
// written to IndexedDB and survives a reload, a backgrounded tab and the end of
// a session. The reader is moved to the Queue tab, which is where photos are
// worked from.
//
// The picker cannot be re-opened programmatically between frames either: a file
// input needs a user gesture and an async save is not one, so a browser would
// silently ignore the click. Taking every file up front is what makes that
// limitation cost nothing.
import { useRef } from 'react'
import { Icon } from '../../components/Icon'

export function UploadStage({
  busy,
  error,
  queued,
  onFiles,
}: {
  busy: boolean
  error: string | null
  /** How many photos are still waiting behind the one on screen. */
  queued: number
  onFiles: (files: File[]) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-[14px] overflow-y-auto bg-neutral-950 p-[20px] text-center">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])]
          // Name order, not the OS's arbitrary selection order — a session shot
          // on a phone is named in time order, and labelling it in that order
          // is how the reader keeps their place.
          files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
          if (files.length) onFiles(files)
          e.target.value = ''
        }}
      />
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          const files = [...(e.dataTransfer.files ?? [])].filter((f) => f.type.startsWith('image/'))
          files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
          if (files.length) onFiles(files)
        }}
        className="flex w-full max-w-[360px] flex-col items-center gap-[12px] rounded-xl border-2 border-dashed border-white/20 p-[24px]"
      >
        <Icon name="download" size={28} className="rotate-180 text-white/40" />
        <div className="text-[13px] text-white/70">
          {busy ? 'Preparing…' : 'Drop photos, or browse'}
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          className="h-[48px] rounded-full bg-cyan-400 px-[22px] text-[13px] font-bold text-cyan-950 hover:bg-cyan-300 disabled:opacity-50"
        >
          Browse photos
        </button>
        <div className="text-[11px] leading-[15px] text-white/40">
          Pick as many as you like — they queue up and the next one opens the
          moment you save the one before it.
        </div>
      </div>
      {queued > 0 && (
        <div className="text-[12px] text-white/60">
          <b className="text-white/80">{queued}</b> still queued from the last selection
        </div>
      )}
      {error && <div className="text-[12px] text-red-300">{error}</div>}
    </div>
  )
}
