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
// THE GATE IN FRONT OF THIS WRITE LIVES IN `identity.ts` (`commitGate`).
//
// 2026-09-05 ruling: "batch commit reminds [about unresolved ones]". It is not
// here because this module imports the API client, and a rule about what the
// reader must be told before a write should be answerable by a test without one
// — the same reason `resolvedIdentity` moved out of `ocrNarrow.ts`. It is also
// genuinely a question about the STACK rather than about the write: the captures
// it protects are the ones that never reached this list.
//
// ── WHAT THE 2026-09-07 RULING LEFT FOR THIS FILE ───────────────────────────
//
// "Separate every scan into different inline items in the list." The list does;
// the collection has no such notion. Ten scans of one printing are ten rows and
// one line of the write, and folding them is `feed.foldCommitLines` — pure,
// tested, and applied here AFTER every row has been resolved to a variant id,
// because two rows of one card can be two different printings and there is
// nothing to fold about those.
import { api } from '../../lib/api'
import { foldCommitLines } from './feed'
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

  const lines: { variantId: number; delta: number }[] = []

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
    lines.push({ variantId, delta: entry.quantity })
  }

  // ONE LINE PER PRINTING. The API's own `foldItems` would do this on arrival,
  // so this is not what makes the write correct — it is what keeps a long
  // session inside `BATCH_MAX_ITEMS` (250) now that a row is a scan rather than
  // a card, and what makes the idempotency key below describe the same shape the
  // server fingerprints.
  const items = foldCommitLines(lines)

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
