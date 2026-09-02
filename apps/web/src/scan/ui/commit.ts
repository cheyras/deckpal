/**
 * Committing the verify feed to the collection.
 *
 * This is the scanner's own copy of `character/host/ripCommit.ts`'s write
 * path — same two-step shape (resolve every row to a variant id, THEN write
 * them all in one request) and the same idempotency scheme, ported rather
 * than imported because `ripCommit.ts` stays exactly where it is: it is
 * shared with Deck-E's chat/approval flow (`character/host/DeckeHost.tsx`,
 * `chat/approvalCardState.ts`), not scanner-only, so moving or repurposing it
 * would break a feature this task does not own. Only the input type changes
 * (`FeedEntry`, not `RipEntry`) and the label drops "rip" — PLAN.md P4 calls
 * for that everywhere eventually ("strings no longer say 'rip'"); it is just
 * true here from the start instead of migrated later.
 *
 * See ripCommit.ts's own header for WHY resolution happens first and WHY the
 * write is one batched request rather than one call per row — both reasons
 * apply unchanged to a scan session.
 */
import { api } from '../../lib/api'
import type { FeedEntry } from './types'

export interface CommitResult {
  applied: number
  /** Rows that could not commit: no confident cardId (never corrected via
   *  "wrong card?"), or a variant lookup that failed. Named, never silently
   *  dropped — the other rows in the batch still belong to the reader. */
  unresolved: { id: string; name: string }[]
}

export async function commitFeed(entries: FeedEntry[]): Promise<CommitResult> {
  const unresolved: { id: string; name: string }[] = []
  const commitable = entries.filter((e): e is FeedEntry & { cardId: string } => {
    if (e.cardId !== null) return true
    unresolved.push({ id: e.id, name: e.name || 'Unidentified card' })
    return false
  })

  const items: { variantId: number; delta: number }[] = []

  // THE READER'S CHOICE WINS, and costs no request — `variantId` is set the
  // moment the catalog answers (see Scan.tsx's `loadVariants`), or changed
  // from there via the variant select. This is a lookup only for rows whose
  // fetch failed or had not landed by commit time.
  const looked = await Promise.all(
    commitable.map(async (e) => {
      if (e.variantId != null) return { entry: e, variantId: e.variantId }
      try {
        const card = await api.card(e.cardId)
        const primary = card.variants.find((v) => v.isPrimary) ?? card.variants[0]
        return { entry: e, variantId: primary?.variantId ?? null }
      } catch {
        return { entry: e, variantId: null }
      }
    }),
  )

  for (const { entry, variantId } of looked) {
    if (variantId === null) {
      unresolved.push({ id: entry.id, name: entry.name })
      continue
    }
    items.push({ variantId, delta: entry.quantity })
  }

  if (!items.length) return { applied: 0, unresolved }

  const res = await api.collectionBatch(items, {
    source: 'deckpal-web',
    note: 'Card scan',
    // Keyed on the RESOLVED items (variant × delta), same as ripCommit.ts:
    // idempotent across a retry of a half-succeeded batch, and a correction
    // made after a first commit (a printing fixed via "wrong card?" and
    // committed again) is a genuinely different key, not swallowed as a dup.
    idempotencyKey: `scan-${items.map((i) => `${i.variantId}x${i.delta}`).sort().join(',')}`.slice(0, 200),
  })
  return { applied: res.applied, unresolved }
}
