/**
 * Which build answered this turn.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * WHY A TRANSCRIPT WITHOUT THIS IS AN ANECDOTE
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *   "Should probably have each chat transcript record say what was the latest PR
 *    it's immediately after so we can easily spot regressions."
 *
 * The point of keeping the transcripts is to be able to say *when* something got
 * worse. "He used to name the cards and now he doesn't" is a feeling until it is
 * "he named them on #78 and stopped on #81", and the difference between those
 * two sentences is two columns written at the moment the turn happened.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * THE PR NUMBER IS ALREADY IN THE COMMIT SUBJECT
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * This repository squash-merges, and GitHub's squash subject ends with the PR
 * reference: `Deck-E: the experience pass … (#78)`. Vercel exposes that subject
 * to the build as `VERCEL_GIT_COMMIT_MESSAGE`, so the number the owner actually
 * thinks in is available without an API call, a token, or a second source of
 * truth that can disagree with the deploy.
 *
 * **It is read at BUILD time, not at request time.** `VERCEL_GIT_*` is populated
 * during the build and inlined into the bundle; a serverless invocation reads
 * whatever was captured then, which is exactly right — the question is which
 * CODE ran, and the code cannot change under a running function.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * NULL IS AN ANSWER, AND ZERO IS NOT
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * A preview deploy, a local `pnpm dev`, and a direct push to `main` with no PR
 * all produce a commit subject with no `(#n)` in it. That is not a failure and
 * must not be recorded as one: `buildPr` is `null`, meaning "this turn cannot be
 * attributed to a PR", and the column sorts NULLS LAST so those turns do not
 * pretend to be the oldest build in the history.
 *
 * `0` would have been the lazy sentinel and would sort as a real value, putting
 * every unattributable turn at the start of a regression hunt.
 */

/**
 * The PR reference GitHub appends to a squash-merge subject.
 *
 * Anchored to the END of the first line, which is the whole reason this is
 * reliable. A `(#123)` anywhere in a commit BODY is somebody quoting an issue —
 * "reverts the change from (#41)" — and matching that would attribute a turn to
 * a pull request that has nothing to do with the running code. GitHub only ever
 * puts the reference at the end of the subject.
 */
const PR_IN_SUBJECT = /\(#(\d{1,7})\)\s*$/;

/** The commit subject, which is the first line and nothing after it. */
function subjectOf(message: string): string {
  return message.split('\n', 1)[0]?.trim() ?? '';
}

/**
 * The PR number this build is immediately after, or `null`.
 *
 * Exported for its own test: the parsing is the part that can be quietly wrong,
 * and it is wrong in a way that produces a plausible number rather than an
 * error.
 */
export function prFromCommitMessage(message: unknown): number | null {
  if (typeof message !== 'string') return null;
  const m = PR_IN_SUBJECT.exec(subjectOf(message));
  if (!m) return null;
  const n = Number(m[1]);
  // `Number('0007')` is 7, which is fine. A zero is not: GitHub does not issue
  // PR #0, so seeing one means the subject was not what we think it was.
  return Number.isInteger(n) && n > 0 ? n : null;
}

export interface BuildStamp {
  /** The PR this build is immediately after, or null when not attributable. */
  buildPr: number | null;
  /** The exact commit, short form. Null outside a Vercel build. */
  buildSha: string | null;
}

/**
 * Read the stamp from the environment.
 *
 * Read per call rather than cached at module load. A serverless instance can
 * outlive a redeploy of its own configuration, and a stale stamp is worse than
 * no stamp — it would attribute new turns to old code, which is the exact
 * mistake this feature exists to prevent somebody making by hand.
 */
export function buildStamp(): BuildStamp {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA;
  return {
    buildPr: prFromCommitMessage(process.env.VERCEL_GIT_COMMIT_MESSAGE),
    // Seven characters is what `git log --oneline` shows and what a person will
    // paste back. The full forty is available in Vercel if anybody needs it.
    buildSha: typeof sha === 'string' && sha ? sha.slice(0, 7) : null,
  };
}
