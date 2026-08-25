/**
 * DEFECT 1, pinned: "shows a card, but it's a placeholder one rather than
 * being the actual card the user asked about."
 *
 * The root cause was two dead ends in `apply()`, the last-mile function that
 * turns a server-validated `express` command into an engine call:
 * `case 'cardArt':` did nothing at all ("nothing to do here until PR 5 wires
 * the card source through"), and `case 'state'`'s `card_stash` branch read
 * `cards` only for its LENGTH, via `decke.setStashCount`, never resolving the
 * named ids into art. `decke.setCardArt` and `decke.setStashCards` were never
 * called anywhere in the file.
 *
 * `useDeckeChat.ts` cannot be imported here — like every other file it shares
 * a directory with, it reaches `import.meta.env` at module scope via
 * `../../lib/supabase`, so `apply` cannot be called directly and exercised
 * against a fake `DeckEInstance`. These are SOURCE PINS, in the same style
 * `noticeWiring.test.ts` and `sourceSync.test.ts` already use for this exact
 * file: they read it as text and check the wiring, which is the half of a
 * fix like this one that has repeatedly gone missing in this codebase without
 * ever failing a type check.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const HOOK = readFileSync(fileURLToPath(new URL('../useDeckeChat.ts', import.meta.url)), 'utf8')

/** The file with block and line comments stripped, so an assertion reads the
 *  CODE's claim rather than a comment saying the same words — the same
 *  precaution `sourceSync.test.ts` takes on this file for the same reason. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

test('cardArt is no longer a no-op: it resolves the id and puts it on the slot', () => {
  const c = code(HOOK)
  assert.doesNotMatch(
    c,
    /case 'cardArt':\s*\n\s*break/,
    'cardArt is back to a bare `break` — the placeholder-card defect is live again',
  )
  assert.match(
    c,
    /const \[art\] = await artForIds\(\[c\.card\], signal\)/,
    'cardArt no longer resolves the requested id through the shared catalog resolver',
  )
  assert.match(
    c,
    /decke\.setCardArt\(c\.slot, art\)/,
    'a resolved card is no longer actually placed on the slot',
  )
})

test('cardArt REJECTS an id the catalog does not know, rather than clamping to a placeholder', () => {
  // Order matters for this assertion, not just presence: the warning and the
  // `break` must come BEFORE `setCardArt` would ever run with a null/missing
  // art value, or "reject" quietly becomes "clamp" again.
  const block = HOOK.slice(HOOK.indexOf(`case 'cardArt':`))
  assert.match(
    block,
    /if \(!art\) \{\s*\n[\s\S]*?console\.warn\(`\[decke\] cardArt: no card "\$\{c\.card\}" in the catalog`\)\s*\n\s*break\s*\n\s*\}\s*\n\s*decke\.setCardArt/,
    'an unresolved card id no longer warns-and-skips before the point `setCardArt` runs — ' +
      'a failed lookup must never reach the slot at all, see the "reject, do not clamp" rule',
  )
})

test('card_stash resolves the NAMED cards, not just their count', () => {
  const c = code(HOOK)
  assert.doesNotMatch(
    c,
    /decke\.setStashCount\(/,
    'card_stash is back to showing a COUNT of placeholder cards instead of the cards actually named',
  )
  assert.match(
    c,
    /const art = await artForIds\(c\.cards, signal\)/,
    'card_stash no longer resolves its `cards` ids through the shared catalog resolver',
  )
  assert.match(
    c,
    /decke\.setStashCards\(art, \{ autoClose: c\.autoClose === true \}\)/,
    'a resolved card_stash batch is no longer actually handed to the engine',
  )
})

test('card_stash REJECTS the whole command when every named id is unknown', () => {
  // "Playing anyway would put a fan of the model's baked-in, nonexistent
  // Pokemon in front of the reader and call it their collection" — the same
  // rule `commands.ts` documents for the dev page's identical case, mirrored
  // here on purpose rather than reimplemented differently.
  const block = HOOK.slice(HOOK.indexOf(`case 'state': {`), HOOK.indexOf(`case 'facing'`))
  assert.match(
    block,
    /if \(art\.every\(\(a\) => a === null\)\) \{[\s\S]*?console\.warn\([\s\S]*?break\s*\n\s*\}\s*\n[\s\S]*?decke\.setStashCards/,
    'an all-unresolved card_stash no longer rejects the command before it would reach the engine',
  )
})

test('a superseded card lookup cannot land late: it is awaited, in order, against an abort signal', () => {
  const c = code(HOOK)
  // Within one `apply` call: no `Promise.all`, no fire-and-forget per
  // command — a `for...of` with `await` inside it, so a `cardArt` command
  // always finishes before the command that follows it in the same
  // `express` call is even started.
  assert.match(
    c,
    /async function apply\(\s*\n\s*decke: DeckEInstance,\s*\n\s*commands: WireCommand\[\],\s*\n\s*signal: AbortSignal,\s*\n\s*\): Promise<boolean>/,
    'apply no longer takes the abort signal it threads into every card lookup',
  )
  assert.match(
    c,
    /if \(signal\.aborted\) return moved/,
    'apply no longer gives up on a superseded turn’s remaining commands',
  )
  // Across calls: the SSE reader awaits `onCommands` inline, which is what
  // stops a second `express` call in the same turn from being applied while
  // an earlier one is still resolving a card.
  assert.match(
    c,
    /onCommands: \(commands: WireCommand\[\]\) => Promise<void>/,
    'onCommands is no longer typed to return a promise the reader can await',
  )
  assert.match(
    c,
    /await handlers\.onCommands\(part\.data\.commands\)/,
    'the SSE reader no longer awaits onCommands — a later command batch can again race an earlier one',
  )
})

test('movedRef only fires for a real state change, so a fully-rejected reaction cannot strand him in `thinking`', () => {
  // `thinking` is a SUSTAINED state (see `send`'s own comment on the turn
  // boundary). If `apply` reported "he moved" for a `card_stash` that
  // rejected outright — calling `decke.setState` zero times — the turn
  // boundary would never release it, and he would rock in `thinking` for the
  // rest of the page's life.
  const c = code(HOOK)
  assert.match(
    c,
    /const moved = await apply\(decke, commands, ac\.signal\)/,
    'onCommands no longer reads apply’s own report of whether anything actually moved',
  )
  assert.match(c, /if \(moved\) movedRef\.current = true/, 'movedRef is unconditional again')
})
