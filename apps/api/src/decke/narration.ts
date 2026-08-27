/**
 * Tool syntax that reached the reader as prose, removed.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * A STRIPPING PASS, WHICH THIS CODEBASE ARGUES AGAINST — AND WHY ANYWAY
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * `decke/tools.ts` says, correctly, that the model never seeing command syntax
 * as text is "a structural property of this design, not a filter bolted on
 * afterwards": it calls a tool, and the TOOL does the writing, so there is no
 * inline syntax to leak and no stripping pass to get wrong.
 *
 * That property holds for the DESIGN. It does not hold for the MODEL. Measured
 * on the deployed preview, asked to add 4000 of a card, he emitted this as
 * ordinary text, on screen, in his speech bubble:
 *
 *     <express><commands><op>state</op><value>alert_dizzy</value></commands></express>
 *
 * Zero `data-decke` chunks were produced, so THE REACTION NEVER FIRED. He
 * described the gesture instead of making it — a character reading his own
 * stage directions aloud while standing perfectly still. The prompt forbids
 * this in two places and he did it anyway, which is exactly why this codebase
 * says twice that a prompt is not an enforcement mechanism.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * WHAT THIS DOES NOT FIX
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * The animation still does not fire. This removes what the reader sees, not the
 * cause. The cause looks like tool-set size: the bake-off that measured this
 * model at 100% clean on every metric gave it about ten tools, and it now holds
 * thirty-four. Confirming that needs a measurement rather than a guess, and it
 * is recorded in DECISIONS.md as the next thing to measure.
 *
 * So this is a mitigation, and saying so is the point. It stops the reader
 * seeing markup; it does not make him a better agent.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * AND IT MISSES THE COMMONEST SHAPE, WHICH IT MUST
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Measured while diagnosing the movement defect: FOUR of five failures were not
 * markup at all. They were bare prose —
 *
 *     flyTo [data-decke-goal-switcher] point=true
 *
 * — which reaches the reader's bubble intact, and always will. There is no
 * pattern that catches it and does not also catch him legitimately saying "you
 * can use the goal switcher", because at the level of characters on a screen
 * those two are the same thing. A filter aggressive enough to strip the first
 * would eat sentences he is supposed to say.
 *
 * This is the boundary of what a stripping pass can do, stated so nobody
 * concludes from its existence that narration is handled. It is not. The only
 * thing that fixed the underlying behaviour was changing the model: with the
 * identical prompt and the identical 34 tools, the incumbent called `flyTo`
 * 1/10 and the successor 10/10, and five separate prompt rewrites moved the
 * incumbent 0/5 each. See `models.ts`.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * DELIBERATELY NARROW
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Anchored on OUR OWN tool names in every form it matches. A general markup
 * filter WOULD be the "stripping pass to get wrong" that `tools.ts` warns
 * about: card names contain angle brackets, prices contain `<`, and a filter
 * that eats those is worse than the problem. `<b>` survives.
 * `10% < 15%` survives. `<input name="email">` survives.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * AND NARROW IS NOT THE SAME AS FROZEN
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * This constant used to be a literal, and its comment used to say "OUR SEVEN
 * tool names" — which was true when it was written and false eight months
 * later. `journey` and `escort` were added to `buildTools`, nobody came back
 * here, and a filter whose entire job is to catch leaked tool syntax stopped
 * catching two of the nine kinds. Nothing failed: no type error, no test, no
 * log line. The only symptom was a reader seeing `<journey>…</journey>` in a
 * speech bubble, which is exactly the defect this file exists to remove.
 *
 * So it is DERIVED, not written. Adding a tool to `buildTools` extends this
 * automatically, and `tools.test.ts` pins `COSMETIC_TOOLS` to the tools that
 * factory actually returns — while `narration.test.ts` goes the other way and
 * asserts every key of `buildTools(…)` is stripped in all three shapes, reading
 * the registry rather than the constant. A count in a comment cannot go stale
 * if there is no count in the comment.
 *
 * ── AND THE OTHER 27 ARE HERE TOO, IN ONE SHAPE ONLY ───────────────────────
 *
 * The 23 data tools and the 4 deep tools are model-callable and can leak the
 * same way. An earlier pass left them out ENTIRELY, on the grounds that their
 * names are ordinary English — `decks`, `lists`, `health`, `revert` — and the
 * attribute rule strips a whole element on a bare `name="…"` match, so
 * including them would eat `<input name="decks">`.
 *
 * That reasoning is right about the ATTRIBUTE form and wrong as a reason to
 * exclude them altogether, because the two forms do not carry the same risk.
 * `<decks>` is not a thing prose contains: a model discussing decks writes the
 * word, not the word in angle brackets — and this filter already strips
 * `<express>` and `<click>`, words at least as ordinary, on exactly that
 * reasoning. So they are matched as ELEMENT NAMES and never as `name="…"`.
 * See `ELEMENT_ONLY_TAGS`. `<input name="decks">` still survives, and is a test.
 */

import { allTools } from '@deckpal/agent-tools';
import { COSMETIC_TOOLS, DEEP_TOOLS } from './tools.js';

/**
 * Names matched in EVERY shape, including the `name="…"` attribute form. The
 * nine cosmetic tools — the ones the model has actually been caught leaking.
 */
const TOOL_TAGS = COSMETIC_TOOLS.join('|');

/**
 * Names matched as an ELEMENT NAME ONLY — never as a `name="…"` attribute.
 *
 * ── WHY THESE ARE A SEPARATE LIST AND NOT SIMPLY ADDED ABOVE ────────────────
 *
 * The 23 data tools and 4 deep tools are model-callable and can leak the same
 * way, but their names are ordinary English: `decks`, `lists`, `health`,
 * `revert`. The attribute rule strips a WHOLE ELEMENT on a bare `name="…"`
 * match, so folding these into `TOOL_TAGS` would eat `<input name="decks">` and
 * anything else legitimately carrying one of those words as a field name. That
 * is the "stripping pass to get wrong" `tools.ts` warns about, and it is why an
 * earlier pass left them out altogether.
 *
 * But out-altogether was too much. The ELEMENT form carries no such risk:
 * `<decks>` is not a thing prose contains. A model discussing decks writes the
 * word, not the word in angle brackets — and this filter already strips
 * `<express>` and `<click>`, words at least as ordinary, on exactly that
 * reasoning. So the leak is caught in the shape it actually arrives in, and the
 * ambiguous shape is left alone.
 *
 * Derived, not written: `allTools()` is the same registry the MCP server and
 * Deck-E both serve, and `DEEP_TOOLS` is pinned to `buildDeepTools` by its own
 * test. Adding a tool anywhere extends this with nowhere else to remember.
 */
const ELEMENT_ONLY_TAGS = [...allTools().map((t) => t.name), ...DEEP_TOOLS].join('|');

/** Every name, for the two positions that match an element by its own name. */
const ANY_TOOL_TAGS = `${TOOL_TAGS}|${ELEMENT_ONLY_TAGS}`;

/**
 * ── THE THREE SHAPES, BECAUSE MATCHING ON TAG NAME WAS NOT ENOUGH ───────────
 *
 * The first version of this file matched `<express>`, `<flyTo>` and friends as
 * ELEMENT NAMES. The gate suite then caught two forms that walk straight past
 * that, both verbatim from the deployed preview:
 *
 *   <function_call name="flyTo">          <- the tool name is an ATTRIBUTE
 *     <parameter name="selector">…</parameter>
 *   </function_call>
 *
 *   <xai:showScreen>…</xai:showScreen>    <- NAMESPACE prefix defeats `<name\b`
 *
 * Both reached the reader. The first one also meant the flight never happened —
 * zero tools on the wire, and a gate failed for it.
 *
 * The lesson is the one this whole effort keeps relearning: a filter written
 * against the shape you HAPPENED TO SEE is a filter that catches that shape.
 * The model is not emitting our tag names, it is emitting whatever
 * function-call syntax its training suggests, and there are more spellings of
 * that than anyone will enumerate.
 *
 * So match the SHAPE: an element whose name is one of ours, ANY namespace
 * prefix allowed; or an element that carries `name="<one of ours>"` as an
 * attribute, whatever the element is called. Still narrow — it is anchored on
 * OUR OWN names either way — so `<b>` and `10% < 15%` survive, which the
 * tests check.
 *
 * ── AND WHY THE ALTERNATION IS SAFE TO EXTEND ──────────────────────────────
 *
 * `TOOL_TAGS` is joined into all four regexes below with no escaping pass, so
 * two properties have to hold of every name in it, and both are tested:
 *
 *   - No regex metacharacter. `narration.test.ts` asserts the shape of every
 *     name `buildTools` returns; a tool called `get*` would widen these
 *     patterns rather than fail loudly.
 *   - No prefix shadowing. A regex alternation is FIRST-MATCH, so a set
 *     containing both `go` and `goTo` would match `go` inside `<goTo>` — except
 *     that every use below follows the alternation with `\b`, or with the
 *     closing quote of a `name="…"`, which forces the backtrack to the longer
 *     name. `<journeyman>` survives for the same reason, and is a test.
 */
const NS = '(?:[A-Za-z_][\\w.-]*:)?';
const NAMED = `name\\s*=\\s*["'](?:${TOOL_TAGS})["']`;

/** A whole element — opening tag through closing tag, content included. */
const TOOL_ELEMENT = new RegExp(
  [
    // <express …>…</express>, <xai:express …>…</xai:express>
    `<(${NS}(?:${ANY_TOOL_TAGS}))\\b[^>]*>[\\s\\S]*?</\\1\\s*>`,
    // <function_call name="flyTo">…</function_call>, any element name
    `<(${NS}[\\w.-]+)\\b[^>]*${NAMED}[^>]*>[\\s\\S]*?</\\2\\s*>`,
  ].join('|'),
  'gi',
);

/** A stray tag with no partner: the tail of a truncated emission. */
const TOOL_TAG = new RegExp(
  `</?${NS}(?:${ANY_TOOL_TAGS})\\b[^>]*>|</?${NS}[\\w.-]+\\b[^>]*${NAMED}[^>]*>`,
  'gi',
);

/**
 * `<parameter …>` and `</parameter>` — the scaffolding INSIDE the forms above.
 *
 * Removed only after an element has been stripped, never on its own: a card
 * could plausibly be discussed with the word "parameter" in a sentence, and
 * this must not become a general markup filter. See `removeElements`.
 */
const PARAMETER_TAG = new RegExp(`</?${NS}parameter\\b[^>]*>`, 'gi');
/** An OPENING tool tag. After complete elements are removed, one of these means
 *  an element is still in progress and everything after it must be held. */
const OPEN_TAG = new RegExp(`^<${NS}(?:${ANY_TOOL_TAGS})\\b|^<${NS}[\\w.-]+\\b[^>]*${NAMED}`, 'i');

/**
 * The earliest point from which text must be held back, or -1.
 *
 * THE FIRST CANDIDATE, NOT THE LAST — and getting that wrong is the whole
 * subtlety. An earlier version held from `pending.lastIndexOf('<')`, so given
 * `<express><comm` it released `<express>` and held `<comm`: the opening tag
 * went straight to the reader and the buffer dutifully guarded the fragment
 * after it.
 *
 * Two things qualify: a complete opening tag of ours, and ANY tag that has not
 * been closed yet — see the second case below for why the net is that wide.
 */
function holdFrom(s: string): number {
  for (let i = s.indexOf('<'); i !== -1; i = s.indexOf('<', i + 1)) {
    const frag = s.slice(i);

    // A complete opening tag of ours — by name, or by a `name="..."` attribute.
    // Complete ELEMENTS were already removed, so one still standing means its
    // closing tag has not arrived yet.
    if (OPEN_TAG.test(frag)) return i;

    // ── ANY UNCLOSED TAG IS HELD, WHATEVER IT IS CALLED ────────────────────
    //
    // The attribute form forced this, and it looks over-broad until you try the
    // alternative. `<function_call na` cannot be judged yet: the attribute that
    // condemns it — `name="express"` — has not arrived. Releasing it now is
    // IRREVERSIBLE, because once words are on the reader's screen no later
    // chunk can take them back, and that is exactly how the split-delta case
    // slipped through.
    //
    // So an unclosed tag of any name waits for its `>`, at which point
    // `OPEN_TAG` and `TOOL_ELEMENT` decide properly. The cost is bounded and
    // small: `<b` is held only until the rest of the tag arrives, usually in
    // the same chunk, and prose with no `<` in it is never held at all — which
    // is nearly all prose.
    if (!frag.includes('>')) return i;
  }
  return -1;
}

/**
 * Incremental, because a delta is not a sentence.
 *
 * `<express>` can arrive in one chunk and `</express>` three chunks later, so a
 * per-delta regex would strip the tags and stream the innards — turning one
 * visible defect into a subtler one. This holds text only as far as the last
 * `<` that could still begin a tool tag, and releases everything before it at
 * once. Ordinary prose therefore streams with no added latency; the only pause
 * is when the model has started writing something it should not.
 */
export function createNarrationFilter(): {
  push(text: string): string;
  end(): string;
  stripped(): boolean;
} {
  let pending = '';
  let didStrip = false;

  const removeElements = (): void => {
    const before = pending;
    pending = pending.replace(TOOL_ELEMENT, '');
    if (pending !== before) {
      didStrip = true;
      // ONLY once an element was actually removed. `<parameter>` is scaffolding
      // that lives inside the forms above; stripping it unconditionally would
      // make this a general markup filter, which is the thing `tools.ts` warns
      // against and which would eat a card name.
      pending = pending.replace(PARAMETER_TAG, '');
    }
  };

  return {
    push(text: string): string {
      pending += text;
      removeElements();
      const at = holdFrom(pending);
      const out = at === -1 ? pending : pending.slice(0, at);
      pending = at === -1 ? '' : pending.slice(at);
      return out;
    },

    end(): string {
      removeElements();
      // Nothing more is coming, so an unclosed tag stays unclosed. Drop the
      // tags and KEEP the words between them rather than swallowing a
      // half-sentence — the reader losing his last clause is a worse outcome
      // than seeing a stray word.
      const before = pending;
      pending = pending.replace(TOOL_TAG, '');
      if (pending !== before) didStrip = true;
      const out = pending;
      pending = '';
      return out;
    },

    stripped(): boolean {
      return didStrip;
    },
  };
}

/**
 * The filter as a stream transform: the part of it that was NOT tested.
 *
 * This lived inline in `api/chat.mjs`, which is a Vercel function — untyped,
 * unimportable, and driven only by a live deployment. `createNarrationFilter`
 * below it had nine tests; the code that decides WHEN to push and WHEN to flush
 * had none, and that is where the ordering bugs are. It is here now because
 * `chat.mjs` already said the algorithm and the reasoning live in this file,
 * and only half of it did.
 *
 * ── WHY THE TAIL NEEDS AN ID ────────────────────────────────────────────────
 *
 * The filter holds text back — a partial `<exp` might be the start of a tool
 * tag — so at the end of a text run it is holding words that have to be
 * released as their own part. A `text-delta` in this format belongs to a block
 * opened by a `text-start` with the SAME id. The first version used a literal
 * `id: 'narration'`, which names a block nothing ever opened: an orphan delta.
 * Our own reader concatenates deltas and never looks, so it worked in
 * production and would have kept working — but `readUIMessageStream` and
 * anything else conformant drops it, and the part it drops is the tail of a
 * real sentence. So the live id is tracked and the flush goes out under it.
 *
 * The flush also has to happen BEFORE the part that triggered it. A tail
 * released after its own `text-end` is out of order and, again, orphaned.
 */
export function stripToolSyntax<T extends { type?: string; id?: string; delta?: string }>(
  stream: ReadableStream<T>,
  onStrip?: () => void,
): ReadableStream<T> {
  const filter = createNarrationFilter();
  let warned = false;
  const warnOnce = () => {
    if (warned || !filter.stripped()) return;
    warned = true;
    onStrip?.();
  };
  // The id of the text block currently open upstream, or null between blocks.
  let textId: string | null = null;

  const flushTail = (controller: TransformStreamDefaultController<T>) => {
    const tail = filter.end();
    warnOnce();
    if (!tail) return;
    // Only reachable when no block is open, which in practice cannot happen —
    // the filter has nothing to hold unless text was pushed into it. Open and
    // close a real block rather than emit an orphan.
    if (textId == null) {
      controller.enqueue({ type: 'text-start', id: NARRATION_ID } as unknown as T);
      controller.enqueue({ type: 'text-delta', id: NARRATION_ID, delta: tail } as unknown as T);
      controller.enqueue({ type: 'text-end', id: NARRATION_ID } as unknown as T);
      return;
    }
    controller.enqueue({ type: 'text-delta', id: textId, delta: tail } as unknown as T);
  };

  return stream.pipeThrough(
    new TransformStream<T, T>({
      transform(part, controller) {
        if (part?.type === 'text-start' && part.id != null) textId = part.id;
        if (part?.type === 'text-delta' && typeof part.delta === 'string') {
          if (part.id != null) textId = part.id;
          const out = filter.push(part.delta);
          warnOnce();
          if (out) controller.enqueue({ ...part, delta: out });
          return;
        }
        // A non-text part ends the text run: release what is held, so words
        // never sit behind a panel or a command.
        flushTail(controller);
        if (part?.type === 'text-end') textId = null;
        controller.enqueue(part);
      },
      flush(controller) {
        flushTail(controller);
      },
    }),
  );
}

/** The id used only for a tail with no block to belong to. See above. */
const NARRATION_ID = 'narration';
