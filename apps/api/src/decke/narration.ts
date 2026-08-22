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
 * DELIBERATELY NARROW
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Only the seven tool names, as elements. A general markup filter WOULD be the
 * "stripping pass to get wrong" that `tools.ts` warns about: card names contain
 * angle brackets, prices contain `<`, and a filter that eats those is worse
 * than the problem. `<b>` survives. `10% < 15%` survives.
 */

const TOOL_TAGS = 'express|showScreen|flyTo|goTo|highlight|scrollToMe|click';

/** A whole element — opening tag through closing tag, content included. */
const TOOL_ELEMENT = new RegExp(`<(${TOOL_TAGS})\\b[^>]*>[\\s\\S]*?</\\1>`, 'gi');
/** A stray tag with no partner: the tail of a truncated emission. */
const TOOL_TAG = new RegExp(`</?(?:${TOOL_TAGS})\\b[^>]*>`, 'gi');
/** An OPENING tool tag. After complete elements are removed, one of these means
 *  an element is still in progress and everything after it must be held. */
const OPEN_TAG = new RegExp(`^<(?:${TOOL_TAGS})\\b`, 'i');
const NAMES = TOOL_TAGS.split('|');

/**
 * The earliest point from which text must be held back, or -1.
 *
 * THE FIRST CANDIDATE, NOT THE LAST — and getting that wrong is the whole
 * subtlety. An earlier version held from `pending.lastIndexOf('<')`, so given
 * `<express><comm` it released `<express>` and held `<comm`: the opening tag
 * went straight to the reader and the buffer dutifully guarded the fragment
 * after it.
 *
 * Two things qualify. A complete opening tag of a tool, because complete
 * ELEMENTS have already been removed, so one still standing means its closing
 * tag has not arrived yet. And a trailing fragment that is a proper prefix of
 * some tool tag — `<expr`, `</showS`, or a bare `<` — because the next chunk
 * may complete it.
 */
function holdFrom(s: string): number {
  for (let i = s.indexOf('<'); i !== -1; i = s.indexOf('<', i + 1)) {
    const frag = s.slice(i);
    if (OPEN_TAG.test(frag)) return i;
    // Only the TAIL can be an incomplete fragment; a `<` with more text after
    // it that did not match above is ordinary prose ("10% < 15%").
    if (!/^<\/?[A-Za-z]*$/.test(frag)) continue;
    const bare = frag.replace(/^<\/?/, '').toLowerCase();
    if (NAMES.some((n) => n.toLowerCase().startsWith(bare))) return i;
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
    if (pending !== before) didStrip = true;
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
