// Upload mode — a picked photo is treated AS IF it were a camera stream of
// its own aspect: the same `decodeForCanvas` the product scanner's upload
// fallback uses (scan/ui/uploadNormalize.ts, reused, EXIF-orientation
// aware), then the SAME `buildWorkingFrame` draw path capture mode uses. By
// the time this calls `onCaptured`, nothing downstream can tell a camera
// frame from an upload.
import { useRef, useState } from 'react'
import { Icon } from '../../components/Icon'
import { decodeForCanvas } from '../ui/uploadNormalize'
import { buildWorkingFrame, type WorkingFrame } from './workingFrame'

export function UploadStage({ onCaptured }: { onCaptured: (frame: WorkingFrame) => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pick = async (file: File) => {
    setError(null)
    setBusy(true)
    try {
      const src = await decodeForCanvas(file)
      onCaptured(buildWorkingFrame(src, src.width, src.height))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'that image could not be read')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-[14px] bg-neutral-950 p-[24px] text-center">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void pick(file)
          e.target.value = ''
        }}
      />
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          const file = e.dataTransfer.files?.[0]
          if (file) void pick(file)
        }}
        className="flex w-full max-w-[360px] flex-col items-center gap-[10px] rounded-xl border-2 border-dashed border-white/20 p-[28px]"
      >
        <Icon name="download" size={28} className="rotate-180 text-white/40" />
        <div className="text-[13px] text-white/70">{busy ? 'Preparing…' : 'Drop a photo, or browse'}</div>
        <button
          type="button"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          className="rounded-full bg-white/10 px-[14px] py-[7px] text-[12px] font-bold text-white hover:bg-white/20 disabled:opacity-50"
        >
          Browse
        </button>
      </div>
      {error && <div className="text-[12px] text-red-300">{error}</div>}
    </div>
  )
}
