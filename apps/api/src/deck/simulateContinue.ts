/**
 * The simulator's CONTINUATION TOKEN: what lets a later `POST /decks/simulate`
 * add games to an earlier run and report the cumulative result, with the server
 * keeping nothing between the calls (no table, queue or cron — the client holds
 * the state, and signs it).
 *
 * WHAT IT HOLDS. `sc1.<payload>.<mac>`: the payload is JSON, deflated, base64url
 * (a few hundred bytes for a plain run, about a kilobyte for a paired comparison
 * across several opponents):
 *   v      format version (1)
 *   t      issued-at, ms
 *   c      calls so far (this token includes them)
 *   s, d   speed ('s' strong / 'f' fast) and the base seed
 *   k      'r' plain run, 'c' paired comparison
 *   i      IDENTITY — what the totals are about: a fingerprint of the subject's
 *          resolved card list, of version B's (comparison), of each opponent's
 *          (in order), the format, and the deployment that issued it
 *   a      the running totals, one entry per opponent (@deckpal/sim continue.ts:
 *          wins/losses/draws/time-outs, splits, reasons, the next seed pair, and
 *          for a comparison the sums the paired interval needs)
 *
 * INTEGRITY. The mac is HMAC-SHA256 over a domain label, the CALLER'S USER ID
 * and the compressed bytes, keyed by a key derived from DECKE_APPROVAL_SECRET
 * (the secret Deck-E's signed approvals and Deep Think tokens already use — no
 * new variable). A client therefore cannot forge or edit totals to put numbers
 * in a report attributed to the engine, and cannot hand a token to another
 * account. The mac is checked BEFORE anything is decompressed or parsed.
 * What a signature cannot stop: replaying an old token (a client may rewind to
 * an earlier call and branch from there; each branch is still real engine
 * games, since only the engine can mint a token) and handing the same token to
 * two calls (each continues from the same point and returns its own token; the
 * two are never merged).
 *
 * UNSET SECRET = CONTINUATION IS OFF, like Deep Think: no token is issued, and a
 * call carrying one is refused with 503. A plain run is unaffected. The boot
 * warning (decke/gate.ts) and GET /health `deckeApprovals` say so.
 *
 * REFUSED, each with a message that says what to do: a token that does not
 * verify, is from another format version, is older than CONTINUE_TTL_MS, was
 * issued by another deployment (a deploy can change the engine, and totals from
 * two engines must not be mixed), has reached CONTINUE_MAX_CALLS, or whose
 * identity differs from the request's (a deck edited between calls is a new
 * run, never a blend).
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import {
  compareFromWire, compareToWire, totalsFromWire, totalsToWire, type CompareTotals, type MatchupTotals,
} from '@deckpal/sim';
import { ApiError, badRequest } from '../http.js';

export const CONTINUE_VERSION = 1;
/** A token is good for this long after it was issued; every call issues a fresh one. */
export const CONTINUE_TTL_MS = 2 * 60 * 60 * 1000;
/** Calls in one chain, the first included. */
export const CONTINUE_MAX_CALLS = 12;
/** Tokens and the payload they inflate to are bounded before anything is parsed. */
const TOKEN_MAX_CHARS = 16_000;
const INFLATED_MAX_BYTES = 256 * 1024;
const FUTURE_SKEW_MS = 5 * 60 * 1000;
const TOKEN_RE = /^sc1\.([A-Za-z0-9_-]{8,16000})\.([A-Za-z0-9_-]{22})$/;
const LABEL = 'deckpal/simulate/continue/v1';

/** What the totals are about. Two calls may be merged only when these are equal. */
export interface ContinueIdentity {
  /** Fingerprint of the subject's resolved card list (version A in a comparison). */
  subject: string;
  /** Version B's, or null for a plain run. */
  b: string | null;
  /** Each opponent's, in the order played. */
  opponents: string[];
  /** The format the lists were resolved in ('' when no list needed resolving). */
  format: string;
}

export interface ContinueState {
  /** Calls so far, including the one that issued the token. */
  calls: number;
  speed: 'strong' | 'fast';
  seed: number;
  identity: ContinueIdentity;
  /** One per opponent. A plain run has `run`, a comparison `cmp`. */
  run: MatchupTotals[] | null;
  cmp: CompareTotals[] | null;
}

/** The secret continuation is keyed by, or null (continuation off). */
export function continueSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const s = env.DECKE_APPROVAL_SECRET;
  return s && s.length > 0 ? s : null;
}

/** 503 for a request that carries a token on a deployment that cannot verify one. */
export function continuationUnavailable(): ApiError {
  return new ApiError(
    503,
    'continuation_unavailable',
    'Continuing a simulation is switched off on this deployment (its signing secret is not set). Run it again without continue_token.',
  );
}

/** Short stable fingerprint of a card list: the same cards and quantities, whatever the order or how the lines were split. */
export function fingerprintCounts(counts: Array<{ card_id: string; quantity: number }>): string {
  const byCard = new Map<string, number>();
  for (const c of counts) byCard.set(c.card_id, (byCard.get(c.card_id) ?? 0) + c.quantity);
  const text = [...byCard].sort((x, y) => Number(x[0]) - Number(y[0]) || x[0].localeCompare(y[0])).map(([id, q]) => `${id}:${q}`).join(',');
  return createHash('sha256').update(text).digest('base64url').slice(0, 12);
}

/** Which deployment issued a token: Vercel's id when there is one (a deploy may change the engine), else ''. */
export function engineStamp(env: NodeJS.ProcessEnv = process.env): string {
  const id = env.VERCEL_DEPLOYMENT_ID || env.VERCEL_GIT_COMMIT_SHA || '';
  return id ? createHash('sha256').update(id).digest('base64url').slice(0, 8) : '';
}

function keyFor(secret: string): Buffer {
  return createHmac('sha256', secret).update('deckpal/simulate/continue/token-key/v1').digest();
}

/** The signature over a compressed payload, exported so tests can build tokens the real mint would never issue. */
export function macOf(secret: string, userId: string, compressed: Buffer): Buffer {
  return createHmac('sha256', keyFor(secret)).update(LABEL).update('\0').update(userId).update('\0').update(compressed).digest().subarray(0, 16);
}

interface Payload {
  v: number;
  t: number;
  c: number;
  s: 's' | 'f';
  d: number;
  k: 'r' | 'c';
  e: string;
  i: { s: string; b: string | null; o: string[]; f: string };
  a: unknown[];
}

/** Mint a token for the state a call ended in. */
export function mintContinueToken(secret: string, userId: string, state: ContinueState, now: number = Date.now(), env: NodeJS.ProcessEnv = process.env): string {
  const payload: Payload = {
    v: CONTINUE_VERSION,
    t: Math.floor(now),
    c: state.calls,
    s: state.speed === 'fast' ? 'f' : 's',
    d: state.seed,
    k: state.cmp ? 'c' : 'r',
    e: engineStamp(env),
    i: { s: state.identity.subject, b: state.identity.b, o: state.identity.opponents, f: state.identity.format },
    a: state.cmp ? state.cmp.map(compareToWire) : (state.run ?? []).map(totalsToWire),
  };
  const compressed = deflateRawSync(Buffer.from(JSON.stringify(payload)), { level: 9 });
  return `sc1.${compressed.toString('base64url')}.${macOf(secret, userId, compressed).toString('base64url')}`;
}

const REFRESH = 'Start a fresh run (without continue_token).';

/**
 * Verify and read a token for this caller. Throws a 400 whose message says what
 * to do; never returns totals that did not come out of this server's mint.
 */
export function openContinueToken(secret: string, userId: string, token: unknown, now: number = Date.now(), env: NodeJS.ProcessEnv = process.env): ContinueState {
  if (typeof token !== 'string' || token.length > TOKEN_MAX_CHARS) throw badRequest(`continue_token is not a token this simulator issued — pass back exactly what the last response gave. ${REFRESH}`);
  const m = TOKEN_RE.exec(token.trim());
  if (!m) throw badRequest(`continue_token is not a token this simulator issued — pass back exactly what the last response gave. ${REFRESH}`);
  const compressed = Buffer.from(m[1]!, 'base64url');
  const given = Buffer.from(m[2]!, 'base64url');
  const expected = macOf(secret, userId, compressed);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw badRequest(`continue_token failed verification: it was altered, or it was issued to a different account. ${REFRESH}`);
  }
  let payload: Payload;
  try {
    payload = JSON.parse(inflateRawSync(compressed, { maxOutputLength: INFLATED_MAX_BYTES }).toString('utf8')) as Payload;
  } catch {
    throw badRequest(`continue_token could not be read. ${REFRESH}`);
  }
  if (payload.v !== CONTINUE_VERSION) throw badRequest(`continue_token is from a different version of the simulator's token format (${String(payload.v)}, expected ${CONTINUE_VERSION}). ${REFRESH}`);
  if (!Number.isSafeInteger(payload.t) || now - payload.t > CONTINUE_TTL_MS || payload.t - now > FUTURE_SKEW_MS) {
    throw badRequest(`continue_token has expired (a run can be continued for ${CONTINUE_TTL_MS / 3_600_000} hours after its last call). ${REFRESH}`);
  }
  if (payload.e !== engineStamp(env)) throw badRequest(`continue_token was issued before the simulator was last updated, and games from two versions of it must not be added together. ${REFRESH}`);
  if (!Number.isSafeInteger(payload.c) || payload.c < 1) throw badRequest(`continue_token could not be read. ${REFRESH}`);
  if (payload.c >= CONTINUE_MAX_CALLS) throw badRequest(`This run has reached its limit of ${CONTINUE_MAX_CALLS} calls. Read the cumulative result you have, or ${REFRESH.toLowerCase()}`);
  try {
    const id = payload.i;
    if (typeof id?.s !== 'string' || !Array.isArray(id.o) || id.o.some((x) => typeof x !== 'string') || typeof id.f !== 'string') throw new Error('identity');
    if (id.b !== null && typeof id.b !== 'string') throw new Error('identity');
    if (!Number.isSafeInteger(payload.d) || (payload.s !== 's' && payload.s !== 'f') || (payload.k !== 'r' && payload.k !== 'c')) throw new Error('header');
    if (!Array.isArray(payload.a) || payload.a.length !== id.o.length || id.o.length > 16) throw new Error('totals');
    const cmp = payload.k === 'c';
    if (cmp !== (id.b !== null)) throw new Error('kind');
    return {
      calls: payload.c,
      speed: payload.s === 'f' ? 'fast' : 'strong',
      seed: payload.d,
      identity: { subject: id.s, b: id.b, opponents: id.o, format: id.f },
      run: cmp ? null : payload.a.map(totalsFromWire),
      cmp: cmp ? payload.a.map(compareFromWire) : null,
    };
  } catch {
    throw badRequest(`continue_token could not be read. ${REFRESH}`);
  }
}

/**
 * Null when this request is the run the token continues; otherwise a sentence
 * saying what differs. `names` are the request's opponents' display names.
 */
export function identityMismatch(
  token: ContinueState,
  now: { speed: 'strong' | 'fast'; seed: number; identity: ContinueIdentity; names: string[]; subjectName: string; bName: string | null },
): string | null {
  const a = token.identity;
  const b = now.identity;
  const why: string[] = [];
  if (a.subject !== b.subject) why.push(`the deck being tested (${now.subjectName}) has a different card list than in the run`);
  if ((a.b === null) !== (b.b === null)) why.push(a.b === null ? 'the run was a plain run, not a comparison' : 'the run was a paired comparison; pass the same compare_with / compare_cards');
  else if (a.b !== b.b) why.push(`version B (${now.bName ?? 'compare'}) has a different card list than in the run`);
  if (a.opponents.length !== b.opponents.length) why.push(`the run had ${a.opponents.length} opponent${a.opponents.length === 1 ? '' : 's'}, this request has ${b.opponents.length}; pass the same opponents in the same order`);
  else a.opponents.forEach((fp, i) => { if (fp !== b.opponents[i]) why.push(`opponent ${i + 1} (${now.names[i] ?? '?'}) is a different list or a different deck than in the run`); });
  if (a.format !== b.format) why.push('the format differs');
  if (token.speed !== now.speed) why.push(`the run used speed '${token.speed}'`);
  if (token.seed !== now.seed) why.push(`the run used seed ${token.seed}`);
  if (!why.length) return null;
  return `This is not the run continue_token belongs to: ${why.join('; ')}. Results from different decks are never mixed — pass the same inputs, or start a fresh run (without continue_token) after editing a deck.`;
}
