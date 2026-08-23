/**
 * What MODEL-WRITTEN MARKDOWN is allowed to turn into.
 *
 * A DOM-free module so it can be tested with `node --test`. It lives in `lib`
 * rather than beside the chat because it has two callers and they are in
 * different features: `character/host/chat/ChatMarkdownBody.tsx` renders a chat
 * turn, and `routes/deck/MarkdownView.tsx` renders a deck strategy guide —
 * which Deck-E's own `deck_strategy` tool writes. Both are the same problem
 * wearing different clothes, and the second one had gone unnoticed.
 *
 * ── THE THREAT, STATED PLAINLY ───────────────────────────────────────────────
 *
 * Everything rendered here is model output, and the model reads card names,
 * deck descriptions, list names and set text — strings other people typed and
 * strings that arrived from an upstream catalog. Every one of them is
 * attacker-influenceable. So "the model would not write that" is not a control;
 * the renderer is the control.
 *
 * ── WHAT IS ALLOWED, AND WHY ─────────────────────────────────────────────────
 *
 *  1. **No raw HTML becomes markup.** `react-markdown` does not run
 *     `rehype-raw`, so an `<img onerror=…>` in the model's text is converted to
 *     a hast `raw` node and then to a TEXT node — it is displayed as the literal
 *     characters `<img onerror=…>`, never parsed. This is exactly what
 *     `routes/deck/MarkdownView.tsx` already relies on. We deliberately do NOT
 *     pass `skipHtml: true`, which would delete it instead: showing the reader
 *     what the model actually wrote is honest, and it is equally safe.
 *
 *  2. **Links: a stricter protocol allowlist than the library's.**
 *     `defaultUrlTransform` permits `http`, `https`, `irc`, `ircs`, `mailto` and
 *     `xmpp`. `chatUrlTransform` below permits `http`, `https` and `mailto`
 *     only. `irc:` and `xmpp:` hand a URL to an external protocol handler and
 *     have no business in a collection tracker's chat; `javascript:`, `data:`,
 *     `blob:`, `file:` and `vbscript:` were already blocked and stay blocked.
 *     Relative URLs (`/decks/12`, `#anchor`) are still allowed — they can only
 *     address this app.
 *
 *  3. **No remote images at all.** `MarkdownView` has no `img` in its component
 *     map, so `![](https://evil.example/p.gif)` in a deck strategy renders a
 *     real remote `<img>`. In chat that is a tracking beacon that fires on
 *     render and leaks the reader's IP and referrer to whoever got a string into
 *     the model's context. `ChatMarkdownBody` maps `img` to a text placeholder,
 *     so no URL the model produced ever reaches a `src`. This is the one place
 *     this module is deliberately STRICTER than the prior art rather than equal
 *     to it. Real card art gets to the transcript through `CardRow`, which
 *     resolves ids against our own catalog endpoint — the same discipline
 *     `DeckeScreen`'s `cardGrid` already documents.
 *
 *  4. **Every link opens in a new tab with no referrer**, matching
 *     `MarkdownView`. `rel="noreferrer"` implies `noopener`; both are written
 *     out anyway because the implication is a spec detail and this is a
 *     security-relevant line someone will read in a hurry.
 */

/**
 * Protocols a link in a chat message may use.
 *
 * A subset of react-markdown's own `safeProtocol` — see (2) above.
 */
const SAFE_PROTOCOL = /^(https?|mailto)$/i

/**
 * Make a URL safe, or return `''` for "this is not a URL you may have".
 *
 * The colon-position test is lifted from `defaultUrlTransform`: a URL whose
 * first `:` comes after the first `/`, `?` or `#` has no protocol at all and is
 * therefore relative. Doing it by index rather than by parsing is what makes
 * `java\nscript:alert(1)` fail — the protocol it extracts contains a newline,
 * which the allowlist rejects, where a lenient parser would strip the newline
 * first and then approve it.
 *
 * An empty string is the library's own signal for "drop this href", so callers
 * get `<a href="">`; `ChatMarkdownBody` additionally renders such a link as
 * plain text rather than as a dead anchor.
 */
export function chatUrlTransform(value: string): string {
  const url = String(value ?? '')
  const colon = url.indexOf(':')
  const questionMark = url.indexOf('?')
  const numberSign = url.indexOf('#')
  const slash = url.indexOf('/')

  if (
    // No colon anywhere: relative, and relative can only mean this app.
    colon === -1 ||
    // The colon is inside the path, the query or the fragment, so it is not a
    // protocol separator.
    (slash !== -1 && colon > slash) ||
    (questionMark !== -1 && colon > questionMark) ||
    (numberSign !== -1 && colon > numberSign)
  ) {
    return url
  }

  return SAFE_PROTOCOL.test(url.slice(0, colon)) ? url : ''
}

/** True when `chatUrlTransform` would keep the URL. Convenience for callers. */
export function isSafeChatUrl(value: string): boolean {
  return chatUrlTransform(value) !== ''
}
