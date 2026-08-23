/**
 * The sentence a person is asked to authorise a real write with.
 *
 * ── WHAT WAS WRONG ───────────────────────────────────────────────────────────
 *
 * `titleFor` de-snake-cased the tool name, so the consent dialog asked
 * **"Let him save deck?"** — grammatical only if you already know `save_deck` is
 * an identifier — and **"Let him log cards?"**, which is our word for it and not
 * the reader's. They asked him to add a card.
 *
 * No transform fixes that. What is missing is the article, the object, and the
 * fact that eleven different verbs hide behind one naming convention. So the
 * phrases are written out, and this pins the two things about them that a future
 * change can silently break.
 *
 * ── THE FAILURE MODE THIS EXISTS FOR ─────────────────────────────────────────
 *
 * Adding a twelfth write tool. It would fall through to the de-snake-cased
 * fallback and reach a reader as "Let him bulk import cards?" — plausible enough
 * in review, and nobody would be asked to write the sentence. The first
 * assertion below fails instead, at the moment the tool is added.
 *
 * `apps/web` does not depend on `@deckpal/agent-tools`, so the list of write
 * tools is read from that package's SOURCE rather than imported — the same trade
 * `escortPlan.test.ts` makes for the server prompt, and for the same reason.
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { approvalQuestion } from '../chat/approvalCardState'

const HOST_SRC = readFileSync(
  fileURLToPath(new URL('../useDeckeChat.ts', import.meta.url)),
  'utf8',
)
const TOOLS_DIR = fileURLToPath(
  new URL('../../../../../../packages/agent-tools/src/tools/', import.meta.url),
)
/** The deep tier lives in the API, not in `agent-tools`, and asks too. */
const DEEP_SRC = fileURLToPath(
  new URL('../../../../../api/src/decke/deep.ts', import.meta.url),
)

/** The phrases, read out of the map in `useDeckeChat.ts`. */
function phrases(): Map<string, string> {
  const block = HOST_SRC.match(/const APPROVAL_PHRASE: Record<string, string> = \{([\s\S]*?)\n\}/)
  assert.ok(block, 'APPROVAL_PHRASE is gone from useDeckeChat.ts')
  const out = new Map<string, string>()
  for (const m of block[1].matchAll(/^\s*([a-z_]+):\s*'([^']*)',?\s*$/gm)) out.set(m[1], m[2])
  assert.ok(out.size > 0, 'APPROVAL_PHRASE parsed to nothing — the shape changed')
  return out
}

/** Every tool whose annotations say it WRITES, read from the tool sources. */
function writeTools(): string[] {
  const found: string[] = []
  for (const file of readdirSync(TOOLS_DIR).filter((f) => f.endsWith('.ts'))) {
    const src = readFileSync(TOOLS_DIR + file, 'utf8')
    // Each definition opens with `name: '<x>'` and declares its annotations
    // before the next one opens. Slice between them and look inside.
    const marks = [...src.matchAll(/\bname: '([a-z_]+)'/g)]
    marks.forEach((m, i) => {
      const body = src.slice(m.index ?? 0, marks[i + 1]?.index ?? src.length)
      if (/readOnlyHint:\s*false/.test(body)) found.push(m[1])
    })
  }
  assert.ok(found.length > 5, `only found ${found.length} write tools — the scan broke, not the code`)
  return found
}

/**
 * Every DEEP tool, which now needs approval too.
 *
 * They stopped being exempt in this pass: a deep call is a sub-agent with its
 * own model and up to 210 seconds, and under the credit model it is the only
 * thing a reader can run out of. So each one reaches the same dialog and needs
 * the same written sentence — without one, "Let him plan deck?".
 */
function deepTools(): string[] {
  const src = readFileSync(DEEP_SRC, 'utf8')
  const found = [...src.matchAll(/name: '([a-z_]+)'/g)].map((m) => m[1])
  assert.ok(found.length >= 4, `only found ${found.length} deep tools — the scan broke, not the code`)
  return found
}

/** Everything that can put a consent dialog in front of a reader. */
const asking = () => [...new Set([...writeTools(), ...deepTools()])]

test('every tool that ASKS has a phrase somebody actually wrote', () => {
  const have = phrases()
  const missing = asking().filter((n) => !have.has(n))
  assert.deepEqual(
    missing,
    [],
    `these write tools would reach a reader as a de-snake-cased identifier: ${missing.join(', ')}`,
  )
})

test('no phrase is for a tool that no longer exists', () => {
  // The other direction. A stale entry is harmless on screen but it is a lie in
  // a file people read to find out what the product can do.
  const known = new Set(asking())
  const stale = [...phrases().keys()].filter((n) => !known.has(n))
  assert.deepEqual(stale, [], `phrases for tools that are gone: ${stale.join(', ')}`)
})

test('each phrase completes "Can I ___?" as a sentence', () => {
  for (const [name, phrase] of phrases()) {
    assert.match(phrase, /^[a-z]/, `${name}: a phrase starts lower case — it lands mid-sentence`)
    assert.doesNotMatch(phrase, /[.?!]$/, `${name}: terminal punctuation lands mid-sentence`)
    assert.doesNotMatch(
      phrase,
      /^(?:let\s+h(?:im|er|them)|can\s+i)/i,
      `${name}: "Can I can I ..." — the bug this replaced, in its new clothes`,
    )
  }
})

test('a phrase names what it acts on, rather than saying "it"', () => {
  // The dialog can be the only thing on screen once a scroll has carried the
  // request out of view. "Let him delete it?" is a question nobody should be
  // asked to answer, and the destructive ones are exactly where it would land.
  for (const [name, phrase] of phrases()) {
    assert.doesNotMatch(
      phrase,
      /\b(it|them|that thing)$/i,
      `${name}: "${phrase}" ends on a pronoun — say what it acts on`,
    )
  }
})

test('the composed question reads correctly for every one of them', () => {
  // Through the REAL composer, not a copy of it — `approvalQuestion` does the
  // lower-casing, the terminal-punctuation strip and the lead-in de-dupe.
  for (const [name, phrase] of phrases()) {
    const q = approvalQuestion(phrase.charAt(0).toUpperCase() + phrase.slice(1))
    assert.match(q, /^Can I .+\?$/, `${name} composed to ${JSON.stringify(q)}`)
    assert.doesNotMatch(q, /\?\?/, `${name} composed a double question mark`)
    assert.doesNotMatch(q, /Can I can I/i, `${name} composed a doubled lead-in`)
    // THE VOICE. Every one of these is him asking, so none of them may describe
    // him from outside — that is the note the whole second pass came from, and
    // this map is the one place the sentences are written by hand.
    assert.doesNotMatch(q, /\bLet him\b/i, `${name} still speaks about him in the third person`)
  }
})

test('the two the owner actually saw now read as English, and he says them himself', () => {
  // Named rather than left to the rules above, because these are the strings
  // that were photographed and reported.
  const have = phrases()
  assert.equal(approvalQuestion('Save deck'), 'Can I save deck?', 'the OLD phrase, for contrast')
  assert.equal(
    approvalQuestion(have.get('save_deck')!.replace(/^./, (c) => c.toUpperCase())),
    'Can I save this deck?',
  )
  assert.equal(
    approvalQuestion(have.get('log_cards')!.replace(/^./, (c) => c.toUpperCase())),
    'Can I change what your collection says you own?',
  )
})

test('`titleFor` actually READS the map — this test caught itself not doing so', () => {
  // A SOURCE PIN, and it exists because of a mutation that came back GREEN.
  // Replacing the lookup with `undefined` — so every tool fell through to the
  // de-snake-cased fallback and the whole map became dead code — broke nothing
  // above. Every assertion in this file reads the map directly, so all of them
  // kept passing while the product went back to asking "Let him save deck?".
  //
  // That is this repository's most repeated bug shape: `CardRows`, `onRemoveCard`
  // and `resetDeckeEntitlement` were all built and never wired, and the last of
  // them meant Deck-E never appeared for a signed-in user. A map with no reader
  // is the same defect wearing different clothes.
  //
  // `useDeckeChat.ts` cannot be imported here — it reaches `import.meta.env` at
  // module scope — so the wiring is pinned by reading it.
  assert.match(
    HOST_SRC,
    /const phrase = APPROVAL_PHRASE\[name\]\s+if \(phrase\) return phrase/,
    'titleFor no longer looks the tool up in APPROVAL_PHRASE — the map is dead code',
  )
})
