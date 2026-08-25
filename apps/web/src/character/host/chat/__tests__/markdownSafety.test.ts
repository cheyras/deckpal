/**
 * The URL allowlist is the one part of the markdown renderer that an attacker
 * gets to aim at.
 *
 * Everything Deck-E writes is model output, and the model reads card names,
 * deck descriptions and list names other people typed. A link in his reply is
 * therefore reachable from someone else's text, which makes this a security
 * boundary and not a formatting preference — so it is tested rather than
 * eyeballed.
 */
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { chatUrlTransform } from '../../../../lib/markdownSafety'

test('the three protocols a chat link may use are allowed, in any case', () => {
  for (const url of [
    'https://deckpal.app/decks/12',
    'http://example.com',
    'HTTPS://DECKPAL.APP',
    'MailTo:someone@example.com',
  ]) {
    assert.equal(chatUrlTransform(url), url, `${url} should survive`)
  }
})

test('every scripting and data protocol is refused', () => {
  for (const url of [
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'vbscript:msgbox(1)',
    'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
    'blob:https://deckpal.app/2f6b',
    'file:///etc/passwd',
  ]) {
    assert.equal(chatUrlTransform(url), '', `${url} must be blanked`)
    assert.equal(chatUrlTransform(url), '')
  }
})

test('protocols react-markdown allows by default but a card tracker has no use for', () => {
  // `defaultUrlTransform` permits these. We are deliberately stricter: each one
  // hands a URL to an external protocol handler.
  for (const url of ['irc://irc.example.com/#chan', 'ircs://irc.example.com', 'xmpp:someone@example.com', 'tel:+15551234']) {
    assert.equal(chatUrlTransform(url), '', `${url} must be blanked`)
  }
})

test('the whitespace-in-the-protocol trick does not get through', () => {
  // A parser that strips control characters before reading the protocol would
  // approve these. Reading the protocol by colon INDEX is what refuses them.
  assert.equal(chatUrlTransform('java\nscript:alert(1)'), '')
  assert.equal(chatUrlTransform('java\tscript:alert(1)'), '')
  assert.equal(chatUrlTransform(' javascript:alert(1)'), '')
})

test('relative URLs survive, because they can only address this app', () => {
  for (const url of ['/decks/12', '#top', 'cards/base1-4', './x', '?q=1']) {
    assert.equal(chatUrlTransform(url), url)
  }
})

test('a colon inside the path, query or fragment is not a protocol', () => {
  assert.equal(chatUrlTransform('/search?q=a:b'), '/search?q=a:b')
  assert.equal(chatUrlTransform('/a/b:c'), '/a/b:c')
  assert.equal(chatUrlTransform('#a:b'), '#a:b')
})

test('an empty href is not a safe URL', () => {
  assert.equal(chatUrlTransform(''), '')
  assert.equal(chatUrlTransform(''), '')
})
