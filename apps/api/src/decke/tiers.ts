/** Deterministic pathway-to-model routing and the small amount of history it carries. */
import {
  PATHWAY_META,
  isPathwayName,
  type Effort,
  type PathwayName,
  type TierName,
} from './pathways/names.js';
import type { Triage } from './triage.js';

export interface CarriedState {
  guardFired: boolean;
  toolErrors: number;
}

export interface TierDecision {
  tier: TierName;
  pathways: PathwayName[];
  effort: Effort;
  reasons: string[];
}

const TIER_RANK: Readonly<Record<Exclude<TierName, 'deep'>, number>> = { quick: 0, standard: 1 };
const EFFORT_RANK: Readonly<Record<Effort, number>> = { low: 0, medium: 1, high: 2 };

function pathwaysOf(triage: Triage): PathwayName[] {
  const names = [triage.pathway, triage.also].filter((x): x is PathwayName => x !== null);
  const unique = [...new Set(names)];
  return unique.length > 1 ? unique.filter((name) => name !== 'general') : unique;
}

/**
 * A pasted log always brings the battle_log guidance with it.
 *
 * The `@pasted` sentinel rule — pass the log as `"@pasted"` rather than
 * re-typing three thousand tokens of it — reaches the model ONLY through the
 * battle_log pathway since the core prompt was cut. Triage may well read "why
 * did I lose this?" plus a paste as battle_review and nothing else, and then
 * the model logs the game by re-emitting it into a 1,200-token budget. So this
 * is code, not a triage instruction: the triage's primary stays (it is what
 * the reader wants NOW) and battle_log joins it, at most two in all.
 */
function withPastedLog(pathways: PathwayName[], pasted: boolean): PathwayName[] {
  if (!pasted || pathways.includes('battle_log')) return pathways;
  const primary = pathways[0];
  return primary && primary !== 'general' ? [primary, 'battle_log'] : ['battle_log'];
}

export function decideTier(o: {
  triage: Triage;
  carried: CarriedState;
  deepApproved: boolean;
  /** The reader's LATEST message holds a pasted PTCG Live log (`extractPastedLog`). */
  pastedLog?: boolean;
}): TierDecision {
  const triaged = pathwaysOf(o.triage);
  const pathways = withPastedLog(triaged, o.pastedLog === true);
  const routed = pathways.length > 0 ? pathways : ['general'] as PathwayName[];
  const floorPathway = routed.reduce((best, name) =>
    TIER_RANK[PATHWAY_META[name].floor] > TIER_RANK[PATHWAY_META[best].floor] ? name : best,
  );
  const reasons = [`floor:${floorPathway}`];
  if (pathways !== triaged) reasons.push('paste:battle_log');

  if (o.deepApproved) {
    return { tier: 'deep', pathways, effort: 'high', reasons: [...reasons, 'approved:deep'] };
  }

  let tier: Exclude<TierName, 'deep'> = PATHWAY_META[floorPathway].floor;
  const raise = (reason: string) => {
    tier = 'standard';
    reasons.push(reason);
  };
  if (o.triage.signals.includes('dissatisfied')) raise('signal:dissatisfied');
  if (o.triage.signals.includes('correction')) raise('signal:correction');
  if (o.carried.guardFired) raise('carried:guard');
  if (o.carried.toolErrors >= 2) raise('carried:tool_errors');
  if (o.triage.wantsDeep === 'offer') raise('deep:offer');
  if (o.triage.wantsDeep === 'requested') raise('deep:requested');

  const effort = tier === 'standard'
    ? 'medium'
    : routed.reduce<Effort>((best, name) =>
        EFFORT_RANK[PATHWAY_META[name].quickEffort] > EFFORT_RANK[best]
          ? PATHWAY_META[name].quickEffort
          : best,
      'low');
  return { tier, pathways, effort, reasons };
}

/**
 * A continuation leg that arrived WITHOUT a usable route echo.
 *
 * Every approval and every browser tool is a fresh POST, and triage re-run on
 * it reads the same reader message with a different previous reply — so the
 * tier could change mid-turn (a Sonnet first leg finishing on Haiku). The
 * browser echoes the first leg's route (`routeEcho.ts`) to prevent exactly that;
 * when the echo is missing (a browser from before it existed) or invalid, we
 * cannot know what the first leg ran on. Re-triage still picks the pathways,
 * but the tier never drops below Standard: finishing a turn on the stronger
 * model costs the reader at most the difference on one leg, while finishing a
 * Standard job on Quick is the misroute the floors exist to prevent.
 */
export function continuationFloor(decision: TierDecision): TierDecision {
  if (decision.tier !== 'quick') return decision;
  return {
    ...decision,
    tier: 'standard',
    effort: 'medium',
    reasons: [...decision.reasons, 'continuation:no_echo'],
  };
}

/**
 * Whether a Quick turn that the model REFUSED gets one retry on Standard.
 *
 * Claude Haiku 5.5 has no server-side refusal fallback; a refusal surfaces as
 * the SDK's unified `content-filter` finish reason. The first version also
 * required "no text in any step", which almost never held once the core prompt
 * asked for a progress line before work ("Let me look that up."), so the
 * safety net was nearly dead.
 *
 * NO DATA TOOL may have been invoked. The retry starts again from the reader's
 * message — it does not continue Quick's steps — so a retry after reads
 * REPEATS them (twice the chips, twice the cost), and a write held on an
 * approval card would be raised a second time. A valid call counts whether it
 * ran or is held; a call that failed its schema never ran and does not.
 */
export function quickRefusalRetry(o: {
  tier: TierName;
  finishReason: unknown;
  steps: ReadonlyArray<{ toolCalls?: ReadonlyArray<{ toolName: string; invalid?: boolean }> | null }>;
  isDataTool: (toolName: string) => boolean;
}): boolean {
  if (o.tier !== 'quick' || o.finishReason !== 'content-filter') return false;
  return !o.steps.some((step) =>
    (step.toolCalls ?? []).some((call) => call.invalid !== true && o.isDataTool(call.toolName)),
  );
}

const GUARD_NOTES = [
  'I got cut off mid-sentence',
  'I kept hitting walls',
  'never actually answered you',
  'I never actually ran it',
  'I never ran anything',
] as const;

type UiMessage = { role?: unknown; parts?: unknown };
type UiPart = { type?: unknown; text?: unknown; state?: unknown; toolName?: unknown; input?: unknown };

function assistantBeforeLatestUser(messages: unknown): UiMessage | null {
  if (!Array.isArray(messages)) return null;
  let latestUser = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if ((messages[i] as UiMessage | null)?.role === 'user') { latestUser = i; break; }
  }
  if (latestUser < 0) return null;
  for (let i = latestUser - 1; i >= 0; i -= 1) {
    const message = messages[i] as UiMessage | null;
    if (message?.role === 'assistant') return message;
  }
  return null;
}

function partsOf(message: UiMessage | null): UiPart[] {
  return Array.isArray(message?.parts)
    ? message.parts.filter((part): part is UiPart => !!part && typeof part === 'object')
    : [];
}

export function carriedFromHistory(messages: unknown): CarriedState {
  const parts = partsOf(assistantBeforeLatestUser(messages));
  const text = parts
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n');
  return {
    guardFired: GUARD_NOTES.some((note) => text.includes(note)),
    toolErrors: parts.filter((part) =>
      typeof part.type === 'string' &&
      (part.type.startsWith('tool-') || part.type === 'dynamic-tool') &&
      part.state === 'output-error',
    ).length,
  };
}

export function answeringAsk(messages: unknown): { about?: PathwayName } | null {
  const ask = partsOf(assistantBeforeLatestUser(messages)).find((part) =>
    part.type === 'tool-ask_user' || (part.type === 'dynamic-tool' && part.toolName === 'ask_user'),
  );
  if (!ask) return null;
  const about = ask.input && typeof ask.input === 'object'
    ? (ask.input as { about?: unknown }).about
    : undefined;
  return isPathwayName(about) ? { about } : {};
}
