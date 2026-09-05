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
 * ── WHAT THE CLIENT SENDS, AND WHY IT IS NOT AN IMAGE ────────────────────────
 *
 * The model runs on the phone (owner ruling, 2026-09-04: identity is an
 * on-device embedding). So this endpoint receives a 768-float vector, not a
 * JPEG — which is also the privacy shape the flywheel ruling asks for: the
 * server never has to hold the photograph in order to answer.
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
  // operator form can use the HNSW index (048).
  //
  // The LEFT JOINs and the `sz` row exist for the reason they do in
  // `rankMatches`: an unembedded catalogue must come back as "index is empty"
  // rather than as an empty result set that looks like "no card matched".
  //
  // 🔴 THE STAMP IS A PARAMETER AND THE INDEX IS PARTIAL ON A LITERAL, which
  // only works because of how this query is sent. 048's HNSW index carries
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

  const rows = await q<RawRow>(sql, [toPgVector(embedding), stamp, k])
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

/** The request body's vector, validated. Rejects at the edge rather than
 *  letting a wrong-width array reach Postgres, where the error names neither
 *  the field nor the expected size. */
export function parseEmbedding(value: unknown): Float32Array {
  if (!Array.isArray(value)) {
    throw new TypeError('embedding must be an array of numbers')
  }
  if (value.length !== EMBED_DIM) {
    throw new TypeError(`embedding must have ${EMBED_DIM} components, got ${value.length}`)
  }
  const v = new Float32Array(EMBED_DIM)
  for (let i = 0; i < EMBED_DIM; i++) {
    const x = value[i]
    if (typeof x !== 'number' || !Number.isFinite(x)) {
      throw new TypeError(`embedding[${i}] is not a finite number`)
    }
    v[i] = x
  }
  // The client is supposed to have L2-normalised. Check rather than re-normalise:
  // a vector that arrives with the wrong length was produced by something that
  // is not following the spec, and silently fixing it here would let that ship.
  const norm = Math.sqrt(cosineSimilarity(v, v))
  if (Math.abs(norm - 1) > 1e-3) {
    throw new TypeError(
      `embedding must be L2-normalised (norm was ${norm.toFixed(4)}); packages/matching l2Normalize does this`,
    )
  }
  return v
}

/** The stamp this build will accept. A client on an older bundle carrying an
 *  older stamp must be told so, not silently compared against vectors from a
 *  different model. */
export const CURRENT_STAMP = embedStamp(EMBED_MODEL_ID)
