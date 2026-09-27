/**
 * How much conversation one Deck-E request may carry, and how much of it the
 * model is shown.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS (SEC-04, security audit 2026-09-26)
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * The server keeps nothing between requests, so the browser re-POSTs the whole
 * conversation on every leg — and until this file the server took whatever it
 * was sent. `readBody` buffered the body with no cap, the only check was "is
 * `messages` a non-empty array", and `convertToModelMessages` forwarded the lot.
 * The audit's proof carried a 4 MB text part and a PDF `file` part through the
 * pinned SDK's conversion unchanged. Every one of the turn's twelve steps then
 * re-bills that context, against a charge that is FLAT per request — so any
 * account with `decke.use` could buy very large model turns on the owner's key
 * for the price of a small one.
 *
 * Two different limits answer that, and they must not be confused:
 *
 *   REJECT   what no honest browser sends: a body over `BODY_MAX_BYTES`, a
 *            part type the browser never produces (`file`, `reasoning`,
 *            `source-*`, a `system` role), one message larger than a pasted
 *            battle log. 413/400, before the meter, so it costs nothing.
 *   TRIM     what an honest browser does send, a long conversation. The
 *            model is shown the reader's current turn whole and as much recent
 *            history as fits `WINDOW_MESSAGES` / `WINDOW_PRIOR_CHARS`.
 *
 * Trimming is only ever of what the MODEL reads. Every ledger `api/chat.mjs`
 * derives from the replayed history — declines, failing tools, what he already
 * said, the pasted log, research provenance, the charge hash — still reads the
 * whole validated array, so no behaviour that depends on history changes.
 *
 * The browser trims to the same window before it sends
 * (`apps/web/src/character/host/chat/wireWindow.ts`), which is what keeps a
 * long, honest conversation far under the body cap. The constants are MIRRORED
 * there; `wireBounds.test.ts` pins that they agree.
 */
import { z } from 'zod';

/**
 * The largest request body `/api/chat` reads. Past this it answers 413 without
 * parsing.
 *
 * Sized from the largest HONEST body, not the typical one: a pasted battle log
 * (50,000 characters, `add_battle_log`'s own ceiling), a strategy guide held for
 * approval in the same turn (40,000), and the full prior window below — about
 * 155,000 characters, or ~170 KB of JSON. 256 KB leaves room for escaping and
 * multi-byte text without letting a body buy a materially larger turn.
 */
export const BODY_MAX_BYTES = 256 * 1024;

/** Messages one request may carry at all. The window below is much smaller. */
export const MESSAGES_MAX = 200;

/** Parts one message may carry. A six-leg turn with every tool replayed is ~40. */
export const PARTS_MAX = 80;

/**
 * The largest single part: one text part, or one tool part serialised. The
 * paste channel (`pastedLog.ts`) needs a 50,000-character battle log to arrive
 * in one message, and `deck_strategy`'s 40,000-character guide rides in its
 * approval part; this clears both with room for the reader's own words.
 */
export const PART_MAX_CHARS = 60_000;

/** Prior messages (before the reader's current one) the model is shown. */
export const WINDOW_MESSAGES = 24;

/**
 * Characters of prior history the model is shown, about 16k tokens.
 *
 * LARGER THAN `PART_MAX_CHARS` ON PURPOSE. The paste channel's ordinary shape
 * is two turns: the reader pastes a battle log, Deck-E asks whether to log it,
 * the reader says yes. On that "yes" the paste is PRIOR history, and a window
 * smaller than one pasted log would drop it — the next request would carry no
 * log and `extractPastedLog` would have nothing to find.
 */
export const WINDOW_PRIOR_CHARS = 64_000;

/** The page path and each landmark string go into the system prompt. */
export const ROUTE_MAX = 200;
export const LANDMARKS_MAX = 40;
export const LANDMARK_FIELD_MAX = 200;

/** How big a part is, for both budgets: its text, or its JSON. */
export function partChars(part: unknown): number {
  if (part && typeof part === 'object' && (part as { type?: unknown }).type === 'text') {
    const text = (part as { text?: unknown }).text;
    return typeof text === 'string' ? text.length : 0;
  }
  try {
    return JSON.stringify(part)?.length ?? 0;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/**
 * ONLY WHAT THE BROWSER SENDS: text, and the SDK's own `tool-<name>` parts
 * (browser results, replayed failures, approval answers — see
 * `messagesToWire` and `approvalReplay.ts`). A `file` part is the one the audit
 * proved dangerous: the Gateway declares `supportedUrls` for everything, so the
 * provider would fetch an arbitrarily large document Vercel's body cap never
 * sees. Loose objects, because the SDK's parts carry fields (`toolCallId`,
 * `state`, `approval`) this file has no business re-validating.
 *
 * One refinement rather than a union of two part schemas: a union reports an
 * oversized text part as "matched neither", which would lose the difference
 * between a part that is too BIG (413, the reader can fix it) and one that is
 * the wrong KIND (400).
 */
const TOOL_PART = /^tool-[A-Za-z0-9_]{1,64}$/;
const wirePart = z.looseObject({ type: z.string() }).superRefine((part, ctx) => {
  if (part.type === 'text' ? typeof part.text !== 'string' : !TOOL_PART.test(part.type)) {
    ctx.addIssue({ code: 'custom', message: 'only text and tool parts are accepted' });
    return;
  }
  if (partChars(part) > PART_MAX_CHARS) {
    ctx.addIssue({ code: 'too_big', origin: 'string', maximum: PART_MAX_CHARS, inclusive: true, message: 'part too large' });
  }
});

/**
 * `user` and `assistant` only. A `system` message from the browser would be
 * the reader writing Deck-E's instructions, which `convertToModelMessages`
 * would otherwise accept without comment.
 */
const wireMessage = z.looseObject({
  role: z.enum(['user', 'assistant']),
  parts: z.array(wirePart).min(1).max(PARTS_MAX),
});

export const wireMessages = z.array(wireMessage).min(1).max(MESSAGES_MAX);

export type WireMessage = z.infer<typeof wireMessage>;

export type WireVerdict =
  | { ok: true; messages: WireMessage[] }
  | { ok: false; status: 400 | 413; code: string; error: string };

/**
 * Validate the conversation, or say why not in a sentence the browser can show.
 *
 * `too_big` anywhere is a 413 — the request is well formed and simply more than
 * this endpoint reads — and everything else is a 400. The reader never sees a
 * 400 from an honest browser; the 413 is the one a person can actually cause,
 * by pasting something enormous, so its wording is for them.
 */
export function validateWire(messages: unknown): WireVerdict {
  const parsed = wireMessages.safeParse(messages);
  if (parsed.success) {
    if (!parsed.data.some((m) => m.role === 'user')) {
      return { ok: false, status: 400, code: 'invalid_conversation', error: 'messages must include the reader’s own message' };
    }
    return { ok: true, messages: parsed.data };
  }
  const tooBig = parsed.error.issues.find((i) => i.code === 'too_big');
  if (tooBig) {
    // The path says which limit: `[n]` alone is the message COUNT, a deeper
    // path is one part of one message.
    const whole = tooBig.path.length === 0;
    return whole
      ? { ok: false, status: 413, code: 'conversation_too_long', error: 'This conversation is too long for Deck-E to read. Start a new chat.' }
      : { ok: false, status: 413, code: 'message_too_long', error: 'That message is too long for Deck-E to read in one go.' };
  }
  return { ok: false, status: 400, code: 'invalid_conversation', error: 'messages must be text or Deck-E’s own tool records' };
}

/**
 * What the model is shown: the reader's current turn whole, plus as much
 * recent history as fits.
 *
 * THE CURRENT TURN IS NEVER CUT. It is the reader's latest message and every
 * leg after it, and the approval round trip lives at its very end — the SDK's
 * `collectToolApprovals` reads the final parts of the final message, so a
 * window that clipped the turn would silently drop a signed approval.
 *
 * HISTORY IS CUT AT A MESSAGE BOUNDARY, newest kept, and the window then starts
 * on a `user` message, so the model never sees a reply without the question it
 * answered. Tool parts carry their call and result together, so no cut can
 * orphan one half of a pair.
 *
 * A single prior message larger than the whole budget ends the window there
 * rather than being skipped over, so what he sees is always one contiguous run
 * of the conversation and never a transcript with a hole in it.
 */
export function windowForModel<T extends { role: string; parts: unknown[] }>(
  messages: readonly T[],
): { messages: T[]; dropped: number } {
  let current = messages.length - 1;
  while (current >= 0 && messages[current]!.role !== 'user') current--;
  if (current <= 0) return { messages: [...messages], dropped: 0 };

  let start = current;
  let chars = 0;
  while (start > 0 && current - start < WINDOW_MESSAGES) {
    const size = messages[start - 1]!.parts.reduce<number>((n, p) => n + partChars(p), 0);
    if (chars + size > WINDOW_PRIOR_CHARS) break;
    chars += size;
    start--;
  }
  while (start < current && messages[start]!.role !== 'user') start++;
  return { messages: messages.slice(start), dropped: start };
}

/** Dropped replies whose ledger evidence may ride along. MIRRORED in `wireWindow.ts`. */
export const EVIDENCE_MAX = 24;

/**
 * Evidence for the conversation-wide LEDGERS from replies the browser's window
 * dropped: their replayed failures and their lookup record, nothing else.
 *
 * The failing-tool breaker (`failing.ts`) and the already-told record
 * (`toldAlready.ts`) span the whole conversation, and they read exactly those
 * two things. Without this, a tool that failed in two turns and then scrolled
 * out of the window would have its breaker quietly re-closed.
 *
 * ADVISORY, so it fails soft: anything that is not that shape makes the whole
 * field empty rather than failing the request. It never reaches the model —
 * `api/chat.mjs` hands it to the two ledgers and nowhere else — and a browser
 * that omits it only weakens its own breaker, which it could always do.
 */
const evidenceMessages = z
  .array(
    z.object({
      role: z.literal('assistant'),
      parts: z
        .array(
          z.union([
            z.object({ type: z.literal('text'), text: z.string().max(PART_MAX_CHARS) }),
            z.looseObject({ type: z.string().regex(TOOL_PART), state: z.literal('output-error') }),
          ]),
        )
        .min(1)
        .max(PARTS_MAX),
    }),
  )
  .max(EVIDENCE_MAX);

export function boundedEvidence(evidence: unknown): { role: 'assistant'; parts: Record<string, unknown>[] }[] {
  const parsed = evidenceMessages.safeParse(evidence ?? []);
  return parsed.success ? parsed.data : [];
}

/** The page path, clipped rather than refused: it is context, not content. */
export function boundedRoute(route: unknown): string {
  return typeof route === 'string' ? route.slice(0, ROUTE_MAX) : '/';
}

/**
 * The page's landmarks, bounded. The browser already caps the count
 * (`LANDMARK_CAP`), but each entry's strings were unbounded and all of them go
 * into the system prompt of every leg. Entries that are not the shape the
 * prompt reads are dropped, not guessed at.
 */
export function boundedLandmarks(landmarks: unknown): { selector: string; label: string; clickable?: true }[] {
  if (!Array.isArray(landmarks)) return [];
  const out: { selector: string; label: string; clickable?: true }[] = [];
  for (const l of landmarks.slice(0, LANDMARKS_MAX)) {
    if (!l || typeof l.selector !== 'string' || typeof l.label !== 'string') continue;
    out.push({
      selector: l.selector.slice(0, LANDMARK_FIELD_MAX),
      label: l.label.slice(0, LANDMARK_FIELD_MAX),
      ...(l.clickable === true ? { clickable: true as const } : {}),
    });
  }
  return out;
}

/**
 * Read a request body up to `max` bytes, or return null the moment it passes.
 *
 * STREAMED, so an oversized body is refused while it arrives rather than after
 * it has been buffered in full — the buffering was the first half of the
 * finding. The caller answers 413; nothing else about the request is read.
 */
export async function readBodyCapped(
  chunks: AsyncIterable<Uint8Array | string>,
  max: number = BODY_MAX_BYTES,
): Promise<Buffer | null> {
  const parts: Buffer[] = [];
  let size = 0;
  for await (const chunk of chunks) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk);
    size += buf.length;
    if (size > max) return null;
    parts.push(buf);
  }
  return Buffer.concat(parts);
}
