import {
  EMBED_DIM,
  EMBED_MODEL_ID,
  cosineSimilarity,
  embedStamp,
  identityConfidence,
  toPgVector,
  variantConfidence,
  type IdentityConfidence,
  type VariantConfidence,
} from '@deckpal/matching'
import { cardImages, q, type CardImages } from '../db.js'

/**
 * The embedding matcher: a vector in, a nearest-neighbour ranking and TWO
 * confidences out.
 *
 * ── WHERE THE VECTOR COMES FROM ──────────────────────────────────────────────
 *
 * The SERVER computes it, from the crop the client uploads — owner ruling,
 * 2026-09-05: "it's ok if we run that server-side". `queryEmbed.ts` runs the
 * model; this module only searches with what that produced, and the `k` it is
 * given is the only thing it knows about the request.
 *
 * An earlier draft had this route accept a 768-float array from an on-device
 * model. That is why the `NeighbourSource` seam below exists, and it is worth
 * keeping now that it is no longer load-bearing for the wire: everything
 * interesting in this file is arithmetic and a ruling, and neither needs a
 * photograph or a database to be tested.
 *
 * The privacy shape the flywheel ruling asks for survives the move. What is
 * STORED is still an embedding and never a photograph (migration 052); the crop
 * is held for the length of one request and written nowhere.
 *
 * ── THE RESPONSE HAS NO `matched` AND NO `confidence` ────────────────────────
 *
 * `POST /api/scan` reports `matched: boolean` and a per-match `confidence`
 * derived from hash distance. On 19 correctly-cropped photographs that flag
 * fired four times and was wrong all four (p2-work/phash-on-crops/RESULTS.md).
 * The ruling's answer is not a better single number, it is two numbers that
 * cannot be confused: identity and variant, "never blended".
 *
 * So this route returns an `identity` block and a `variant` block and nothing
 * that could be mistaken for their average. A client that wants "is this
 * settled" must read `identity.level === 'confident' &&
 * !variant.requiresUserChoice`, which is two decisions because there are two.
 *
 * ── ONE QUERY, LIKE THE HASH PATH ────────────────────────────────────────────
 *
 * Contract B2: a scan costs the connection budget one query. The KNN, the card
 * hydration and the legal-variant count go in one statement, for the same
 * reason `rankMatches` does it: on serverless there is no boot to amortise a
 * second round trip against.
 */

/** What the KNN returns, before it becomes an answer. */
export interface NeighbourRow {
  cardId: string
  name: string
  number: string
  setId: string
  setName: string
  /** The series' tcgdex id — an input to the image path, not a display field. */
  seriesId: string
  rarity: string | null
  /** Cosine similarity in [-1, 1]. Postgres gives cosine DISTANCE; the SQL
   *  converts once, so nothing downstream has to remember which way round it
   *  is. */
  similarity: number
  /** How many legal printings this card has, which is what decides whether the
   *  reader MUST be asked. Counted in the same query. */
  variantCount: number
}

/**
 * The seam. Production passes `pgNeighbours`; the unit tests pass an in-memory
 * ranker over injected vectors, which is what lets the confidence behaviour be
 * tested without a database — the behaviour being tested is arithmetic and a
 * ruling, neither of which needs Postgres to be wrong.
 */
export type NeighbourSource = (
  embedding: Float32Array,
  stamp: string,
  k: number,
) => Promise<{ indexSize: number; rows: NeighbourRow[] }>

interface RawRow {
  index_size: string
  similarity: number | null
  tcgdex_id: string | null
  name: string | null
  local_id: string | null
  rarity: string | null
  set_tcgdex_id: string | null
  set_name: string | null
  series_tcgdex_id: string | null
  variant_count: string | null
}

export const pgNeighbours: NeighbourSource = async (embedding, stamp, k) => {
  // `<=>` is cosine distance under `vector_cosine_ops`, so 1 - it is the
  // similarity every threshold in packages/matching is expressed in. The ORDER
  // BY is on the operator itself, not on the derived column, because only the
  // operator form can use the HNSW index (051).
  //
  // The LEFT JOINs and the `sz` row exist for the reason they do in
  // `rankMatches`: an unembedded catalogue must come back as "index is empty"
  // rather than as an empty result set that looks like "no card matched".
  //
  // 🔴 THE STAMP IS A PARAMETER AND THE INDEX IS PARTIAL ON A LITERAL, which
  // only works because of how this query is sent. 051's HNSW index carries
  // `WHERE stamp = 'e1:…' AND quality = 'low'`, and the planner can only use a
  // partial index when it can PROVE the query's predicate implies the index's —
  // which `stamp = $2` does not, unless the planner knows what `$2` is. It does
  // here: node-pg's `query(text, values)` uses an UNNAMED prepared statement,
  // and PostgreSQL plans those with the supplied values every time (custom
  // plan). Generic plans, which would lose this, are only reached by a NAMED
  // prepared statement after five executions. So: do not "optimise" this into
  // a named/prepared statement without re-checking `EXPLAIN` — the symptom
  // would be a silent fall back to a sequential scan over every vector, not an
  // error.
  const sql = `
    WITH sz AS (
      SELECT count(*)::text AS n FROM card_embedding WHERE stamp = $2 AND quality = 'low'
    ),
    ranked AS (
      SELECT ce.card_id, 1 - (ce.embedding <=> $1::vector) AS similarity
        FROM card_embedding ce
       WHERE ce.stamp = $2 AND ce.quality = 'low'
       ORDER BY ce.embedding <=> $1::vector
       LIMIT $3
    )
    SELECT sz.n AS index_size, r.similarity, c.tcgdex_id, c.name, c.local_id, c.rarity,
           cs.tcgdex_id AS set_tcgdex_id, cs.name AS set_name,
           ser.tcgdex_id AS series_tcgdex_id,
           (SELECT count(*)::text FROM card_variant cv WHERE cv.card_id = c.id) AS variant_count
      FROM sz
      LEFT JOIN ranked r    ON true
      LEFT JOIN card c      ON c.id = r.card_id
      LEFT JOIN card_set cs ON cs.id = c.set_id
      LEFT JOIN series ser  ON ser.id = cs.series_id
     ORDER BY r.similarity DESC`

  const rows = await vectorQuery(sql, [toPgVector(embedding), stamp, k])
  const indexSize = Number(rows[0]?.index_size ?? 0)
  return {
    indexSize,
    rows: rows
      .filter((r): r is RawRow & { similarity: number; tcgdex_id: string } =>
        r.similarity !== null && r.tcgdex_id !== null,
      )
      .map((r) => ({
        cardId: r.tcgdex_id,
        name: r.name ?? '',
        number: r.local_id ?? '',
        setId: r.set_tcgdex_id ?? '',
        setName: r.set_name ?? '',
        seriesId: r.series_tcgdex_id ?? '',
        rarity: r.rarity,
        similarity: r.similarity,
        // A card with no catalogued variants still has exactly one printing —
        // the one in front of the reader. Zero would make `requiresUserChoice`
        // false for the wrong reason, so the floor is 1 and the comment says why.
        variantCount: Math.max(1, Number(r.variant_count ?? 1)),
      })),
  }
}

/**
 * The KNN, with the one failure mode that is not a fault.
 *
 * 🔴 SAME SHAPE AS RUNG 9's `textQuery`, AND THE SAME REASON. `card_embedding`
 * and the `vector` extension it needs arrive in migration 051, and a deployment
 * will spend a window with the flag on and the migration not yet applied — the
 * operator sequence is migrate, embed, flag, and people do things out of order.
 * A missing table (42P01), a missing column (42703) or a missing type (42704 —
 * which is what `$1::vector` raises when pgvector is not installed) therefore
 * mean "this rung is not available on this deployment yet", and the honest
 * answer is an empty index rather than a 500 on a scan.
 *
 * `resolve.ts` reads an empty candidate list as "the vector said nothing", which
 * is byte-for-byte the pre-vector ladder — so the degradation is not merely
 * survivable, it is the exact behaviour the flag being off produces.
 *
 * Nothing else is swallowed. A connection failure, a timeout, a syntax error or
 * a dimension mismatch is a real fault and still throws.
 */
async function vectorQuery(sql: string, params: unknown[]): Promise<RawRow[]> {
  try {
    return await q<RawRow>(sql, params)
  } catch (err) {
    const code = (err as { code?: string }).code
    if (code === '42P01' || code === '42703' || code === '42704') {
      warnEmbedUnavailable(code)
      return []
    }
    throw err
  }
}

/** Once per process. A per-request warning for a known, expected state is
 *  noise, and noise is how the line that matters gets skimmed. */
let warnedEmbedUnavailable = false
function warnEmbedUnavailable(code: string): void {
  if (warnedEmbedUnavailable) return
  warnedEmbedUnavailable = true
  console.warn(
    `[scan] card_embedding is not available (SQLSTATE ${code}) — the vector rung is skipped and the ` +
      'ladder behaves as it did before it existed. Apply migration 051 (which needs pgvector; see ' +
      'DEPLOYMENT.md) and run tools/embed-catalog.',
  )
}

export interface ScanEmbedMatch extends NeighbourRow {
  images: CardImages
}

export interface ScanEmbedResponse {
  /** Which vector space answered. A client comparing results across a model
   *  change needs this and nothing else to know they are not comparable. */
  stamp: string
  indexSize: number
  identity: IdentityConfidence
  variant: VariantConfidence
  matches: ScanEmbedMatch[]
}

/**
 * Turn a ranking into the two-confidence answer.
 *
 * Pure, and separated from the SQL on purpose: everything interesting here is a
 * decision about what the system is entitled to claim, and a decision like that
 * should be testable without a database.
 */
export function buildResponse(
  stamp: string,
  indexSize: number,
  rows: readonly NeighbourRow[],
): ScanEmbedResponse {
  const identity = identityConfidence(
    rows.map((r) => ({ cardId: r.cardId, similarity: r.similarity })),
    EMBED_MODEL_ID,
  )
  // The variant question is asked about the card the identity block names, not
  // about the top row — those differ when identity declined, and asking "which
  // printing" about a card the system will not commit to would be nonsense.
  const named = identity.cardId ? rows.find((r) => r.cardId === identity.cardId) : undefined
  const variant = variantConfidence(named?.variantCount ?? 1)
  return {
    stamp,
    indexSize,
    identity,
    variant,
    matches: rows.map((r) => ({ ...r, images: cardImages(r.seriesId, r.setId, r.number) })),
  }
}

/**
 * A vector this module is about to search with, checked before it can reach
 * Postgres — where the error would name neither the field nor the expected
 * size.
 *
 * It reads as a body validator and is not one any more: the vector is produced
 * INSIDE this process by `queryEmbed.ts`, so every failure it can now report is
 * a bug here rather than a bad request. It is kept, and called, for the reason
 * an assertion is kept after the input it guarded stopped being hostile — a
 * wrong-width or un-normalised vector reaching pgvector produces a plausible
 * ranking of the wrong thing, and there is no later point at which anybody
 * would notice.
 *
 * Refuses rather than repairs. A vector that arrives un-normalised came from
 * something not following the spec, and re-normalising it here would let that
 * something ship.
 */
export function assertQueryVector(v: Float32Array): Float32Array {
  if (v.length !== EMBED_DIM) {
    throw new TypeError(`query embedding must have ${EMBED_DIM} components, got ${v.length}`)
  }
  for (let i = 0; i < EMBED_DIM; i++) {
    const x = v[i]
    if (typeof x !== 'number' || !Number.isFinite(x)) {
      throw new TypeError(`query embedding[${i}] is not a finite number`)
    }
  }
  const norm = Math.sqrt(cosineSimilarity(v, v))
  if (Math.abs(norm - 1) > 1e-3) {
    throw new TypeError(
      `query embedding must be L2-normalised (norm was ${norm.toFixed(4)}); packages/matching l2Normalize does this`,
    )
  }
  return v
}

/** The stamp this build searches under. Every stored vector carries one and the
 *  matcher filters on it, so a vector from another pipeline is invisible rather
 *  than silently wrong. It is reported in the response for the same reason:
 *  results from two stamps are not comparable and a client must be able to see
 *  that without being told. */
export const CURRENT_STAMP = embedStamp(EMBED_MODEL_ID)
