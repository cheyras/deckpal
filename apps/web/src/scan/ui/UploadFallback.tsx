// Camera-unavailable fallback — desktop, or a non-secure http:// origin where
// getUserMedia is blocked. Feeds the SAME verify feed as the live camera (one
// scan mode, PLAN.md D4): a picked/dropped image goes straight through
// identify and lands in the feed exactly like a capture would, just without
// a stack to fly through (there is no live card presence to animate from).
import { useRef, useState } from 'react'
import { Icon } from '../../components/Icon'
import { Spinner } from '../../components/ui'

export function UploadFallback({
  unavailableReason,
  onFile,
}: {
  /** Why there is no live camera — shown as a one-line explanation, never a dead end. */
  unavailableReason: string
  onFile: (file: File) => Promise<void>
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const runFile = async (file: File) => {
    setError(null)
    setBusy(true)
    const url = URL.createObjectURL(file)
    setPreview(url)
    try {
      await onFile(file)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'that image could not be scanned')
    } finally {
      setBusy(false)
      URL.revokeObjectURL(url)
      setPreview(null)
    }
  }

  return (
    <div className="rounded-2xl border border-border-default bg-surface-secondary p-[16px]">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void runFile(file)
          e.target.value = ''
        }}
      />
      <div className="mb-[10px] flex items-start gap-[8px] text-[13px] text-text-muted">
        <Icon name="camera" size={16} className="mt-[2px] shrink-0" />
        <span>{unavailableReason} Upload a photo instead — matching works the same way.</span>
      </div>
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          const file = e.dataTransfer.files?.[0]
          if (file) void runFile(file)
        }}
        className="flex min-h-[160px] flex-col items-center justify-center gap-[10px] rounded-xl border-2 border-dashed border-action-ghost-border p-[16px] text-center hover:border-border-focus"
      >
        {busy ? (
          <>
            {preview && <img src={preview} alt="" className="max-h-[140px] rounded-lg object-contain opacity-70" />}
            <Spinner inline size={22} className="text-action-primary" />
            <span className="text-[13px] text-text-muted">Scanning…</span>
          </>
        ) : (
          <>
            <Icon name="camera" size={30} className="text-icon-muted" />
            <div className="text-[14px] font-semibold text-text-primary">Drop a card photo here</div>
            <div className="text-[11px] text-text-muted">JPEG, PNG or WebP · a clear, straight-on shot works best</div>
          </>
        )}
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="rounded-full bg-surface-tertiary px-[14px] py-[7px] text-[13px] font-bold text-text-primary hover:bg-action-default-hover disabled:opacity-60"
        >
          Browse images
        </button>
      </div>
      {error && (
        <div className="mt-[10px] flex items-center gap-[8px] rounded-lg border border-border-default bg-surface-primary p-[10px] text-[13px] text-error">
          <Icon name="alert" size={16} /> {error}
        </div>
      )}
    </div>
  )
}
