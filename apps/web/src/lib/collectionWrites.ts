import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { api, type CardDetailResponse, type CollectionMutationResponse, type SetDetailResponse } from './api'
import { applyAnswer, laneFor, save, useLane } from './writes'

/**
 * Owned-quantity writes, shared by every counter that edits them: the set
 * grid's count boxes (CardTile), the table rows (TableView) and the card sheet's
 * steppers (CardDetail). One implementation, so the three can never disagree
 * about a card that two of them are showing at once (a sheet over its grid).
 *
 * ── HOW A TAP TRAVELS ────────────────────────────────────────────────────────
 *
 * Each tap asks for an ABSOLUTE quantity (what the counter showed, plus or minus
 * one). Absolute is what makes a queued tap replaceable by the next one and a
 * Retry safe to press twice; the increment endpoint is neither, which is why it
 * is no longer used from the browser.
 *
 * Writes queue on one lane PER SET, because every answer carries the set's
 * recomputed progress: two answers applied out of order would leave the bars
 * describing an older collection. Each answer's quantities and progress go
 * straight into the cached card and set responses — the server returns exactly
 * those (apps/api/src/routes/collection.ts: "so the client can reconcile both
 * the stepper and the tile without a refetch"). That replaced invalidating the
 * whole set after every tap, which re-downloaded ~250 cards (0.8–6.5 s in
 * production) and dimmed the grid while it did (UXC-02).
 *
 * What the answer can NOT supply is a set view's have/need/dupe flags: those
 * are goal-specific (Master counts required printings, Grandmaster every
 * printing, and a variant filter narrows both), and the answer only knows the
 * Complete goal. So the set is re-read ONCE, a moment after the taps stop.
 */
const laneKey = (setId: string) => `collection:${setId}`
const itemKey = (variantId: number) => `variant:${variantId}`

/** Quiet time after the last write before a set's ownership flags are re-read. */
export const RECONCILE_AFTER_MS = 2_000

export interface OwnedVariant {
  setId: string
  /** The id the caller caches this card under, plus its name for the copy. */
  card: { cardId: string; name: string }
  variant: { variantId: number; displayName: string }
}

export function useOwnedCounts(setId: string) {
  const qc = useQueryClient()
  const lane = useLane(laneKey(setId))
  return {
    /** What a counter shows: the quantity asked for while it is being saved, else the server's. */
    shown: (variantId: number, confirmed: number | undefined): number =>
      lane.intent<number>(itemKey(variantId)) ?? confirmed ?? 0,
    set: (target: OwnedVariant, quantity: number): void => setOwned(qc, target, quantity),
  }
}

function setOwned(qc: QueryClient, t: OwnedVariant, quantity: number): void {
  const target = Math.max(0, quantity)
  void save(laneKey(t.setId), {
    item: itemKey(t.variant.variantId),
    intent: target,
    send: (signal) => api.setVariantQuantity(t.variant.variantId, target, signal),
    onSaved: (res) => applyOwned(qc, res, t.card.cardId),
    failure: `Couldn't change ${t.card.name} (${t.variant.displayName}) to ${target} in your collection.`,
    retry: () => setOwned(qc, t, target),
  }).then((outcome) => {
    if (outcome.status === 'superseded' || outcome.status === 'cancelled') return
    // A failed write may still have landed (a lost answer), and the card's own
    // cache — which the table row and the card sheet count from — never heard.
    if (outcome.status === 'failed') void qc.invalidateQueries({ queryKey: ['card', t.card.cardId] })
    reconcileSoon(qc, t.setId)
  })
}

/** Fold one collection write's answer into every cached view of that card. */
function applyOwned(qc: QueryClient, res: CollectionMutationResponse, callerCardId: string): Promise<void> {
  const qty = new Map(res.card.variants.map((v) => [v.variantId, v.quantity]))
  const withQty = <V extends { variantId: number; quantity?: number }>(v: V): V =>
    qty.has(v.variantId) ? { ...v, quantity: qty.get(v.variantId) } : v
  const cardKeys = [...new Set([res.card.cardId, callerCardId])].map((cardId) => ['card', cardId])

  return applyAnswer(qc, [...cardKeys, ['set', res.setId]], () => {
    for (const key of cardKeys) {
      qc.setQueryData<CardDetailResponse>(key, (old) => old && { ...old, variants: old.variants.map(withQty) })
    }
    qc.setQueriesData<SetDetailResponse>({ queryKey: ['set', res.setId] }, (old) =>
      old && {
        ...old,
        progress: res.progress,
        cards: old.cards.map((c) =>
          c.cardId === res.card.cardId ? { ...c, standardVariants: c.standardVariants?.map(withQty) } : c,
        ),
      },
    )
  })
}

// One pending re-read per set, pushed back by every write, so logging a pack
// costs one set download at the end rather than one per tap. It also waits for
// the lane to be idle, rather than spend a download on numbers about to change.
const reconciles = new Map<string, number>()
function reconcileSoon(qc: QueryClient, setId: string): void {
  window.clearTimeout(reconciles.get(setId))
  reconciles.set(
    setId,
    window.setTimeout(() => {
      reconciles.delete(setId)
      if (laneFor(laneKey(setId)).busy()) return reconcileSoon(qc, setId)
      void qc.invalidateQueries({ queryKey: ['set', setId] })
    }, RECONCILE_AFTER_MS),
  )
}
