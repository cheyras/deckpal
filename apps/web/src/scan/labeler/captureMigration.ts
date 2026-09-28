// Drives the one-time move of the labeler's captures out of the public bucket.
//
// ── WHAT IS BEING MOVED, AND WHY THE BROWSER STARTS IT ─────────────────────
//
// Labels, scanner reports and queued photos used to be stored in the public
// card-art bucket, readable by anyone who guessed a timestamp. The API now
// keeps them in a private bucket and serves them only through the labeler gate
// (apps/api/src/dev/scanFlags.ts, scanQueue.ts). The copies written before that
// change are moved by `POST /dev/scan-queue/migrate-captures`, which does a
// time-boxed batch per call — copy, read back, compare, and only then delete —
// and reports how many are left.
//
// Something has to keep calling it until it answers `done`, without a person
// deciding to. The labeler and the harvest are opened by exactly the accounts
// allowed to call it, so they do: once per tab, in the background, invisible.
// The listing already shows moved and unmoved rows alike, so nothing on screen
// waits for this or changes when it finishes.
//
// Deliberately NO static import of `lib/api` (it reads `import.meta.env` at
// evaluation time, which node does not have), so the loop below can be tested;
// same arrangement as `scan/ui/eventPost.ts`.

/** One call's answer — the fields of the route's JSON this loop reads. */
export interface MigrationStep {
  moved: number
  preserved: number
  gone: number
  failed: number
  remaining: number
  done: boolean
}

export interface DrainResult {
  rounds: number
  moved: number
  done: boolean
  /** Why the loop stopped short of `done`, if it did. */
  stopped?: 'no-progress' | 'errors' | 'round-limit'
}

export interface DrainOptions {
  /** A hard ceiling so a server that never says `done` cannot loop forever. */
  maxRounds?: number
  /** Consecutive failed calls before giving up until the next page load. */
  maxErrors?: number
  /** Pause between rounds, so this is never a hot loop against the API. */
  pauseMs?: number
  sleep?: (ms: number) => Promise<void>
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Call `step` until the server says the move is finished.
 *
 * Stops early on no progress (everything left failed this round — the server
 * keeps those public copies and will try again on the next page load, which is
 * the safe direction), on repeated errors, or at the round ceiling. It never
 * throws: a background chore must not break the page that started it.
 */
export async function drainLegacyCaptures(step: () => Promise<MigrationStep>, options: DrainOptions = {}): Promise<DrainResult> {
  const maxRounds = options.maxRounds ?? 500
  const maxErrors = options.maxErrors ?? 3
  const pauseMs = options.pauseMs ?? 250
  const sleep = options.sleep ?? wait
  const result: DrainResult = { rounds: 0, moved: 0, done: false }
  let errors = 0
  while (result.rounds < maxRounds) {
    result.rounds++
    let answer: MigrationStep
    try {
      answer = await step()
      errors = 0
    } catch {
      errors++
      if (errors >= maxErrors) return { ...result, stopped: 'errors' }
      await sleep(pauseMs * 4 * errors)
      continue
    }
    result.moved += answer.moved + answer.preserved
    if (answer.done || answer.remaining === 0) return { ...result, done: true }
    if (answer.moved + answer.preserved + answer.gone === 0) return { ...result, stopped: 'no-progress' }
    await sleep(pauseMs)
  }
  return { ...result, stopped: 'round-limit' }
}

let running: Promise<DrainResult> | null = null

/**
 * Start the drain once per tab. Later calls (the other route, a remount) join
 * the one already running; after it settles, a later call starts a fresh one,
 * which is how a move that stopped early resumes on the next visit.
 */
export function startLegacyCaptureDrain(): Promise<DrainResult> {
  running ??= (async () => {
    const { api } = await import('../../lib/api')
    const result = await drainLegacyCaptures(() => api.scanCaptureMigrate())
    if (!result.done) console.info('[labeler] capture move paused; it resumes on the next visit', result)
    return result
  })()
    .catch((error: unknown): DrainResult => {
      console.info('[labeler] capture move could not start', error)
      return { rounds: 0, moved: 0, done: false, stopped: 'errors' }
    })
    .finally(() => {
      running = null
    })
  return running
}
