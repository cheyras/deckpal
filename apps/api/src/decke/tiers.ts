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

export function decideTier(o: {
  triage: Triage;
  carried: CarriedState;
  deepApproved: boolean;
}): TierDecision {
  const pathways = pathwaysOf(o.triage);
  const routed = pathways.length > 0 ? pathways : ['general'] as PathwayName[];
  const floorPathway = routed.reduce((best, name) =>
    TIER_RANK[PATHWAY_META[name].floor] > TIER_RANK[PATHWAY_META[best].floor] ? name : best,
  );
  const reasons = [`floor:${floorPathway}`];

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
