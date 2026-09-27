/**
 * Score the judgment eval set: today's heuristics always, Jev when asked.
 *
 * Shared by the free CI test (`__tests__/judgmentsEval.test.ts`, heuristics
 * only) and the paid runner (`scripts/decke-jev-eval.mjs`), so the numbers in a
 * pull request and the numbers CI pins are computed by the same code. Every
 * heuristic here is the REAL one, imported; a baseline copied into a test file
 * would be measuring the copy.
 */
import { readerNamedPrinting } from '../printingSaid.js'
import { phantomClaims, promisedWithoutActing } from '../turnGuards.js'
import { declinedCalls } from '../declined.js'
import { callKey } from '../repeat.js'
import { CLIENT_TOOLS } from '../tools.js'
import { REFLEX_QUESTIONS, reflexFrom, reflexState } from '../reflex.js'
import type { Answer, Question } from '../jev.js'

export interface JudgmentSet {
  reflex: {
    id: string
    message: string
    previousReply?: string
    intent: string
    destination: string
    declinesResearch?: boolean
    declinesGuide?: boolean
    asksResearch?: boolean
    asksGuide?: boolean
  }[]
  audit: {
    id: string
    message: string
    reply: string
    tools: string[]
    claimsAction: boolean
    action: string
  }[]
  printing: {
    id: string
    message: string
    rows: { card: string; candidates: string[]; stated: string | null }[]
  }[]
}

/** How the paid runner asks Jev. Absent in CI. */
export type Ask = (
  label: string,
  state: unknown,
  questions: Record<string, Question>,
) => Promise<Record<string, Answer> | null>

export interface Confusion {
  tp: number
  fp: number
  fn: number
  tn: number
}

const confusion = (pairs: [predicted: boolean, truth: boolean][]): Confusion => {
  const c = { tp: 0, fp: 0, fn: 0, tn: 0 }
  for (const [p, t] of pairs) c[p ? (t ? 'tp' : 'fp') : t ? 'fn' : 'tn']++
  return c
}

const tally = (xs: boolean[]) => ({ right: xs.filter(Boolean).length, of: xs.length })

export const precision = (c: Confusion) => (c.tp + c.fp ? c.tp / (c.tp + c.fp) : null)
export const recall = (c: Confusion) => (c.tp + c.fn ? c.tp / (c.tp + c.fn) : null)

/**
 * The tools whose having run makes a claimed action true. MIRRORS the map the
 * after-turn audit uses; kept here so the baseline can be scored on its own.
 */
const PERFORMS: Record<string, readonly string[]> = {
  collection: ['log_cards'],
  list: ['edit_list', 'delete_list'],
  deck: ['save_deck', 'delete_deck', 'deck_history', 'revert'],
  battle_log: ['add_battle_log', 'edit_battle_log', 'delete_battle_log'],
  guide: ['deck_strategy', 'write_strategy_guide'],
  navigation: ['goTo', 'flyTo', 'escort', 'journey', 'click', 'highlight', 'scrollToMe'],
}

/** Pages `escort` cannot reach — the truth `reflexFrom`'s `hide` is scored against. */
const ESCORTLESS = new Set(['list', 'deck', 'other_page'])

/** A research_meta (or guide) decline already on the wire, for the bypass check. */
const priorDecline = (tool: string, input: Record<string, unknown>) => [
  {
    role: 'assistant',
    parts: [{ type: `tool-${tool}`, input, state: 'approval-responded', approval: { id: 'a', approved: false, reason: 'the reader declined' } }],
  },
]

/**
 * Does today's code keep a family declined after this sentence? `declinedCalls`
 * lets the reader's own words re-open a declined family (the bypass), keyed on
 * words like "meta" and "strategy" — which a sentence REFUSING research
 * usually contains.
 */
function keepsDeclined(
  tool: 'research_meta' | 'write_strategy_guide',
  text: string,
  spoken?: { research: boolean; guide: boolean },
): boolean {
  const input = tool === 'research_meta' ? { query: 'q' } : { deck: 'd' }
  const other = tool === 'research_meta' ? { query: 'something else' } : { deck: 'another deck' }
  return declinedCalls(priorDecline(tool, input), text, spoken).has(callKey(tool, other))
}

/**
 * After an earlier card was declined, does this sentence leave the family
 * handled right — still refused when the reader said no again, re-opened when
 * they asked for it? The real `declinedCalls`, with or without Jev's spoken
 * declines.
 */
function familyHandled(it: JudgmentSet['reflex'][number], spoken?: { research: boolean; guide: boolean }) {
  const cases: boolean[] = []
  if (it.declinesResearch) cases.push(keepsDeclined('research_meta', it.message, spoken))
  if (it.declinesGuide) cases.push(keepsDeclined('write_strategy_guide', it.message, spoken))
  if (it.asksResearch) cases.push(!keepsDeclined('research_meta', it.message, spoken))
  if (it.asksGuide) cases.push(!keepsDeclined('write_strategy_guide', it.message, spoken))
  return cases
}

export async function scoreSet(set: JudgmentSet, ask?: Ask) {
  // ── REFLEX ────────────────────────────────────────────────────────────────
  const reflexRows = []
  for (const it of set.reflex) {
    const answers = ask
      ? await ask('eval-reflex', reflexState({ message: it.message, previousReply: it.previousReply, route: '/' }),
        REFLEX_QUESTIONS as unknown as Record<string, Question>)
      : null
    const r = ask ? reflexFrom(answers as never) : null
    reflexRows.push({ it, answers, r })
  }
  const forceTruth = (it: JudgmentSet['reflex'][number]) => it.intent === 'change_collection'
  const hideTruth = (it: JudgmentSet['reflex'][number]) => ESCORTLESS.has(it.destination)
  const researchDecline = set.reflex.filter((it) => it.declinesResearch)
  const guideDecline = set.reflex.filter((it) => it.declinesGuide)
  const reflex = {
    items: set.reflex.length,
    today: {
      // Today nothing forces the consent card, hides escort, or hears a no.
      force: confusion(set.reflex.map((it) => [false, forceTruth(it)])),
      hideEscort: confusion(set.reflex.map((it) => [false, hideTruth(it)])),
      spokenDecline: confusion(set.reflex.map((it) => [false, !!(it.declinesResearch || it.declinesGuide)])),
      // And a spoken "no" usually trips the reader-mention BYPASS, which
      // re-opens the very family it refuses when an earlier card was declined.
      declinesReopenedByBypass:
        researchDecline.filter((it) => !keepsDeclined('research_meta', it.message)).length +
        guideDecline.filter((it) => !keepsDeclined('write_strategy_guide', it.message)).length,
      declineSentences: researchDecline.length + guideDecline.length,
      familyHandled: tally(set.reflex.flatMap((it) => familyHandled(it))),
    },
    ...(ask
      ? {
          jev: {
            answered: reflexRows.filter((x) => x.answers).length,
            force: confusion(reflexRows.map((x) => [x.r?.force === 'log_cards', forceTruth(x.it)])),
            hideEscort: confusion(reflexRows.map((x) => [!!x.r?.hide.includes('escort'), hideTruth(x.it)])),
            spokenDecline: confusion(
              reflexRows.flatMap((x) => [
                [!!x.r?.declines.research, !!x.it.declinesResearch],
                [!!x.r?.declines.guide, !!x.it.declinesGuide],
              ]),
            ),
            familyHandled: tally(reflexRows.flatMap((x) => familyHandled(x.it, x.r?.declines))),
            intentAccuracy: reflexRows.filter((x) => (x.answers?.intent as { choice?: string } | undefined)?.choice === x.it.intent).length / set.reflex.length,
            misses: reflexRows
              .filter((x) => (x.r?.force === 'log_cards') !== forceTruth(x.it) || !!x.r?.hide.includes('escort') !== hideTruth(x.it) ||
                !!x.r?.declines.research !== !!x.it.declinesResearch || !!x.r?.declines.guide !== !!x.it.declinesGuide)
              .map((x) => x.it.id),
          },
        }
      : {}),
  }

  // ── AUDIT ─────────────────────────────────────────────────────────────────
  //
  // A reply that claims a change or a move the turn never made. The truth is
  // the label plus the tool log: a claimed list edit with `edit_list` in the
  // log is the flow working, not a phantom.
  const CLIENT = new Set<string>(CLIENT_TOOLS)
  const phantomTruth = (it: JudgmentSet['audit'][number]) =>
    it.claimsAction && !(PERFORMS[it.action] ?? []).some((t) => it.tools.includes(t))
  const todayFlags = (it: JudgmentSet['audit'][number]) =>
    phantomClaims(it.reply, it.tools).length > 0 ||
    promisedWithoutActing([{ text: it.reply, toolNames: it.tools }], CLIENT, it.tools) !== null
  const audit = {
    items: set.audit.length,
    today: { phantom: confusion(set.audit.map((it) => [todayFlags(it), phantomTruth(it)])) },
  }

  // ── PRINTING, PER ROW ─────────────────────────────────────────────────────
  //
  // "known" means the row goes on the card as the reader's decision and no one
  // asks; "ask" means the picker. A FALSE KNOWN is the costly error — a card
  // silently filed under a printing nobody named — so it is reported apart.
  type Outcome = { truthKnown: boolean; known: boolean; right: boolean }
  const today: Outcome[] = []
  for (const it of set.printing) {
    const said = readerNamedPrinting(it.message)
    for (const row of it.rows) {
      const truthKnown = row.stated !== null
      today.push({ truthKnown, known: said, right: said === truthKnown })
    }
  }
  const printingMetrics = (o: Outcome[]) => ({
    rows: o.length,
    accuracy: o.filter((x) => x.right).length / o.length,
    falseKnown: o.filter((x) => x.known && !x.right).length,
    unstatedRows: o.filter((x) => !x.truthKnown).length,
    falseAsk: o.filter((x) => !x.known && x.truthKnown).length,
    statedRows: o.filter((x) => x.truthKnown).length,
  })
  const printing = { today: printingMetrics(today) }

  // The raw answers, so a threshold can be re-chosen without paying again.
  const answers = ask ? { reflex: reflexRows.map((x) => ({ id: x.it.id, answers: x.answers })) } : undefined
  return { reflex, audit, printing, ...(answers ? { answers } : {}) }
}
