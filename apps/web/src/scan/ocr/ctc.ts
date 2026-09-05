// CTC DECODE — the recogniser's 6,625-way-per-timestep output to a string.
//
// PP-OCRv4's recogniser is a CRNN trained with connectionist temporal
// classification: for each of T horizontal timesteps it emits a distribution
// over the character set plus one BLANK, and the string is recovered by taking
// the argmax at every step, collapsing runs of the same index, and dropping the
// blank. That is the whole algorithm and it is twenty lines; what is easy to get
// wrong is the two index conventions, which is why they are written down here
// rather than left to be inferred from a `- 1`.

/**
 * The character set, in model-output order.
 *
 * TWO CONVENTIONS, BOTH LOAD-BEARING:
 *
 *  - **Index 0 is BLANK**, not a character. It is CTC's separator token and is
 *    never emitted. So class `k` for k ≥ 1 is `keys[k - 1]`, and an off-by-one
 *    here does not crash — it silently returns text shifted by one codepoint
 *    through a 6,624-entry Chinese dictionary, which reads as "the model is
 *    broken".
 *  - **A SPACE IS APPENDED to the end of the file's lines.** `ppocr-keys-v1.txt`
 *    holds 6,623 entries and the model has 6,625 classes; blank takes one and
 *    the trailing space takes the other. Without it every inter-word space comes
 *    out as the last dictionary character. REPORT.md §3.1 notes that losing
 *    inter-word spaces is one of the reasons the English-only model was
 *    rejected — spaces are what make `Team Rocket's Giovanni` matchable.
 */
export function parseKeys(text: string): string[] {
  // `split('\n')` and not a trim-then-split: the file's own entries include
  // characters that a trim would eat, and the reference (`Recognition.create`)
  // splits exactly this way. \r is stripped so a checkout with CRLF line endings
  // cannot shift the whole dictionary — `.gitattributes` should keep this file
  // binary, but a decode that depends on that silently is a trap.
  return [...text.split('\n').map((s) => s.replace(/\r$/, '')), ' ']
}

export interface Decoded {
  text: string
  /** Mean softmax-free confidence: the mean of the winning logits over the
   *  timesteps that contributed a character. The reference's `mean`, and the
   *  value its `>= 0.5` line filter is applied to. */
  mean: number
}

/**
 * Greedy CTC decode of one line's output.
 *
 * `data` is the flat [1, T, C] tensor; `t` is T and `c` is C. Duplicate
 * collapsing is done on the RAW index sequence before blanks are removed — the
 * standard CTC rule, and the reference's `isRemoveDuplicate` path — so a genuine
 * double letter separated by a blank (`Gyarados`' two `a`s are not adjacent, but
 * `Nidorina`'s pattern is the general case) survives.
 */
export function decodeCtc(
  data: Float32Array | Float64Array,
  t: number,
  c: number,
  keys: readonly string[],
): Decoded {
  const chars: string[] = []
  const confs: number[] = []
  let prev = -1
  for (let i = 0; i < t; i++) {
    const off = i * c
    let bestIdx = 0
    let bestVal = Number.NEGATIVE_INFINITY
    for (let k = 0; k < c; k++) {
      const v = data[off + k]
      if (v > bestVal) {
        bestVal = v
        bestIdx = k
      }
    }
    const dup = bestIdx === prev
    prev = bestIdx
    if (bestIdx === 0 || dup) continue
    chars.push(keys[bestIdx - 1] ?? '')
    confs.push(bestVal)
  }
  if (!chars.length) return { text: '', mean: 0 }
  return {
    text: chars.join(''),
    mean: confs.reduce((s, v) => s + v, 0) / confs.length,
  }
}

/** The reference's line filter: a recognition whose mean confidence is under
 *  this never reaches the extractor. It is the cheapest of the guards that make
 *  the failure mode silence rather than lies (REPORT.md §1.2). */
export const MIN_LINE_CONFIDENCE = 0.5
