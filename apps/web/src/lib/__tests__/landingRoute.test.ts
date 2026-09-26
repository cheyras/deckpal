/**
 * SEC-05 — the `?next=` open redirect, and the fix's whole bypass corpus.
 *
 * The old `isSafeNextPath` was a blocklist (`startsWith('/')`, not `//`, not
 * `/\`), and `/\t/evil.example/phish` walked straight through it: `startsWith`
 * sees a tab, not a slash. `window.location.assign()` then handed the same
 * string to the WHATWG URL parser, which strips tab/newline/CR before
 * resolving, so the value became `//evil.example/phish` and then a real
 * cross-origin navigation — verified with `new URL(...)` directly (see the
 * comment block below, which is exactly the security audit's repro).
 *
 * `safeNextPath` replaces the blocklist with one parse: `new URL(value,
 * origin)` plus an origin comparison, preceded by a reject-list of the
 * characters the parser's own pre-processing treats specially (control and
 * whitespace characters, and `\`, which browsers resolve as `/` for special
 * schemes — see the "literal backslash" cases below). Every case here is
 * either the auditor's own payload, the classic open-redirect list SEC-05
 * asked to cover, or a case this test file found while probing the parser's
 * actual behaviour (documented inline; verified against `new URL` directly,
 * not assumed from memory).
 *
 * A fixed test origin is passed explicitly throughout (`safeNextPath`'s
 * second parameter) so this suite runs under Node's plain `--test` runner,
 * with no DOM and no `window` — the same convention the rest of `lib/__tests__`
 * uses for pure functions.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { safeNextPath, isSafeNextPath } from '../landingRoute.ts'

const ORIGIN = 'https://deckpal.app'
const safe = (v: unknown) => safeNextPath(v, ORIGIN)

test('the auditor\'s exact SEC-05 payload is rejected', () => {
  // Repro, run directly against the platform parser this fix relies on:
  //   new URL('/\t/evil.example/phish', 'https://deckpal.app').href
  //   → 'https://evil.example/phish'
  // i.e. the tab is what turns one leading slash into the two that make a
  // protocol-relative URL. The old blocklist never saw it coming because it
  // pattern-matched the STRING, not what the parser does with it.
  assert.equal(safe('/\t/evil.example/phish'), null)
})

test('a decoded %09 (or any control character) anywhere in the value is rejected', () => {
  // By the time `next` reaches this function it has already been through one
  // round of query-string decoding (TanStack's `validateSearch`), so `%09` in
  // the URL bar is a real tab character in the JS string here — exactly the
  // case above, just arriving by the encoded route the audit described.
  assert.equal(safe('/\t/evil.example'), null)
  assert.equal(safe('/lists/\t'), null)
  assert.equal(safe('/\n/evil.example'), null) // newline — same parser behaviour as tab
  assert.equal(safe('/\r/evil.example'), null) // CR — same
  assert.equal(safe('/\u0000/x'), null) // NUL
  assert.equal(safe('/lists\u0000'), null) // control char anywhere, not just leading
  assert.equal(safe('/\u007f/x'), null) // DEL
})

test('whitespace that is not a control character is rejected too', () => {
  // The task's own spec says "control AND whitespace" — a literal space is
  // not a control character but is still whitespace, and the task's fix list
  // groups it with tab/newline/CR rather than carving out an exception for it.
  assert.equal(safe('/lists /x'), null)
  assert.equal(safe(' /evil.example'), null) // doesn't even start with '/'
})

test('a literal backslash is rejected — browsers treat it as a slash', () => {
  // DECISIONS 2026-08-10 already fixed the simple `/\evil.com` case; this
  // pins the same family. Verified directly: `new URL('/\\t/x', origin)`
  // (an ACTUAL backslash followed by the letter t, not an escaped tab)
  // resolves to origin `https://t` — the backslash is read as a path
  // separator, turning "t" into a hostname. Rejecting every `\` up front
  // closes this without needing to reason about which position is exploitable.
  assert.equal(safe('/\\evil.example'), null)
  assert.equal(safe('/\\t/x'), null)
  assert.equal(safe('/lists/\\/x'), null)
})

test('protocol-relative and absolute URLs are rejected', () => {
  assert.equal(safe('//evil.example'), null)
  assert.equal(safe('///evil.example'), null)
  assert.equal(safe('https://evil.example'), null)
  assert.equal(safe('http://evil.example'), null)
  assert.equal(safe('https://evil.example/lists'), null) // a real path, wrong origin
})

test('a non-http(s) scheme is rejected — it never starts with "/"', () => {
  assert.equal(safe('javascript:alert(1)'), null)
  assert.equal(safe('data:text/html,<script>alert(1)</script>'), null)
})

test('non-string, empty, and missing values are rejected', () => {
  assert.equal(safe(undefined), null)
  assert.equal(safe(null), null)
  assert.equal(safe(''), null)
  assert.equal(safe(42), null)
  assert.equal(safe(['/lists']), null)
})

test('an already-percent-encoded control character stays same-origin and is accepted', () => {
  // `%2509` (a literal percent sign, then "2509" as text) is what DOUBLE
  // encoding a tab looks like — it decodes to the *text* `%09`, not a real
  // tab, on the one decode pass query-string parsing performs. The WHATWG
  // parser does not decode a second time, so this is an ordinary same-origin
  // path, not a bypass: `location.assign` would stay on deckpal.app.
  assert.equal(safe('/%2509/x'), '/%2509/x')
})

test('a real same-origin path, with query and hash, round-trips', () => {
  assert.equal(safe('/lists'), '/lists')
  assert.equal(safe('/lists/8f14e-uuid'), '/lists/8f14e-uuid')
  assert.equal(safe('/series/scarlet-violet/sv03.5/6'), '/series/scarlet-violet/sv03.5/6')
  assert.equal(safe('/lists?a=1#b'), '/lists?a=1#b')
  assert.equal(safe('/'), '/')
})

test('isSafeNextPath agrees with safeNextPath — one predicate, not two', () => {
  assert.equal(isSafeNextPath('/lists', ORIGIN), true)
  assert.equal(isSafeNextPath('/\t/evil.example', ORIGIN), false)
  assert.equal(isSafeNextPath('//evil.example', ORIGIN), false)
  assert.equal(isSafeNextPath(undefined, ORIGIN), false)
})
