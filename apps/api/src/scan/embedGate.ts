/**
 * Is the embedding matcher switched on for this deployment?
 *
 * Contract B11, and the reason it is a gate at all: this path needs a Postgres
 * extension (`vector`, migration 048) and a catalogue that has actually been
 * embedded (tools/embed-catalog). Both are deliberate operator steps that the
 * code cannot perform and must not assume. Shipping the route unconditionally
 * would turn "the migration has not been applied yet" into a 500 on a scan.
 *
 * DEFAULT OFF, and the default is the whole point: the existing dHash path
 * keeps serving every scan until somebody decides otherwise, so merging this
 * changes nothing about the running product until an environment variable says
 * so. `DECKE_CREDITS_ENABLED` is the precedent (DEPLOYMENT.md): unset, or
 * anything other than the exact string `true`, means off.
 *
 * NOT a kill switch for a running feature — a switch for one that has not
 * started. When it is turned on, it should be turned on in Preview first,
 * verified against a real scan, and only then in Production.
 */

/** One name, one place. Declared in DEPLOYMENT.md's environment table in the
 *  same commit as this file, per B11(1). */
export const SCAN_EMBED_VAR = 'SCAN_EMBED_MATCH'

export type ScanEmbedGate =
  /** The route is live and will query `card_embedding`. */
  | 'on'
  /** The route answers 404 exactly as if it did not exist. */
  | 'off'

export function scanEmbedGate(): ScanEmbedGate {
  return process.env[SCAN_EMBED_VAR] === 'true' ? 'on' : 'off'
}

/**
 * What to say at boot.
 *
 * Deliberately quiet when OFF. B11's failure story is a feature that was
 * supposed to be on and silently was not; a feature that is off because nobody
 * has turned it on yet is not that, and warning about it every boot would train
 * the reader to skim exactly the log line that matters later.
 *
 * When it IS on, one line, because the operator has just changed something
 * whose other half — the migration and the embed run — lives outside this
 * process and cannot be checked from here.
 */
export function scanEmbedWarning(): string | null {
  if (scanEmbedGate() === 'off') return null
  return (
    `[deckpal-api] ${SCAN_EMBED_VAR}=true — the embedding matcher is live at ` +
    'POST /api/scan/embed. It requires migration 048 applied and tools/embed-catalog ' +
    'run for the current stamp; neither is checked from here, and both will surface ' +
    'as an error on the first scan if missing.'
  )
}
