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
import { CLIENT_TOOLS } from '../tools.js'
import { REFLEX_QUESTIONS, reflexFrom, reflexState } from '../reflex.js'
import { ACTION_TOOLS, AUDIT_QUESTIONS, auditFrom, auditState } from '../audit.js'
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

export const precision = (c: Confusion) => (c.tp + c.fp ? c.tp / (c.tp + c.fp) : null)
export const recall = (c: Confusion) => (c.tp + c.fn ? c.tp / (c.tp + c.fn) : null)

/** Pages `escort` cannot reach — the truth `reflexFrom`'s `hide` is scored against. */
const ESCORTLESS = new Set(['list', 'deck', 'other_page'])

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
  const reflex = {
    items: set.reflex.length,
    today: {
      // Today nothing forces the consent card or hides escort.
      force: confusion(set.reflex.map((it) => [false, forceTruth(it)])),
      hideEscort: confusion(set.reflex.map((it) => [false, hideTruth(it)])),
    },
    ...(ask
      ? {
          jev: {
            answered: reflexRows.filter((x) => x.answers).length,
            force: confusion(reflexRows.map((x) => [x.r?.force === 'log_cards', forceTruth(x.it)])),
            hideEscort: confusion(reflexRows.map((x) => [!!x.r?.hide.includes('escort'), hideTruth(x.it)])),
            intentAccuracy: reflexRows.filter((x) => (x.answers?.intent as { choice?: string } | undefined)?.choice === x.it.intent).length / set.reflex.length,
            misses: reflexRows
              .filter((x) => (x.r?.force === 'log_cards') !== forceTruth(x.it) || !!x.r?.hide.includes('escort') !== hideTruth(x.it))
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
    it.claimsAction && !(ACTION_TOOLS[it.action] ?? []).some((t) => it.tools.includes(t))
  const todayFlags = (it: JudgmentSet['audit'][number]) =>
    phantomClaims(it.reply, it.tools).length > 0 ||
    promisedWithoutActing([{ text: it.reply, toolNames: it.tools }], CLIENT, it.tools) !== null
  const auditRows = []
  for (const it of set.audit) {
    const answers = ask
      ? await ask('eval-audit', auditState({ message: it.message, reply: it.reply }), AUDIT_QUESTIONS as unknown as Record<string, Question>)
      : null
    auditRows.push({ it, answers, v: ask ? auditFrom(answers as never, it.tools) : null })
  }
  const audit = {
    items: set.audit.length,
    today: { phantom: confusion(set.audit.map((it) => [todayFlags(it), phantomTruth(it)])) },
    ...(ask
      ? {
          jev: {
            answered: auditRows.filter((x) => x.answers).length,
            phantom: confusion(auditRows.map((x) => [x.v?.phantom != null, phantomTruth(x.it)])),
            phantomKindRight: auditRows.filter((x) => phantomTruth(x.it) && x.v?.phantom === x.it.action).length,
            misses: auditRows.filter((x) => (x.v?.phantom != null) !== phantomTruth(x.it)).map((x) => x.it.id),
          },
        }
      : {}),
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
  const answers = ask
    ? {
        reflex: reflexRows.map((x) => ({ id: x.it.id, answers: x.answers })),
        audit: auditRows.map((x) => ({ id: x.it.id, answers: x.answers })),
      }
    : undefined
  return { reflex, audit, printing, ...(answers ? { answers } : {}) }
}
