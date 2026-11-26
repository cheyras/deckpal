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
import { commitIdempotencyKey } from '../../lib/commitKey'
import { foldCommitLines } from './feed'
import type { FeedEntry } from './types'

export interface CommitResult {
  applied: number
  /** Rows that could not commit: no confident cardId (never corrected via
   *  "wrong card?"), or a variant lookup that failed. Named, never silently
   *  dropped — the other rows in the batch still belong to the reader. */
  unresolved: { id: string; name: string }[]
}

/**
 * ONE WRITE, fixed before it is sent: the folded lines, the rows they came
 * from, and the attempt id its key is made of (lib/commitKey.ts).
 *
 * WHY IT IS KEPT, not rebuilt from the list on a retry (review of PR #396):
 * if the answer to a write is lost after the server committed it and the reader
 * edits the list before pressing Add again, a write rebuilt from the edited list
 * hashes to a new key and the first batch is applied twice. So a write whose
 * outcome is unknown is re-sent EXACTLY as it was, same lines, same key, until
 * a definite answer comes back — and only its own rows leave the list.
 */
export interface PlannedCommit {
  attempt: string
  items: { variantId: number; delta: number }[]
  /** The rows the lines were made from. */
  rowIds: string[]
  unresolved: { id: string; name: string }[]
}

/** Send a planned write. Safe to call again with the same plan after an
 *  ambiguous failure: the same key makes the server replay it, never re-apply. */
export async function writeCommit(plan: PlannedCommit): Promise<CommitResult> {
  if (!plan.items.length) return { applied: 0, unresolved: plan.unresolved }
  const res = await api.collectionBatch(plan.items, {
    source: 'deckpal-web',
    note: 'Card scan',
    // ONE KEY PER ATTEMPT (lib/commitKey.ts says why the content alone was
    // wrong): a re-send of this plan replays it, a fresh press of Add on the
    // same contents is a fresh write.
    idempotencyKey: commitIdempotencyKey('scan', plan.attempt, plan.items),
  })
  return { applied: res.applied, unresolved: plan.unresolved }
}

/**
 * Resolve every row to a printing and fold the lines (no write). `attempt`:
 * a fresh lib/commitKey.ts newCommitAttempt() per press of Add.
 */
export async function planCommit(entries: FeedEntry[], attempt: string): Promise<PlannedCommit> {
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
  const unresolvedIds = new Set(unresolved.map((u) => u.id))
  return { attempt, items, rowIds: entries.map((e) => e.id).filter((id) => !unresolvedIds.has(id)), unresolved }
}
