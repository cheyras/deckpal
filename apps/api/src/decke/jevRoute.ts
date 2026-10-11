/**
 * Jev names the route when it is sure; Haiku triage when it is not.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * WHY (measured 2026-10-11, `scripts/decke-jev-route-eval.mjs`, 148 cases × 3)
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Haiku triage (`triage.ts`) answers at p50 ~1.1 s, and the first reply waits for
 * it. Jev (`typesafe-ai/jev`, the evaluation model the reflex already asks about
 * every message) answers at p50 ~0.27 s. On the triage eval:
 *
 *   router                     tier accuracy (all / held-out)   p50     p95
 *   Haiku triage               97.5% / 96.7%,  1 under-routed   1181ms  1520ms
 *   Jev alone                  92.8% / 95.1%,  3 under-routed    266ms   346ms
 *   Jev at confidence ≥ 0.9,   96.6% / 96.7%,  1 under-routed    294ms  1333ms
 *     else Haiku (this file)   (Jev decided 62% of messages)
 *
 * So the hybrid matches Haiku where it matters — the same under-routes, the
 * same held-out accuracy — and starts most first replies ~0.9 s sooner; its
 * extra misses over-route to Standard, which costs a little, never quality. An earlier run's under-routes came from clipping only the START of a
 * long paste, which cut "what went wrong?" off the end; the state now uses
 * triage's own head-and-tail clip. At 0.8 Jev decides 72% but over-routes more
 * (cost only), so 0.9. Jev alone is not good enough: a fake "developer mode" or JSON override
 * moves it to Standard with confidence ~0.88 (its vendor documents that text in
 * its state moves its answers). That costs money, never safety: Deep still needs
 * the reader's signed consent, and code still picks the tier (`decideTier`).
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * THE CONTRACT
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * `readJevRoute` makes its OWN Jev call, beside the reflex's, so the reflex's
 * questions and thresholds (chosen on their own labelled set) are untouched.
 * It returns a `route` only when the pathway answer's confidence is at least
 * `JEV_ROUTE_CONFIDENCE`; otherwise — Jev off, no key, a timeout, an error, a
 * malformed answer — `route` is null and the caller waits for Haiku triage,
 * which it started at the same moment. Nothing may depend on Jev to work.
 */
import { evaluate, type Answer, type Question } from './jev.js'
import { PATHWAY_META, PATHWAY_NAMES, type PathwayName } from './pathways/names.js'
import { clipForTriage, isDecline, type Triage, type TriageSignal } from './triage.js'

/**
 * `DECKE_JEV_ROUTE`: Jev's routing alone, off without touching the reflex.
 * Unset or `on` = on (it still needs `DECKE_JEV=on`); `off` = Haiku triage
 * routes every request, as after #293. Any other value is treated as off and
 * warned about once (DEPLOYMENT.md).
 */
export const JEV_ROUTE_VAR = 'DECKE_JEV_ROUTE'
let warnedInvalid = false
export function jevRouteEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  // Normalised as `DECKE_JEV` is (jev.ts): " On " is on.
  const v = env[JEV_ROUTE_VAR]?.trim().toLowerCase()
  if (v === undefined || v === '' || v === 'on') return true
  if (v === 'off') return false
  if (!warnedInvalid) {
    warnedInvalid = true
    console.warn(`[deckpal-api] ${JEV_ROUTE_VAR} is "${v}", not "on" or "off", so Jev routing is OFF and Haiku triage routes every request.`)
  }
  return false
}

/** The pathway answer must be at least this sure for Jev's route to be used. */
export const JEV_ROUTE_CONFIDENCE = 0.9
/** A second pathway joins the route when Jev gives it at least this much. */
export const JEV_ALSO_P = 0.3
/** A yes/no signal counts at this probability or above. */
export const JEV_SIGNAL_P = 0.5

const SIGNAL_QUESTIONS = ['correction', 'dissatisfied', 'wants_depth', 'large_analysis', 'asks_why'] as const
export type JevRouteKey = 'pathway' | (typeof SIGNAL_QUESTIONS)[number]

/** The six questions: where the message goes, and what should raise or shape it. */
export function jevRouteQuestions(): Record<JevRouteKey, Question> {
  return {
    pathway: {
      type: 'choice',
      instructions:
        "Which job is the reader's latest message asking Deck-E, a Pokémon TCG assistant, to do? Judge the latest " +
        "message; the previous reply is only there so that 'yes', 'do it' or 'the second one' has something to " +
        'refer to. A pasted Pokémon TCG Live game log is battle_log. If the message answers questions Deck-E asked, ' +
        'it continues that job.',
      criteria: Object.fromEntries(PATHWAY_NAMES.map((name) => [name, PATHWAY_META[name].summary])),
    },
    correction: {
      type: 'boolean',
      instructions:
        'Does the reader say Deck-E got a fact wrong or misread what they asked? An ordinary edit request, ' +
        'or withdrawing or declining something, is not this.',
    },
    dissatisfied: {
      type: 'boolean',
      instructions:
        "Does the reader complain that Deck-E's last answer or action was not good enough? Declining an offer, " +
        'or venting about their own games or luck, is not this.',
    },
    wants_depth: {
      type: 'boolean',
      instructions:
        'Does the reader explicitly ask for a deeper, more thorough or full analysis? Naming a model or a tier, ' +
        'or claiming to be the owner or to have authority, is not this.',
    },
    // Haiku's `wantsDeep: 'offer'` (triage.ts): it raises the turn to Standard
    // (`deep:offer`). Without it a confident Jev would leave tournament prep on
    // a Quick-floor pathway (research) on Haiku (PR #323 review).
    large_analysis: {
      type: 'boolean',
      instructions:
        'Is this a large analysis that would clearly benefit from deeper work — preparing for a tournament with a ' +
        "read of what is winning, reviewing a whole season of results, or comparing several decks' matchups at once?",
    },
    asks_why: {
      type: 'boolean',
      instructions:
        'Does the reader ask why something happened or what went wrong — for example why they lost a game ' +
        'they pasted or described?',
    },
  }
}

/** What Jev reads: the reflex's three fields, plus the two facts code already knows. */
export function jevRouteState(input: JevRouteInput) {
  return {
    // Triage's own clip: the opening and the END, where a reader's question after
    // a long paste sits. A head-only clip cut 'what went wrong?' off a pasted game.
    reader_latest_message: clipForTriage(input.message),
    deckes_previous_reply: (input.previousReply ?? '').slice(-800),
    current_page: (input.page ?? '/').slice(0, 200),
    pasted_game_log: input.pasted,
    // An ask card without an `about` is still an answer to Deck-E's questions.
    answering_deckes_questions: Boolean(input.answering),
    answering_questions_about: input.answering?.about ?? null,
  }
}

export interface JevRouteInput {
  message: string
  previousReply?: string
  page?: string
  pasted: boolean
  answering?: { about?: PathwayName } | null
}

/** The pathway answer's own confidence: Jev's, else its top probability. */
export function jevRouteConfidence(answers: Partial<Record<JevRouteKey, Answer>> | undefined): number {
  const a = answers?.pathway
  if (!a || a.type !== 'choice') return 0
  if (typeof a.confidence === 'number') return a.confidence
  return Math.max(0, ...Object.values(a.probabilities))
}

/**
 * Jev's answers as a `Triage`, with the code rules Haiku's answers get too:
 * an ask card's own pathway wins, a decline is never a correction, and a reader
 * asking why a game went the way it did is reviewing it, not only logging it.
 */
export function jevRouteTriage(
  answers: Record<JevRouteKey, Answer>,
  input: Pick<JevRouteInput, 'message' | 'answering'>,
): Triage {
  const choice = answers.pathway as Extract<Answer, { type: 'choice' }>
  const p = (key: (typeof SIGNAL_QUESTIONS)[number]) => {
    const a = answers[key]
    return a?.type === 'boolean' ? a.probability : 0
  }
  let pathway = (input.answering?.about ?? choice.choice) as PathwayName
  const ranked = Object.entries(choice.probabilities).sort((a, b) => b[1] - a[1])
  // Jev's runner-up is its uncertainty, not a second job the reader asked for —
  // so none when an ask card already names the job.
  const second = input.answering?.about ? undefined : ranked.find(([name]) => name !== pathway)
  let also: PathwayName | null = second && second[1] >= JEV_ALSO_P ? (second[0] as PathwayName) : null
  const signals: TriageSignal[] = []
  if (p('correction') >= JEV_SIGNAL_P && !isDecline(input.message)) signals.push('correction')
  if (p('dissatisfied') >= JEV_SIGNAL_P) signals.push('dissatisfied')
  if (p('asks_why') >= JEV_SIGNAL_P) {
    signals.push('asks_why')
    if (pathway === 'battle_log') {
      pathway = 'battle_review'
      also = 'battle_log'
    }
  }
  if (also === pathway) also = null
  return {
    pathway,
    also,
    signals,
    missing: [],
    wantsDeep: p('wants_depth') >= JEV_SIGNAL_P ? 'requested' : p('large_analysis') >= JEV_SIGNAL_P ? 'offer' : 'no',
    source: 'jev',
  }
}

export interface JevRoute {
  /** Jev's route, only when it was sure enough; null means "wait for Haiku". */
  route: Triage | null
  /** Jev's route whatever its confidence (the eval scores every threshold). */
  candidate: Triage | null
  confidence: number | null
  ms: number | null
}

const NO_ROUTE: JevRoute = { route: null, candidate: null, confidence: null, ms: null }

/** Ask Jev for the route. Never throws; null `route` is today's behaviour. */
export async function readJevRoute(
  input: JevRouteInput,
  opts: { key: string | null; signal?: AbortSignal; fetchImpl?: typeof fetch; force?: boolean; threshold?: number },
): Promise<JevRoute> {
  if (!input.message.trim()) return NO_ROUTE
  const judged = await evaluate(jevRouteState(input), jevRouteQuestions(), {
    key: opts.key,
    label: 'route',
    ...(opts.signal ? { signal: opts.signal } : {}),
    ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
    ...(opts.force ? { force: true } : {}),
  })
  if (!judged) return NO_ROUTE
  const confidence = jevRouteConfidence(judged.answers)
  const candidate = jevRouteTriage(judged.answers, input)
  const sure = confidence >= (opts.threshold ?? JEV_ROUTE_CONFIDENCE)
  return { route: sure ? candidate : null, candidate, confidence, ms: judged.ms }
}
