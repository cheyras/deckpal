/* ─────────────────────────────────────────────────────────────────────────────
 * Profile photo — the shared read hook, the disc, and the edit actions.
 *
 * One react-query key (`['avatar']`) is the whole synchronisation story: the
 * header chip, the profile page and the insights trainer card all read it, and
 * a successful upload writes the new value straight into the cache, so all
 * three repaint together without a refetch.
 *
 * The stored object's key is random and changes on every replace, so the URL is
 * a new one each time and the browser can never show a stale photo from cache —
 * no `?v=` busting, and the CDN still gets to serve the object as immutable.
 *
 * Self-host has no object store. The API says `enabled: false` and every
 * control here renders nothing, rather than offering a button that fails.
 * ───────────────────────────────────────────────────────────────────────────── */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type AvatarState } from '../lib/api'
import { Icon } from './Icon'

const AVATAR_KEY = ['avatar'] as const

/** Formats the server accepts. Mirrored here only to populate the file picker. */
const ACCEPT = 'image/jpeg,image/png,image/webp'

/** Fallback when the server has not told us its limit yet (it always does). */
const DEFAULT_MAX_BYTES = 3 * 1024 * 1024

function mb(bytes: number): string {
  const v = bytes / (1024 * 1024)
  return `${Math.round(v * 10) / 10} MB`
}

/**
 * The current user's photo.
 *
 * `staleTime` is long because it only changes when this very tab changes it,
 * and the mutation below updates the cache directly. Failures are swallowed
 * into `undefined` by react-query and every consumer falls back to the default
 * glyph, so a flaky avatar endpoint can never break the header.
 */
export function useAvatar() {
  return useQuery({
    queryKey: AVATAR_KEY,
    queryFn: ({ signal }) => api.avatar(signal),
    staleTime: 5 * 60_000,
    retry: false,
  })
}

/**
 * The photo itself, or the default glyph.
 *
 * `object-cover` matters even though the server stores a square: an <img> with
 * a 1:1 source in a 1:1 box still letterboxes if either rounds to an odd pixel.
 */
export function AvatarDisc({
  url,
  iconSize,
  alt = '',
  dimmed = false,
  fallbackClass = 'text-icon-muted',
}: {
  url: string | null | undefined
  iconSize: number
  alt?: string
  dimmed?: boolean
  /**
   * Colour of the default glyph. The BACKGROUND is deliberately not set here —
   * every host (the level ring's disc, the header chip) already paints its own,
   * and a second one would silently override it.
   */
  fallbackClass?: string
}) {
  const [broken, setBroken] = useState(false)
  // A replaced photo is a different URL; forget a previous load failure.
  useEffect(() => setBroken(false), [url])

  if (!url || broken) {
    return (
      <div className={`flex h-full w-full items-center justify-center ${fallbackClass}`}>
        <Icon name="user" size={iconSize} />
      </div>
    )
  }
  return (
    <img
      src={url}
      alt={alt}
      onError={() => setBroken(true)}
      className={`h-full w-full object-cover transition-opacity ${dimmed ? 'opacity-40' : 'opacity-100'}`}
    />
  )
}

export interface AvatarEditor {
  /** Server truth, or the local preview while an upload is in flight. */
  displayUrl: string | null
  /** Is the feature available at all (false on self-host)? */
  enabled: boolean
  /** Is a photo currently set? False while the first upload is still running. */
  hasPhoto: boolean
  busy: 'upload' | 'remove' | null
  error: string | null
  /** Open the file picker. */
  choose: () => void
  remove: () => void
  /** Render this once, anywhere — it is the (visually hidden) file input. */
  input: React.ReactElement
  maxBytes: number
}

/**
 * Everything needed to change the photo, as one object.
 *
 * Returned as a bundle rather than rendered as a component because the pieces
 * belong in different places on the profile page — the picker trigger sits on
 * the avatar, the remove action and the error message sit in the meta row —
 * and they all have to share one piece of state.
 */
export function useAvatarEditor(): AvatarEditor {
  const qc = useQueryClient()
  const { data } = useAvatar()
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<'upload' | 'remove' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<string | null>(null)

  // Object URLs are a leak if you never hand them back.
  useEffect(() => {
    if (!preview) return
    return () => URL.revokeObjectURL(preview)
  }, [preview])

  const maxBytes = data?.maxBytes ?? DEFAULT_MAX_BYTES

  const onFile = useCallback(
    async (file: File | null) => {
      if (!file) return
      setError(null)

      // Cheap local checks so the obvious mistakes never cost a round trip.
      // Deliberately NOT the security boundary: `file.type` is the browser's
      // guess from the extension, which is exactly what a renamed file lies
      // about. The server sniffs the magic bytes and is the real gate.
      if (file.size === 0) {
        setError('That file is empty.')
        return
      }
      if (file.size > maxBytes) {
        setError(`That image is larger than ${mb(maxBytes)}. Try a smaller photo, or crop it first.`)
        return
      }

      const localUrl = URL.createObjectURL(file)
      setPreview(localUrl)
      setBusy('upload')
      try {
        const next = await api.uploadAvatar(file)
        qc.setQueryData<AvatarState>(AVATAR_KEY, (prev) => ({ ...(prev ?? { enabled: true }), ...next }))
      } catch (err) {
        const msg = (err as Error).message
        setError(
          // A network failure surfaces as a TypeError from fetch with a browser-
          // specific message ("Failed to fetch", "Load failed", "NetworkError…").
          // None of those are worth showing; everything else is the API's own
          // sentence, written to be read.
          /failed to fetch|load failed|networkerror|network request failed/i.test(msg)
            ? 'Upload failed — check your connection and try again.'
            : msg || 'Upload failed. Please try again.',
        )
        setPreview(null)
      } finally {
        setBusy(null)
        // Let the same file be picked again after a failure (change wouldn't fire).
        if (inputRef.current) inputRef.current.value = ''
      }
    },
    [maxBytes, qc],
  )

  const remove = useCallback(async () => {
    setError(null)
    setBusy('remove')
    try {
      const next = await api.removeAvatar()
      setPreview(null)
      qc.setQueryData<AvatarState>(AVATAR_KEY, (prev) => ({ ...(prev ?? { enabled: true }), ...next }))
    } catch (err) {
      setError((err as Error).message || 'Could not remove your photo. Please try again.')
    } finally {
      setBusy(null)
    }
  }, [qc])

  const input = (
    <input
      ref={inputRef}
      type="file"
      accept={ACCEPT}
      className="hidden"
      onChange={(e) => void onFile(e.target.files?.[0] ?? null)}
    />
  )

  return {
    // While uploading, the local file is the honest thing to show: it is what
    // the user just picked. It is dropped the moment the server answers, so the
    // pixels on screen end up being the ones that were actually stored.
    displayUrl: busy === 'upload' && preview ? preview : (data?.avatarUrl ?? null),
    enabled: data?.enabled ?? false,
    hasPhoto: !!data?.avatarUrl,
    busy,
    error,
    choose: () => inputRef.current?.click(),
    remove: () => void remove(),
    input,
    maxBytes,
  }
}

/**
 * The spinner shown over the disc while an upload runs. Same construction as
 * the app's other inline spinners (ui.tsx, authUi.tsx) so it reads as one
 * family: a 2px ring in the accent colour with a transparent top arc.
 */
export function AvatarSpinner({ size = 22 }: { size?: number }) {
  return (
    <span
      className="block animate-spin rounded-full border-2 border-action-primary border-t-transparent"
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  )
}
