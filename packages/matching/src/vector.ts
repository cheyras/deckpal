// pgvector on the wire, and the one arithmetic helper that goes with it.
//
// node-pg has no binary codec for pgvector's types, so a vector crosses the
// wire as TEXT in both directions: `'[0.1,-0.2,…]'` going in, the same shape
// coming back. That is not a workaround, it is pgvector's own documented input
// format — but it does mean the encoding is OUR responsibility, and an
// implementation that is casual about it fails in exactly two ways, both
// silent:
//
//   * `NaN` / `Infinity` reach the database as the literals `NaN` / `Infinity`,
//     which pgvector REJECTS at insert time with an error naming neither the row
//     nor the column. A bad embed (a zero-length image, a model that returned
//     nothing) then looks like a database problem hours later. `toPgVector`
//     refuses them here, where the stack trace still points at the embedder.
//
//   * Number#toString() emits JavaScript's shortest round-trip representation
//     for the float64 the component was widened to, which is up to 17
//     significant digits of noise the float32 never had
//     (0.30000001192092896 for what was stored as 0.3f). Correct, and it nearly
//     doubles the size of every INSERT.
//
//     9 digits is what is sent, and the 9 is not a taste call: round-tripping
//     an IEEE-754 binary32 through decimal and back requires 9 significant
//     digits and is guaranteed at 9 (C's FLT_DECIMAL_DIG). 7 — the count of
//     digits a float32 can *represent* — is enough to tell two float32s apart
//     and NOT enough to reconstruct one, which is a distinction this file
//     originally got wrong and `__tests__/vector.test.ts` caught: at 7 digits
//     0.08631158620119095f came back as 0.08631159365177155f. The test walks
//     2,000 random components and asserts exact equality, so the property is
//     executed rather than claimed.

/** Encode for a `vector(N)` parameter. Send this as an ordinary text param and
 *  let Postgres cast it: `$1::vector`. */
export function toPgVector(v: ArrayLike<number>): string {
  const parts = new Array<string>(v.length)
  for (let i = 0; i < v.length; i++) {
    const x = v[i] as number
    if (!Number.isFinite(x)) {
      throw new TypeError(
        `embedding component ${i} is ${x}; a non-finite value means the embed failed and must not be stored`,
      )
    }
    // Trailing-zero trim keeps `0` as `0` rather than `0.00000000`.
    parts[i] = Number(x.toPrecision(9)).toString()
  }
  return `[${parts.join(',')}]`
}

/** Decode a `vector(N)` that came back as text. */
export function fromPgVector(s: string): Float32Array {
  const body = s.trim()
  if (!body.startsWith('[') || !body.endsWith(']')) {
    throw new TypeError(`not a pgvector literal: ${body.slice(0, 32)}`)
  }
  const inner = body.slice(1, -1)
  if (inner.trim() === '') return new Float32Array(0)
  const parts = inner.split(',')
  const out = new Float32Array(parts.length)
  for (let i = 0; i < parts.length; i++) {
    const x = Number(parts[i])
    if (!Number.isFinite(x)) throw new TypeError(`pgvector component ${i} is not finite: ${parts[i]}`)
    out[i] = x
  }
  return out
}

/**
 * Cosine similarity of two vectors that are ALREADY unit length — which every
 * vector this system stores is, because `l2Normalize` runs before the write.
 *
 * It is a plain dot product for that reason, and it is deliberately NOT
 * defensive about the assumption: re-normalising here would hide a producer
 * that forgot to, and that producer's vectors are wrong in the database
 * whatever this function does with them. The `1 - (a <=> b)` the SQL path uses
 * must agree with this to the float; `__tests__/vector.test.ts` pins the
 * relationship on hand-computed cases.
 */
export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length) {
    throw new TypeError(`cannot compare embeddings of length ${a.length} and ${b.length}`)
  }
  let s = 0
  for (let i = 0; i < a.length; i++) s += (a[i] as number) * (b[i] as number)
  return s
}
