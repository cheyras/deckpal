/**
 * Catalogue ids → real card art, for any chat surface that draws cards.
 *
 * ── WHY IT MOVED HERE ────────────────────────────────────────────────────────
 *
 * This lived inside `DeckeScreen.tsx` and was the reason the panel looked like
 * DeckPal and the approval card looked like a receipt. Deck-E's panels drew
 * actual Pokemon; the dialog that asks permission to CHANGE somebody's
 * collection drew "Heat Rotom ex · me05 #013" in 13px grey — on the same page,
 * ten pixels apart. The owner asked for chat widgets with *"actual card
 * thumbnails and things — making it feel good like the rest of the app"*, and
 * the ability to do it was one directory away behind a `function` keyword.
 *
 * ── THE SAFETY PROPERTY COMES WITH IT ────────────────────────────────────────
 *
 * `artForIds` is the character's one module that knows the catalog exists: it
 * calls `GET /cards/:id` and reads `images.low`/`images.high` off the RESPONSE.
 * A model-supplied string is only ever a path segment; the URLs that reach a
 * `src` are the app's own. That is what makes it safe to draw art for ids that
 * came out of a model's tool call, and it is unchanged by this file existing.
 *
 * `undefined` means "still asking" and `null` means "asked, and the catalogue
 * has no such card". They must stay distinguishable, or a slow network is
 * indistinguishable from an id nobody can resolve.
 *
 * ── NO ABORT SIGNAL, ON PURPOSE ──────────────────────────────────────────────
 *
 * `artForId` memoises the in-flight promise per id and shares it with everything
 * else in the character that wants that card — the stash flight, the four card
 * slots on his body. Cancelling on unmount would settle that SHARED promise as a
 * failure for whoever else was waiting on it, to save one request for a card
 * whose art is immutable and will be asked for again. A `live` flag to skip the
 * `setState` is the whole cleanup that is actually needed.
 *
 * The dependency is the JOINED id list rather than the array, because these
 * surfaces re-render on every chat tick and a fresh array literal each time
 * would re-fetch forever.
 */
import { useEffect, useState } from 'react'
import { artForIds } from '../../decke/cardSource'
import type { CardArt } from '../../decke/cardArt'

export type CardArtMap = Record<string, CardArt | null | undefined>

export function useCardArt(ids: string[]): CardArtMap {
  const [art, setArt] = useState<Record<string, CardArt | null>>({})
  const key = ids.join(',')
  useEffect(() => {
    if (!key) return
    const wanted = key.split(',')
    let live = true
    artForIds(wanted)
      .then((list) => {
        if (!live) return
        const next: Record<string, CardArt | null> = {}
        list.forEach((a, i) => {
          next[wanted[i]!] = a
        })
        setArt(next)
      })
      .catch(() => {
        // A surface that cannot draw art still draws the names. There is no
        // state of this app where a decorative texture is worth a console full
        // of red.
      })
    return () => {
      live = false
    }
  }, [key])
  return art
}
