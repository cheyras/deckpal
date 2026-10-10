/**
 * One route per TURN, not per HTTP leg.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * THE DEFECT
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * A reader's turn is often several POSTs: every approval card and every browser
 * tool (`goTo`, `journey`, …) ends the server request, and the browser resumes
 * it with a fresh one. Triage ran on every one of them, reading the same reader
 * message beside a different previous reply, so the tier and pathway could
 * change mid-turn — a deck build begun on Sonnet 5.5 finishing on Haiku 5.5
 * after the reader approved its save, under different pathway guidance.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * THE CONTRACT (shared with `apps/web`)
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *   - FIRST leg (no tool parts after the reader's latest message): the server
 *     triages, decides, and writes a TRANSIENT stream part
 *       `{ type: 'data-decke-route', data: { tier, pathways, effort } }`.
 *   - CONTINUATION leg: the browser sends that `data` back as the POST body's
 *     `tierRoute` field — NOT `route`, which is the page pathname the prompt
 *     reads. A valid echo is reused verbatim and triage is skipped. An absent
 *     or invalid one is re-triaged with a Standard floor (`continuationFloor`).
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * WHY IT IS NOT SIGNED
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Approvals are HMAC-signed because a forged one would WRITE. A forged route
 * can only choose between Quick and Standard for the caller's own turn, and on
 * actual-cost credits the caller pays for whichever model runs — so a "forgery"
 * changes nothing but the forger's own bill. (Under the flat legacy price a
 * reader could already reach Standard by words alone: a correction or a
 * dissatisfied message raises the tier.) What an unsigned echo must never do is
 * reach Deep Think, which needs the reader's signed consent and a larger hold;
 * `tier: 'deep'` is therefore not a valid echo, and a decision built from one
 * can only ever be Quick or Standard.
 */
import { z } from 'zod';
import { PATHWAY_NAMES, type Effort, type PathwayName } from './pathways/names.js';
import type { TierDecision } from './tiers.js';

/** The stream part type the browser listens for. */
export const ROUTE_ECHO_PART = 'data-decke-route' as const;

export interface RouteEcho {
  tier: 'quick' | 'standard';
  pathways: PathwayName[];
  effort: Effort;
}

const echoSchema = z.object({
  tier: z.enum(['quick', 'standard']),
  pathways: z.array(z.enum(PATHWAY_NAMES)).min(1).max(2)
    .refine((names) => new Set(names).size === names.length, 'pathways must be distinct'),
  effort: z.enum(['low', 'medium', 'high']),
}).strict();

/**
 * The browser's echo, validated strictly, or null.
 *
 * Strict means: exactly the three keys, a tier that is never `deep`, one or two
 * distinct known pathways, a known effort. Anything else — an older browser
 * that sends nothing, a malformed object, a hand-edited `deep` — is null, and
 * the caller re-triages rather than guessing at a partial echo.
 */
export function readRouteEcho(value: unknown): RouteEcho | null {
  const parsed = echoSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** What a first leg writes for the browser to echo, or null if it may not be echoed. */
export function routeEchoFor(decision: TierDecision): RouteEcho | null {
  if (decision.tier === 'deep') return null;
  return readRouteEcho({
    tier: decision.tier,
    pathways: decision.pathways,
    effort: decision.effort,
  });
}

/** The decision a continuation leg runs on when the echo was valid. */
export function decisionFromEcho(echo: RouteEcho): TierDecision {
  return {
    tier: echo.tier,
    pathways: [...echo.pathways],
    effort: echo.effort,
    reasons: ['echo'],
  };
}
