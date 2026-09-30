/** Pure activity-to-animation policy for Deck-E's host. */

export type ToolKind =
  | 'research' | 'catalog' | 'collection' | 'decks' | 'check' | 'lists'
  | 'logs' | 'prices' | 'write' | 'show' | 'move' | 'other'

export type WorkingState = 'thinking' | 'curious' | 'loading' | 'card_show' | 'card_stash' | 'card_present' | 'point'
export type ActivityState = WorkingState | 'idle' | 'listening' | 'sleep' | 'nod_yes' | 'alert_star' | 'alert_money'

export type ActivityRequest = {
  state?: ActivityState
  mode?: 'sustain' | 'once'
  then?: WorkingState
  durationMs?: number
  /** Whether the host should enable the speech-mouth overlay. */
  talk?: boolean
}

export type StepOutcome =
  | 'ok' | 'partial' | 'error' | 'declined'
  | { phase: 'ok' | 'partial' | 'error' | 'declined'; hasSources?: boolean }
export type StepMeta = { hasSources?: boolean; sources?: readonly unknown[] }

export const ACTIVITY_BEAT_COOLDOWN_MS = 3000
export const WORK_POSE_MIN_MS = 4000
export const WORK_POSE_MAX_MS = 7000
export const EXPRESS_GRACE_MS = 1800
export const TYPING_IDLE_MS = 4000
export const SLEEP_IDLE_MS = 90_000

const WORK_POSES: Record<ToolKind, readonly WorkingState[]> = {
  research: ['loading', 'curious', 'thinking'],
  catalog: ['card_show', 'curious', 'thinking'],
  collection: ['card_show', 'curious', 'thinking'],
  decks: ['card_present', 'curious', 'thinking'],
  check: ['thinking', 'curious', 'loading'],
  lists: ['card_present', 'curious', 'thinking'],
  logs: ['loading', 'curious', 'thinking'],
  prices: ['card_show', 'curious', 'thinking'],
  write: ['card_stash', 'thinking', 'curious'],
  show: ['card_present', 'point'],
  move: ['point', 'curious'],
  other: ['thinking', 'curious', 'loading'],
}

/** Select the first fitting work pose for a newly-started step. */
export function workingStateFor(kind: ToolKind, stepIndex: number): WorkingState | null {
  const poses = WORK_POSES[kind]
  return poses[Math.max(0, stepIndex) % poses.length] ?? null
}

/** Choose a later work pose. The previous pose is removed before sampling. */
export function workPoseFor(kind: ToolKind, previous: WorkingState | null, reducedMotion: boolean, roll: number): WorkingState | null {
  if (reducedMotion) return null
  const choices = WORK_POSES[kind].filter((pose) => pose !== previous)
  const pool = choices.length ? choices : WORK_POSES[kind]
  const normalized = Number.isFinite(roll) ? Math.min(0.999999, Math.max(0, roll)) : 0
  return pool[Math.floor(normalized * pool.length)] ?? null
}

/** A gentle, bounded cadence supplied from the host's random source. */
export function workPoseDelay(roll: number): number {
  const normalized = Number.isFinite(roll) ? Math.min(1, Math.max(0, roll)) : 0
  return Math.round(WORK_POSE_MIN_MS + normalized * (WORK_POSE_MAX_MS - WORK_POSE_MIN_MS))
}

/** Explicit model gestures win briefly, not for the rest of the turn. */
export function workPoseAllowedAfterExpress(expressAt: number | null, now: number): boolean {
  return expressAt === null || now - expressAt >= EXPRESS_GRACE_MS
}

export function isWorkPose(state: ActivityState): state is WorkingState {
  return state === 'thinking' || state === 'curious' || state === 'loading' || state === 'card_show' || state === 'card_stash' || state === 'card_present' || state === 'point'
}

/** Pick punctuation for a successful step; the animator enforces rarity. */
export function stepBeat(kind: ToolKind, outcome: StepOutcome): 'nod_yes' | 'alert_star' | 'alert_money' | null {
  const phase = typeof outcome === 'string' ? outcome : outcome.phase
  const hasSources = typeof outcome === 'string' ? false : outcome.hasSources === true
  if (phase !== 'ok' || kind === 'show' || kind === 'move') return null
  if (kind === 'research' && hasSources) return 'alert_star'
  if (kind === 'prices') return 'alert_money'
  return 'nod_yes'
}

export type ActivityAnimatorOptions = { now: () => number; reducedMotion: boolean }
export type ActivityAnimator = {
  turnStarted(): ActivityRequest | null
  legStarted(): ActivityRequest | null
  stepStarted(kind: ToolKind): ActivityRequest | null
  stepFinished(kind: ToolKind, outcome: StepOutcome, meta?: StepMeta): ActivityRequest | null
  textStarted(): ActivityRequest | null
  approvalShown(): ActivityRequest | null
  approvalAnswered(): ActivityRequest | null
  turnEnded(modelMoved: boolean): ActivityRequest | null
  composerTyping(active: boolean): ActivityRequest | null
  idleFor(ms: number): ActivityRequest | null
}

/** Build one turn-local policy; the streaming host owns event timing. */
export function createActivityAnimator({ now, reducedMotion }: ActivityAnimatorOptions): ActivityAnimator {
  let current: ActivityState = 'idle'
  let working: WorkingState | null = null
  let steps = 0
  let busy = false
  let typing = false
  let typingStopped = false
  let lastBeatAt: number | null = null
  let usedStar = false
  let usedMoney = false

  const sustain = (state: ActivityState, talk?: boolean): ActivityRequest | null => {
    if (current === state && talk === undefined) return null
    current = state
    return { state, mode: 'sustain', ...(talk === undefined ? {} : { talk }) }
  }
  const awake = () => { typingStopped = false }

  return {
    turnStarted() {
      busy = true; typing = false; awake(); steps = 0; lastBeatAt = null; usedStar = false; usedMoney = false
      working = 'thinking'
      return sustain('thinking', false)
    },
    legStarted() {
      if (reducedMotion) return null
      busy = true; awake(); working = 'thinking'
      return sustain('thinking', false)
    },
    stepStarted(kind) {
      if (reducedMotion) return null
      busy = true; awake()
      const state = workingStateFor(kind, steps++)
      if (state === null) { working = null; return { talk: false } }
      working = state
      if (current === state) return { talk: false }
      current = state
      return { state, mode: 'sustain', talk: false }
    },
    stepFinished(kind, outcome, meta = {}) {
      if (reducedMotion || working === null) return null
      const hasSources = meta.hasSources === true || (meta.sources?.length ?? 0) > 0
      const normalized = typeof outcome === 'string'
        ? { phase: outcome, hasSources }
        : { phase: outcome.phase, hasSources: outcome.hasSources === true || hasSources }
      const beat = stepBeat(kind, normalized)
      if (beat === null || (beat === 'alert_star' && usedStar) || (beat === 'alert_money' && usedMoney)) return null
      if (lastBeatAt !== null && now() - lastBeatAt < ACTIVITY_BEAT_COOLDOWN_MS) return null
      if (beat === 'alert_star') usedStar = true
      if (beat === 'alert_money') usedMoney = true
      lastBeatAt = now(); current = beat
      return { state: beat, mode: 'once', then: working, talk: false }
    },
    textStarted() {
      if (reducedMotion) return null
      awake()
      return { talk: true }
    },
    approvalShown() {
      if (reducedMotion) return null
      busy = true; awake(); working = 'thinking'
      return sustain('point', false)
    },
    approvalAnswered() {
      if (reducedMotion) return null
      busy = true; awake(); working = 'thinking'
      return sustain('thinking', false)
    },
    turnEnded(modelMoved) {
      busy = false; typing = false; awake(); working = null
      // A gesture that was the LAST thing he did this turn (the model's own
      // express, or an error posture) stands; a work pose left over from the
      // turn does not, because it is sustained and would loop forever.
      if (modelMoved) return null
      current = 'idle'
      return { state: 'idle', mode: 'sustain', talk: false }
    },
    composerTyping(active) {
      if (reducedMotion || busy) return null
      if (active) { typing = true; awake(); return sustain('listening') }
      typing = false; typingStopped = true
      return null
    },
    idleFor(ms) {
      if (reducedMotion || busy || typing) return null
      if (typingStopped && ms >= TYPING_IDLE_MS) { typingStopped = false; return sustain('idle') }
      if (ms >= SLEEP_IDLE_MS) return sustain('sleep')
      return null
    },
  }
}
